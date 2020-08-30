import {parentPort, workerData} from "worker_threads";
import {initBLS} from "@chainsafe/bls";
import {IBlsWorkerData, IBlsWorkerEvents} from "./workerBlsBatchVerifyTypes";
import {batchVerify} from "./blsBatchVerify";

function workerBlsBatchVerify(data: IBlsWorkerData): boolean[] {
  const batchSize = data.batchSize || 10;
  const items = data.items;
  if (!items || !Array.isArray(items)) throw Error("Required 'items' worked data");
  if (!parentPort) throw Error("Must be run in a worker thread, no parentPort");

  let isValid: boolean[] = [];

  for (let i = 0; i < items.length / batchSize; i++) {
    const itemsBatch = items.slice(i * batchSize, (i + 1) * batchSize);
    const isValidBatch = batchVerify(itemsBatch);
    isValid = isValid.concat(isValidBatch);
  }

  return isValid;
}

initBLS()
  .then(() => workerBlsBatchVerify(workerData))
  .then((isValid) => {
    parentPort!.postMessage({
      event: "result",
      isValid,
    } as IBlsWorkerEvents);
    process.exit(0);
  })
  .catch((e) => {
    parentPort!.postMessage({
      event: "error",
      error: e.stack || e.message,
    } as IBlsWorkerEvents);
    process.exit(1);
  });
