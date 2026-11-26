import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FLAG, METRIC } from "../dist/flow.mjs";

const target = new URL(process.argv[2]);
if (target.searchParams.get("experiment") !== "1") {
  throw Error("Pass the dedicated synthetic environment URL with ?experiment=1");
}
const visits = Number(process.argv[3] ?? 24);
if (!Number.isInteger(visits) || visits < 4 || visits > 40) {
  throw Error("Use an integer from 4 to 40 synthetic visits");
}

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DRAFTBRIDGE_PLAYWRIGHT || "playwright");
const browser = await chromium.launch(process.env.DRAFTBRIDGE_CHROMIUM
  ? { executablePath: process.env.DRAFTBRIDGE_CHROMIUM }
  : {});
const retryLabel = /^(Try again|Check & retry)$/;
const entries = [];
const testStarted = new Date();
let nextVisit = 0;
async function visit(index) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const receiveEvent = name => page.waitForResponse(response => {
    if (!response.ok() || response.request().method() !== "POST" || !response.url().includes("/v1/events")) return false;
    const data = response.request().postDataJSON();
    const events = Array.isArray(data) ? data : data?.events;
    return events?.some(event => event.event === name);
  }, { timeout: 15_000 }).then(response => {
    const data = response.request().postDataJSON();
    return (Array.isArray(data) ? data : data.events).find(event => event.event === name);
  });
  try {
    await page.goto(target.href);
    await page.getByText("Flagsmith connected", { exact: true }).waitFor();
    const exposureWaiting = receiveEvent("$flag_exposure");
    await page.getByRole("button", { name: "Send application" }).click();
    const retry = page.getByRole("button", { name: retryLabel });
    const variant = await retry.textContent() === "Check & retry" ? "recovery" : "control";
    const exposure = await exposureWaiting;
    assert.match(JSON.stringify(exposure), new RegExp(FLAG));
    assert.match(exposure.identifier, /^draftbridge-[a-f0-9-]+$/);
    // The abandonment rule is fixed before assignment and identical across both arms.
    const shouldRetry = index % 4 !== 0;
    if (shouldRetry) {
      const conversionWaiting = receiveEvent(METRIC);
      await retry.click();
      await page.getByRole("heading", { name: "Demo receipt confirmed" }).waitFor();
      const conversion = await conversionWaiting;
      assert.equal(conversion.identifier, exposure.identifier);
    }
    entries.push({ variant, converted: shouldRetry, identity: exposure.identifier });
  } finally {
    await context.close();
  }
}
try {
  const workers = Array.from({ length: 3 }, async () => {
    while (nextVisit < visits) {
      await visit(nextVisit++);
    }
  });
  const outcomes = await Promise.allSettled(workers);
  const failure = outcomes.find(item => item.status === "rejected");
  if (failure) throw failure.reason;
  assert.equal(new Set(entries.map(entry => entry.identity)).size, visits);
  console.log(JSON.stringify({
    start: testStarted.toISOString(),
    source: "synthetic, variant-independent scripted retry",
    visits: entries.length,
    variations: Object.fromEntries(["control", "recovery"].map(variant => {
      const group = entries.filter(entry => entry.variant === variant);
      return [variant, { exposures: group.length, receipts: group.filter(entry => entry.converted).length }];
    })),
  }, null, 2));
} finally {
  await browser.close();
}
