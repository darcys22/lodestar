import {ICliCommand} from "../../../../util";
import {IGlobalArgs} from "../../../../options";
import {accountValidatorOptions, IAccountValidatorArgs} from "./options";
import {create} from "./create";
import {deposit} from "./deposit";
import {importCmd} from "./import";
import {list} from "./list";

export const validator: ICliCommand<IAccountValidatorArgs, IGlobalArgs> = {
  command: "validator <command>",
  describe: "Provides commands for managing Eth2 validators.",
  options: accountValidatorOptions,
  subcommands: [create, deposit, importCmd, list],
};
