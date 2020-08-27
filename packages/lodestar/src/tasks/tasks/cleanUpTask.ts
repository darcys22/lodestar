import {IBeaconChain} from "../../chain";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Epoch} from "@chainsafe/lodestar-types";
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

  private run = async (epoch: Epoch): Promise<void> => {
    this.logger.info("Run CleanUpTask at epoch ", epoch);
    this.logger.profile("CleanUpTask");
    const indexes = await this.db.activeValidatorCache.values();
    const headState = await this.chain.getHeadState();
    await Promise.all(
      indexes
        .filter((index) => headState.validators[index].exitEpoch <= epoch)
        .map((index) => this.db.activeValidatorCache.delete(index))
    );
    this.logger.profile("CleanUpTask");
  };
}
