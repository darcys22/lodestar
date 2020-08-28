import {IBeaconChain} from "../../chain";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";

export interface ICleanUpModules {
  chain: IBeaconChain;
  db: IBeaconDb;
  logger: ILogger;
}

/**
 * Cleanup task to run per epoch or per slot.
 */
export class CleanUpTask {
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly logger: ILogger;

  public constructor(config: IBeaconConfig, modules: ICleanUpModules) {
    this.config = config;
    this.chain = modules.chain;
    this.db = modules.db;
    this.logger = modules.logger;
  }

  public async start(): Promise<void> {
    this.chain.clock.onNewEpoch(this.run);
  }

  public async stop(): Promise<void> {
    this.chain.clock.unsubscribeFromNewEpoch(this.run);
  }

  public run = async (epoch: Epoch): Promise<void> => {
    this.logger.info("Run CleanUpTask at epoch", epoch);
    this.logger.profile("CleanUpTask");
    await this.cleanupActiveValidatorCache(epoch);
    this.logger.profile("CleanUpTask");
  };

  private async cleanupActiveValidatorCache(epoch: Epoch): Promise<void> {
    const indexes = await this.db.activeValidatorCache.values();
    const toDelete: ValidatorIndex[] = [];
    for (const index of indexes) {
      const lastActiveEpoch = (await this.db.activeValidatorCache.get(index))?.epoch as Epoch;
      if (lastActiveEpoch < epoch - 1) toDelete.push(index);
    }
    await this.db.activeValidatorCache.batchDelete(toDelete);
  }
}
