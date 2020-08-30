import {verify, verifyMultiple, aggregateSignatures} from "@chainsafe/bls";
import {IBlsVerifyPayload} from "./workerBlsBatchVerifyTypes";

export function batchVerify(items: IBlsVerifyPayload[]): boolean[] {
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
