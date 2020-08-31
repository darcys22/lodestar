import PeerId from "peer-id";
import {Metadata, Status} from "@chainsafe/lodestar-types";
import {ReqRespEncoding} from "../../constants";

export interface IPeerMetadataStore {
  setStatus(peer: PeerId, status: Status | null): void;
  getStatus(peer: PeerId): Status | null;
  setBlockProviderScore(peer: PeerId, score: number | null): void;
  getBlockProviderScore(peer: PeerId): number | null;
  setMetadata(peer: PeerId, metadata: Metadata | null): void;
  getMetadata(peer: PeerId): Metadata | null;
  setEncoding(peer: PeerId, encoding: ReqRespEncoding | null): void;
  getEncoding(peer: PeerId): ReqRespEncoding | null;
}
