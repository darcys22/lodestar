import {Worker} from "worker_threads";
import path from "path";
import {IBlsWorkerData, IBlsWorkerEvents} from "./workerBlsBatchVerifyTypes";

export async function blsBatchVerifyThreaded(data: IBlsWorkerData): Promise<boolean[]> {
  const worker = new Worker(path.join(__dirname, "worker.js"), {
    workerData: {
      path: "./workerBlsBatchVerify.ts",
      ...data,
    } as IBlsWorkerData,
  });

  return new Promise((resolve, reject) => {
    worker.on("message", (event: IBlsWorkerEvents) => {
      switch (event.event) {
        case "result":
          return resolve(event.isValid);

        case "error":
          return reject(Error(event.error || "Worker thread error"));
      }
    });

    worker.on("exit", (exitCode) => {
      if (exitCode === 0) {
        resolve();
      } else {
        reject(Error(`Worker has stopped with code ${exitCode}`));
      }
    });

    worker.on("error", (err) => {
      reject(err);
    });
  });
}
