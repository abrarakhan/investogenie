import assert from "node:assert/strict";
import test from "node:test";
import { modulesForFiles } from "./module-registry.mjs";

const keys = (files) => modulesForFiles(files).map((module) => module.key);

test("routes Momentum engine changes without selecting unrelated modules", () => {
  assert.deepEqual(keys(["pipelines/strategy_math/momentum.py"]), ["momentum"]);
});

test("routes shared mobile API changes to the mobile module", () => {
  assert.deepEqual(keys(["app/api/v1/mobile/screens/route.ts"]), ["mobile"]);
});

test("allows one file to select every directly affected module", () => {
  assert.deepEqual(keys(["app/api/v1/mobile/trade-ledger/route.ts"]), ["ledger", "mobile"]);
});
