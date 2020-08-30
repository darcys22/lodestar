export interface IBlsVerifyPayload {
  publicKey: Uint8Array;
  messageHash: Uint8Array;
  signature: Uint8Array;
}

export interface IBlsWorkerData {
  batchSize: number;
  items: IBlsVerifyPayload[];
}

export type IBlsWorkerEvents = {event: "result"; isValid: boolean[]} | {event: "error"; error: string};
