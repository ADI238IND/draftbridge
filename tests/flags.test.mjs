import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "../dist/flags.mjs";
import { FLAG, METRIC } from "../dist/flow.mjs";

function fake(flag) {
  const calls = [];
  const sdk = {
    init: async config => calls.push(["init", config]),
    getAllFlags: () => ({ [FLAG]: flag }),
    trackExposureEvent: (...args) => calls.push(["exposure", ...args]),
    trackEvent: (...args) => calls.push(["event", ...args]),
    flushEvents: async () => calls.push(["flush"]),
  };
  return { calls, load: async () => ({ createFlagsmithInstance: () => sdk }) };
}
const enrolled = { enabled: true, value: "recovery", variant: "guided-v1",
  experiment: { inExperiment: true, id: 57 } };

test("preview mode never imports the SDK", async () => {
  assert.equal(await connect({}, "one", () => { throw Error("Unexpected"); }), null);
});
test("a remote flag selects the arm and exposure is explicit", async () => {
  const { calls, load } = fake(enrolled);
  const service = await connect({ environmentKey: "client-key" }, "one", load);
  const assignment = service.assignment();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].identity, "draftbridge-one");
  assert.equal(assignment.variant, "recovery");
  service.expose(assignment);
  assert.deepEqual(calls[1], ["exposure", FLAG, { value: "guided-v1", metadata: { experiment_id: 57 } }]);
});
test("outside the enrollment, a rollout renders without attributing exposure", async () => {
  const { calls, load } = fake({ ...enrolled, experiment: { inExperiment: false } });
  const service = await connect({ environmentKey: "client-key" }, "two", load);
  assert.equal(service.assignment().source, "remote");
  service.expose(service.assignment());
  assert.equal(calls.length, 1);
});
test("an unknown variation or disabled flag uses the safe local fallback", async () => {
  for (const flag of [{ ...enrolled, value: "unknown" }, { ...enrolled, enabled: false }]) {
    const { load } = fake(flag);
    const service = await connect({ environmentKey: "client-key" }, "three", load);
    assert.equal(service.assignment(), null);
  }
});
test("the 120-second boundary controls conversion and late receipts still report guardrails", async () => {
  const { calls, load } = fake(enrolled);
  const service = await connect({ environmentKey: "client-key" }, "four", load);
  service.convert(120_000, 1);
  service.convert(120_001, 3);
  await service.flush();
  assert.equal(calls.filter(([, name]) => name === METRIC).length, 1);
  assert.equal(calls.filter(([, name]) => name === "draftbridge_time_to_receipt_ms").length, 2);
  assert.deepEqual(calls.at(-1), ["flush"]);
});
