import assert from "node:assert/strict";
import { test } from "node:test";
import { cached } from "../src/cache.ts";

test("simultaneous calls share one load, then the value is kept", async () => {
  let loads = 0;
  const get = cached(async () => ++loads, 60_000);
  assert.deepEqual(await Promise.all([get(), get(), get()]), [1, 1, 1]);
  assert.equal(await get(), 1);
  assert.equal(loads, 1);
});

test("the value is loaded again after the delay", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  let loads = 0;
  const get = cached(async () => ++loads, 1000);
  assert.equal(await get(), 1);
  t.mock.timers.tick(999);
  assert.equal(await get(), 1);
  t.mock.timers.tick(1);
  assert.equal(await get(), 2);
});

test("a failed load is not kept", async () => {
  let loads = 0;
  const get = cached(async () => {
    loads += 1;
    if (loads === 1) throw new Error("FRM down");
    return "ok";
  }, 60_000);
  await assert.rejects(get(), /FRM down/);
  assert.equal(await get(), "ok");
});
