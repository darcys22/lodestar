import "mocha";
import {expect} from "chai";
import fs from "fs";
import path from "path";
import os from "os";
import {AbortController} from "abort-controller";
import {getMedallaConfig, medalla} from "./util";
import {getDepositsStream, Eth1Provider, IDepositEvent} from "../../../src/eth1";
import {toHexString, fromHexString} from "@chainsafe/ssz";
import {computeDomain, computeSigningRoot, DomainType} from "@chainsafe/lodestar-beacon-state-transition";
import {verify, initBLS, verifyMultiple, aggregateSignatures} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {DepositData} from "@chainsafe/lodestar-types";
import {blsBatchVerifyThreaded} from "./blsBatchVerifyThreaded";

describe("Test around Eth1 data", function () {
  const dbDir = "deposit-db";
  const depositsPath = path.join(dbDir, "deposits.json");
  fs.mkdirSync(dbDir, {recursive: true});

  const providerUrl = "https://goerli.infura.io/v3/bb15bacfcdbe45819caede241dcf8b0d";
  const config = getMedallaConfig();

  before("Init BLS", async function () {
    await initBLS();
  });

  it("Should validate signature", function () {
    // Real valid deposit signature
    // {
    //   pubkeyValue: '8fcf28896a85e5e76ee9e508438e23e7253da1a23a6501e3a7d56182520dbcf4cdb44af3267318188f1f4168342146da',
    //   domain: '0300000018ae4ccbda9538839d79bb18ca09e23e24ae8c1550f56cbb3d84b053',
    //   signingRoot: '6f73dc43f26578de95ef6ba423def5ebcab381067eebfd50c44259c0572e4d66',
    //   signature: '9800d7c29908ddd1754490577753e65bd27484ca456b33b914e937416d58a6dd5b4eb420c22c144ae46f203fcc869e5c18f4e6daf99122294dc0ea691242625e7b75dfedf5d799899f44cf648245ccfc9652a957ae9216b022567c4cc4a72066'
    // } {
    //   pubkey: '0x8fcf28896a85e5e76ee9e508438e23e7253da1a23a6501e3a7d56182520dbcf4cdb44af3267318188f1f4168342146da',
    //   withdrawalCredentials: '0x0010361af430aa7ab4a9567eaaca50ec5e02315ca1513d9ee8d73bde96370091',
    //   amount: '32000000000'
    // }

    const serializedValidDeposit = {
      blockNumber: 0,
      index: 0,
      pubkey: "0x8fcf28896a85e5e76ee9e508438e23e7253da1a23a6501e3a7d56182520dbcf4cdb44af3267318188f1f4168342146da",
      withdrawalCredentials: "0x0010361af430aa7ab4a9567eaaca50ec5e02315ca1513d9ee8d73bde96370091",
      amount: "32000000000",
      signature:
        "0x9800d7c29908ddd1754490577753e65bd27484ca456b33b914e937416d58a6dd5b4eb420c22c144ae46f203fcc869e5c18f4e6daf99122294dc0ea691242625e7b75dfedf5d799899f44cf648245ccfc9652a957ae9216b022567c4cc4a72066",
    };

    const isValid = verifyDeposit(config, deserializeDeposit(serializedValidDeposit));
    expect(isValid, "Deposit must be valid").to.be.true;
  });

  it("Download all logs at once", async function () {
    this.timeout("10min");

    const eth1Provider = new Eth1Provider(config, {
      enabled: true,
      providerUrl,
      depositContractDeployBlock: medalla.depositBlock,
    });

    const MAX_BLOCKS_PER_POLL = 10000;
    const eth1Params = {...config.params, MAX_BLOCKS_PER_POLL};

    const controller = new AbortController();
    const depositsStream = getDepositsStream(medalla.depositBlock, eth1Provider, eth1Params, controller.signal);

    const events: IDepositEvent[] = [];
    const stopBlock = 3300162;

    const label = "Download all logs";
    console.time(label);

    for await (const {depositEvents, blockNumber} of depositsStream) {
      if (blockNumber > stopBlock) break;
      for (const deposit of depositEvents) events.push(deposit);
      const date = new Date().toISOString();
      const percent = ((100 * (stopBlock - blockNumber)) / (stopBlock - medalla.depositBlock)).toFixed(4);
      const mem = process.memoryUsage().heapUsed;
      console.log(`${date} ${blockNumber} ${percent}% deposits: ${events.length} mem: ${mem}`);
    }

    console.timeEnd(label);

    console.log(`Storing ${events.length} deposits...`);
    fs.writeFileSync(depositsPath, JSON.stringify(events.map(serializeDeposit), null, 2));
  });

  // All Medalla deposits single thread not batched
  // 56199 deposits: 1068646.249ms (17.8 min)
  // 19.016ms / deposit, 99.266% valid
  it("Verify all deposits single-threaded", async function () {
    this.timeout("30min");

    const eventsSerialized: IDepositEventSerialized[] = JSON.parse(fs.readFileSync(depositsPath, "utf8"));
    const events = eventsSerialized.map(deserializeDeposit);

    const label = `Validate ${events.length}`;
    console.time(label);

    const startTime = Date.now();
    let validCount = 0;
    let totalCount = 0;

    for (const event of events) {
      const {publicKey, messageHash, signature} = prepareDepositToSign(config, event);
      const isValid = verify(publicKey, messageHash, signature);

      if (isValid) validCount++;
      totalCount++;

      if (totalCount % 100 === 0) {
        const validRatio = ((100 * validCount) / totalCount).toFixed(3);
        const timePerVerify = (Date.now() - startTime) / totalCount;
        console.log([event.index, `${validRatio}%`, `${timePerVerify.toFixed(3)}ms`].join("\t"));
      }
    }
    console.timeEnd(label);
  });

  // All Medalla deposits single thread batched in 10
  // 56199 deposits: 637500.427ms (10.6 min)
  // 11.340ms / deposit, 99.266% valid
  it("Verify all deposits single-threaded batched", async function () {
    this.timeout("30min");

    const eventsSerialized: IDepositEventSerialized[] = JSON.parse(fs.readFileSync(depositsPath, "utf8"));
    const events = eventsSerialized.map(deserializeDeposit);

    const label = `Validate ${events.length}`;
    console.time(label);

    const batchSize = 10;
    const startTime = Date.now();
    let validCount = 0;
    let totalCount = 0;

    for (let i = 0; i < events.length / batchSize; i++) {
      const eventsBatch = events.slice(i * batchSize, (i + 1) * batchSize);
      const isValidBatch = batchVerify(eventsBatch.map((event) => prepareDepositToSign(config, event)));

      validCount += isValidBatch.filter(Boolean).length;
      totalCount += batchSize;

      if (totalCount % 100 === 0) {
        const validRatio = ((100 * validCount) / totalCount).toFixed(3);
        const timePerVerify = (Date.now() - startTime) / totalCount;
        console.log([eventsBatch[0].index, `${validRatio}%`, `${timePerVerify.toFixed(3)}ms`].join("\t"));
      }
    }
    console.timeEnd(label);
  });

  // All Medalla deposits multi thread (8 CPUs) batched in 10
  // 56199 deposits: 260262.120ms (4.3 min)
  // 4.631ms / deposit, 99.267% valid
  it("Verify all deposits multi-threaded batched", async function () {
    this.timeout("10min");

    const eventsSerialized: IDepositEventSerialized[] = JSON.parse(fs.readFileSync(depositsPath, "utf8"));
    const events = eventsSerialized.map(deserializeDeposit);

    const itemsBatches = batchItems(
      events.map((event) => prepareDepositToSign(config, event)),
      os.cpus().length
    );

    console.log(
      `Processing ${events.length} events in ${itemsBatches.length} batches`,
      itemsBatches.map((items) => items.length)
    );

    const label = `Validate ${events.length}`;
    console.time(label);

    const startTime = Date.now();
    let validCount = 0;
    let totalCount = 0;

    await Promise.all(
      itemsBatches.map(async (items, i) => {
        const isValid = await blsBatchVerifyThreaded({batchSize: 10, items});
        validCount += isValid.filter(Boolean).length;
        totalCount += items.length;
        console.log(`Finished processing ${items.length} items in batch ${i}`);
      })
    );

    const validRatio = ((100 * validCount) / totalCount).toFixed(3);
    const timePerVerify = (Date.now() - startTime) / totalCount;
    console.log([`processed ${totalCount}`, `${validRatio}%`, `${timePerVerify.toFixed(3)}ms`].join("\t"));

    console.timeEnd(label);
  });
});

