import sinon from "sinon";
import {config as minimalConfig} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {ActiveValidatorCache} from "../../../../src/db/api/beacon/activeValidatorCache";
import {IBeaconDb, BeaconDb} from "../../../../src/db";
import {CleanUpTask} from "../../../../src/tasks/tasks/cleanUpTask";
import {IBeaconChain, BeaconChain} from "../../../../src/chain";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";

describe("CleanUpTask", function () {
  const sandbox = sinon.createSandbox();

  let task: CleanUpTask;
  let chain: IBeaconChain;

  let db: IBeaconDb;

  beforeEach(() => {
    db = {
      activeValidatorCache: new ActiveValidatorCache(),
    } as BeaconDb;
    chain = sandbox.createStubInstance(BeaconChain);
    task = new CleanUpTask(minimalConfig, {
      chain,
      db,
      logger: new WinstonLogger(),
    });
  });

  afterEach(() => {
    db.activeValidatorCache.clear();
  });

  it("should delete inactive validators", async () => {
    await db.activeValidatorCache.add(0, 0);
    await db.activeValidatorCache.add(1, 1);
    await db.activeValidatorCache.add(2, 2);
    await task.run(2);
    expect(await db.activeValidatorCache.values()).to.be.deep.equal([1, 2]);
  });
});
