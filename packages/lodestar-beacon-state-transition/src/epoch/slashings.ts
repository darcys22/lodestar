/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {decreaseBalance, getCurrentEpoch, getTotalActiveBalance} from "../util";
import {bigIntMin, intDiv} from "@chainsafe/lodestar-utils";

/**
 * Process the slashings.
 *
 * Note that this function mutates ``state``.
 */
export function processSlashings(config: IBeaconConfig, state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const totalBalance = getTotalActiveBalance(config, state);
  const totalSlashings = Array.from(state.slashings).reduce((a, b) => a + b, BigInt(0));
  const slashingMultiplier = bigIntMin(totalSlashings * BigInt(3), totalBalance);

  state.validators.forEach((validator, index) => {
    if (
      validator.slashed &&
      currentEpoch + intDiv(config.params.EPOCHS_PER_SLASHINGS_VECTOR, 2) === validator.withdrawableEpoch
    ) {
      const penalty =
        (((validator.effectiveBalance / config.params.EFFECTIVE_BALANCE_INCREMENT) * slashingMultiplier) /
          totalBalance) *
        config.params.EFFECTIVE_BALANCE_INCREMENT;

      decreaseBalance(state, index, penalty);
    }
  });
}
