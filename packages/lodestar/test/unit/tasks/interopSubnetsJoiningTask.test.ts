import {SinonStubbedInstance, SinonFakeTimers} from "sinon";
import {INetwork, Libp2pNetwork} from "../../../src/network";
import {IGossip} from "../../../src/network/gossip/interface";
import {config as minimalConfig} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon from "sinon";
import {IBeaconChain} from "../../../src/chain";
import {Gossip} from "../../../src/network/gossip/gossip";
import {InteropSubnetsJoiningTask} from "../../../src/tasks/tasks/interopSubnetsJoiningTask";
import {WinstonLogger, bytesToInt, intToBytes} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {generateState} from "../../utils/state";
import {BeaconState} from "@chainsafe/lodestar-types";
import {MetadataController} from "../../../src/network/metadata";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";
import {StubbedBeaconDb} from "../../utils/stub";

describe("interopSubnetsJoiningTask", () => {
  const sandbox = sinon.createSandbox();
  let clock: SinonFakeTimers;
  let networkStub: SinonStubbedInstance<INetwork>;
  let gossipStub: SinonStubbedInstance<IGossip>;
  let dbStub: StubbedBeaconDb;

  let chain: IBeaconChain;
  const logger = new WinstonLogger();
  let task: InteropSubnetsJoiningTask;
  let state: BeaconState;

  const ALL_FORKS = [
    {
      currentVersion: 2,
      epoch: 1000,
      // GENESIS_FORK_VERSION is <Buffer 00 00 00 01> but previousVersion = 16777216 not 1 due to bytesToInt
      previousVersion: bytesToInt(minimalConfig.params.GENESIS_FORK_VERSION),
    },
  ];
  const params = Object.assign({}, minimalConfig.params, {ALL_FORKS});
  const config: IBeaconConfig = Object.assign({}, minimalConfig, {params});

  beforeEach(async function () {
    clock = sandbox.useFakeTimers();
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    gossipStub = sandbox.createStubInstance(Gossip);
    networkStub.gossip = gossipStub;
    state = generateState();
    chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: BigInt(0),
      state: state as TreeBacked<BeaconState>,
      config,
    });
    networkStub.metadata = new MetadataController({}, {config, chain, logger});
    dbStub = new StubbedBeaconDb(sinon);
    dbStub.activeValidatorCache.values.resolves([0, 5]);
    task = new InteropSubnetsJoiningTask(config, {
      network: networkStub,
      chain,
      db: dbStub,
      logger,
    });
  });

  afterEach(async () => {
    await task.stop();
    sandbox.reset();
    clock.restore();
  });

  it("should not subscribe when there is no active validator", async () => {
    dbStub.activeValidatorCache.values.resolves([]);
    await task.start();
    expect(gossipStub.subscribeToAttestationSubnet.called).to.be.false;
  });

  it("should handle fork digest change", async () => {
    await task.start();
    const oldForkDigest = chain.currentForkDigest;
    // 2 active validators
    expect(gossipStub.subscribeToAttestationSubnet.callCount).to.be.equal(2);
    // fork digest changed due to current version changed
    state.fork.currentVersion = Buffer.from([100, 0, 0, 0]);
    expect(config.types.ForkDigest.equals(oldForkDigest, chain.currentForkDigest)).to.be.false;
    // not subscribe, just unsubscribe at that time
    const unsubsPromise1 = new Promise((resolve) => gossipStub.unsubscribeFromAttestationSubnet.onFirstCall().callsFake(resolve));
    const unsubsPromise2 = new Promise((resolve) => gossipStub.unsubscribeFromAttestationSubnet.onSecondCall().callsFake(resolve));
    chain.emit("forkDigest", chain.currentForkDigest);
    await Promise.all([unsubsPromise1, unsubsPromise2]);
    // 2 active validators
    expect(gossipStub.unsubscribeFromAttestationSubnet.callCount).to.be.equal(2);
  });

  it("should change subnet subscription after 2*EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION", async () => {
    await task.start();
    const seqNumber = networkStub.metadata.seqNumber;
    expect(Number(seqNumber)).to.be.gt(0);
    expect(gossipStub.subscribeToAttestationSubnet.callCount).to.be.equal(2);
    const unsubscribePromise1 = new Promise((resolve) => gossipStub.unsubscribeFromAttestationSubnet.onFirstCall().callsFake(resolve));
    const unsubscribePromise2 = new Promise((resolve) => gossipStub.unsubscribeFromAttestationSubnet.onSecondCall().callsFake(resolve));
    clock.tick(
      2 *
        config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION *
        config.params.SLOTS_PER_EPOCH *
        config.params.SECONDS_PER_SLOT *
        1000
    );
    await Promise.all([unsubscribePromise1, unsubscribePromise2]);
    expect(gossipStub.unsubscribeFromAttestationSubnet.callCount).to.be.gte(2);
    // 2 more because of changing subnets
    expect(gossipStub.subscribeToAttestationSubnet.callCount).to.be.gte(4);
    expect(Number(networkStub.metadata.seqNumber)).to.be.gt(Number(seqNumber));
  });

  it("should prepare for a hard fork", async function () {
    await task.start();
    // scheduleNextForkSubscription already get called after start
    const state = await chain.getHeadState();
    const nextForkDigest = computeForkDigest(
      config,
      intToBytes(ALL_FORKS[0].currentVersion, 4),
      state.genesisValidatorsRoot
    );
    const spy = sandbox.spy();
    gossipStub.subscribeToAttestationSubnet.callsFake(spy);
    const timeToGetThroughPreparedEpoch = (ALL_FORKS[0].epoch - config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION + 1) *
      config.params.SLOTS_PER_EPOCH *
      config.params.SECONDS_PER_SLOT *
      1000;
    clock.tick(timeToGetThroughPreparedEpoch);
    // wait for async functions
    await Promise.resolve();
    // at least 2 run right after start, 2 run in scheduleNextForkSubscription
    expect(gossipStub.subscribeToAttestationSubnet.callCount).to.be.gte(4);
    // subscribe to next fork digest subnet
    const forkDigestArgs = spy.args.map((callTimeArgs) => callTimeArgs[0]);
    expect(forkDigestArgs.some((forkDigest) => config.types.ForkDigest.equals(forkDigest, nextForkDigest))).to.be.true;
  });
});
