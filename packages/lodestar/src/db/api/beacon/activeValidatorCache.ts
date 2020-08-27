import {ValidatorIndex} from "@chainsafe/lodestar-types";

/**
 * In memory cache of connected validators to this node.
 *
 * Similar API to Repository
 */
export class ActiveValidatorCache {
  private cache: Set<ValidatorIndex>;

  constructor() {
    this.cache = new Set();
  }

  public async add(index: ValidatorIndex): Promise<void> {
    this.cache.add(index);
  }

  public async batchAdd(indexes: ValidatorIndex[] = []): Promise<void> {
    indexes.forEach((index) => this.add(index));
  }

  public async delete(index: ValidatorIndex): Promise<void> {
    this.cache.delete(index);
  }

  public async values(): Promise<ValidatorIndex[]> {
    return Array.from(this.cache);
  }
}
