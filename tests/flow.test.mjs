import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmed, fresh, interrupted, restore, sendToDemoService, startSend } from "../dist/flow.mjs";

function receivingService() {
  const receipts = new Map();
  return { receipts, async receive(id, reason) {
    if (!receipts.has(id)) receipts.set(id, { number: `DB-${id}`, reason });
    return receipts.get(id);
  } };
}
const live = { variant: "recovery", source: "flagsmith" };
const local = { variant: "control", source: "local" };

test("a dropped request produces no receipt and leaves the draft untouched", async () => {
  const repo = receivingService();
  const state = startSend({ ...fresh("one"), reason: "My edited draft text." });
  const result = await sendToDemoService({ id: state.id, reason: state.reason, fault: "drop", online: true, repo });
  const next = interrupted(state, live, result.failure, 500);
  assert.equal(repo.receipts.size, 0);
  assert.equal(next.reason, state.reason);
  assert.deepEqual(next.exposure, { variant: "recovery", source: "flagsmith", time: 500 });
});
test("losing the response happens after storage, so the retry returns the original receipt", async () => {
  const repo = receivingService();
  const send = fault => sendToDemoService({ id: "two", reason: "Same details", fault, online: true, repo });
  assert.match((await send("ack")).failure, /after arrival/);
  const first = repo.receipts.get("two");
  assert.equal((await send("none")).receipt, first);
  assert.equal(repo.receipts.size, 1);
});
test("a real offline attempt creates no demo service record", async () => {
  const repo = receivingService();
  const result = await sendToDemoService({ id: "three", reason: "Same details", fault: "none", online: false, repo });
  assert.match(result.failure, /^Offline/);
  assert.equal(repo.receipts.size, 0);
});
test("exposure arm and time survive subsequent failures", () => {
  let state = interrupted(startSend(fresh("four")), live, "Offline", 20);
  state = interrupted(startSend(state), local, "Offline", 40);
  assert.equal(state.attempt, 2);
  assert.deepEqual(state.exposure, { variant: "recovery", source: "flagsmith", time: 20 });
});
test("only enrolled and previously exposed confirmations enqueue experiment metrics", () => {
  const receipt = { number: "DB-FIVE" };
  const begun = startSend(fresh("five"));
  assert.equal(confirmed(begun, receipt, 40).pendingMetric, false);
  assert.equal(confirmed(startSend(interrupted(begun, local, "Offline", 10)), receipt, 40).pendingMetric, false);
  assert.equal(confirmed(startSend(interrupted(begun, live, "Offline", 10)), receipt, 40).pendingMetric, true);
});
test("page reload after an interrupted send keeps the draft and request ID", () => {
  const sending = startSend({ ...fresh("six"), reason: "Keep this saved reason." });
  const state = restore(sending, "new");
  assert.deepEqual([state.id, state.reason, state.attempt, state.phase], ["six", sending.reason, 1, "interrupted"]);
});
test("a confirmed application cannot transition back into sending", () => {
  const state = confirmed(startSend(fresh("seven")), { number: "DB-SEVEN" });
  assert.equal(startSend(state), state);
  assert.equal(interrupted(state, local, "Offline"), state);
});