function batchItems<T>(items: T[], batchCount: number): T[][] {
  const itemsPerBatch = Math.ceil(items.length / batchCount);
  const batches: T[][] = [];
  for (let i = 0; i < batchCount; i++) {
    batches.push(items.slice(i * itemsPerBatch, i === batchCount - 1 ? undefined : (i + 1) * itemsPerBatch));
  }
  return batches;
}

function batchVerify(items: {publicKey: Uint8Array; messageHash: Uint8Array; signature: Uint8Array}[]): boolean[] {
  const isBatchValid = verifyMultiple(
    items.map((item) => item.publicKey),
    items.map((item) => item.messageHash),
    aggregateSignatures(items.map((item) => item.signature))
  );

  if (isBatchValid) {
    return items.map(() => true);
  } else {
    return items.map((item) => verify(item.publicKey, item.messageHash, item.signature));
  }
}

interface IBlsVerifyPayload {
  publicKey: Uint8Array;
  messageHash: Uint8Array;
  signature: Uint8Array;
}

function prepareDepositToSign(config: IBeaconConfig, event: IDepositEvent): IBlsVerifyPayload {
  const depositData: DepositData = {
    pubkey: event.pubkey,
    withdrawalCredentials: event.withdrawalCredentials,
    amount: event.amount,
    signature: event.signature,
  };
  const publicKey = depositData.pubkey.valueOf() as Uint8Array;
  // Note: The deposit contract does not check signatures.
  // Note: Deposits are valid across forks, thus the deposit domain is retrieved directly from `computeDomain`.
  const domain = computeDomain(config, DomainType.DEPOSIT);
  const signingRoot = computeSigningRoot(config, config.types.DepositMessage, depositData, domain);
  const signature = depositData.signature.valueOf() as Uint8Array;
  return {
    publicKey,
    messageHash: signingRoot,
    signature,
  };
}

function verifyDeposit(config: IBeaconConfig, event: IDepositEvent): boolean {
  const {publicKey, messageHash, signature} = prepareDepositToSign(config, event);

  return verify(publicKey, messageHash, signature);
}

interface IDepositEventSerialized {
  blockNumber: number;
  index: number;
  pubkey: string;
  withdrawalCredentials: string;
  amount: string;
  signature: string;
}

function serializeDeposit(event: IDepositEvent): IDepositEventSerialized {
  return {
    blockNumber: event.blockNumber,
    index: event.index,
    pubkey: toHexString(event.pubkey),
    withdrawalCredentials: toHexString(event.withdrawalCredentials),
    amount: event.amount.toString(10),
    signature: toHexString(event.signature),
  };
}

function deserializeDeposit(event: IDepositEventSerialized): IDepositEvent {
  return {
    blockNumber: event.blockNumber,
    index: event.index,
    pubkey: fromHexString(event.pubkey),
    withdrawalCredentials: fromHexString(event.withdrawalCredentials),
    amount: BigInt(event.amount),
    signature: fromHexString(event.signature),
  };
}
