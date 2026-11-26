import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { before, after, test } from "node:test";

const require = createRequire(import.meta.url);
const playwright = process.env.DRAFTBRIDGE_PLAYWRIGHT || "playwright";
const { chromium } = require(playwright);
let browser, server, base;

before(async () => {
  server = spawn(process.execPath, ["scripts/serve.mjs", "--port", "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const [output] = await once(server.stdout, "data");
  base = output.toString().trim().split(" ").at(-1);
  browser = await chromium.launch({
    ...(process.env.DRAFTBRIDGE_CHROMIUM ? { executablePath: process.env.DRAFTBRIDGE_CHROMIUM } : {}),
    args: ["--no-sandbox"],
  });
});
after(async () => {
  await browser?.close();
  server?.kill();
});

async function scenario(callback, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  try {
    return await callback(page, context);
  } finally {
    await context.close();
  }
}

async function open(page) {
  await page.goto(base);
  await page.getByRole("button", { name: "Send application" }).waitFor();
}

for (const [screen, heading, action] of [
  ["A Standard", "Something went wrong", "Try again"],
  ["B Guided", "Connection interrupted", "Check & retry"],
]) {
  for (const fault of ["drop", "ack"]) {
    test(`${screen} recovers from ${fault} and retains its receipt after reload`, () => scenario(async page => {
      await open(page);
      await page.getByRole("radio", { name: screen }).check();
      await page.locator("#fault").selectOption(fault);
      await page.locator("#reason").fill("Sample text kept after a connection loss.");
      await page.getByRole("button", { name: "Send application" }).click();
      await page.getByRole("heading", { name: heading }).waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.id), "feedback");
      await page.reload();
      await page.getByRole("heading", { name: heading }).waitFor();
      assert.equal(await page.locator("#reason").inputValue(), "Sample text kept after a connection loss.");
      await page.getByRole("button", { name: action }).click();
      await page.getByRole("heading", { name: "Demo receipt confirmed" }).waitFor();
      const original = await page.locator(".receipt").textContent();
      assert.match(original, /^DB-[A-F0-9]{32}$/);
      const stored = await page.evaluate(async () => {
        const { receiptStore } = await import("./receipts.mjs");
        const saved = JSON.parse(localStorage.getItem("draftbridge-preview-v1"));
        const receipts = await Promise.all([receiptStore.receive(saved.id, saved.reason), receiptStore.receive(saved.id, saved.reason)]);
        return receipts.map(r => r.number);
      });
      assert.deepEqual(stored, [original, original]);
      await page.reload();
      assert.equal(await page.locator(".receipt").textContent(), original);
    }));
  }
}

test("normal send is immediate and does not show the experiment", () => scenario(async page => {
  await open(page);
  await page.locator("#fault").selectOption("none");
  await page.getByRole("button", { name: "Send application" }).click();
  await page.getByRole("heading", { name: "Demo receipt confirmed" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Connection interrupted" }).count(), 0);
}));

test("invalid input remains editable without an exposure", () => scenario(async page => {
  await open(page);
  const reason = page.locator("#reason");
  await reason.fill("Short");
  await page.getByRole("button", { name: "Send application" }).click();
  assert.equal(await reason.getAttribute("readonly"), null);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("draftbridge-preview-v1")).attempt), 0);
}));

test("a warmed browser reloads fully offline, saves text, and recovers once reconnected", () => scenario(async (page, context) => {
  await open(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.locator("#reason").fill("This change was saved while the browser was offline.");
  await page.getByRole("button", { name: "Send application" }).click();
  await page.getByRole("heading", { name: "Connection interrupted" }).waitFor();
  await page.getByRole("button", { name: "Check & retry" }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#activity li")).filter(row => row.textContent.includes("Offline on this device")).length === 2);
  assert.equal(await page.getByRole("heading", { name: "Connection interrupted" }).count(), 1);
  await context.setOffline(false);
  await page.getByRole("button", { name: "Check & retry" }).click();
  await page.getByRole("heading", { name: "Demo receipt confirmed" }).waitFor();
  assert.match(await page.locator("#reason").inputValue(), /offline/);
}));

test("mobile keyboard navigation stays within the viewport", () => scenario(async page => {
  await open(page);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth === innerWidth);
  assert.equal(fits, true);
  await page.getByRole("button", { name: "Send application" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Connection interrupted" }).waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Check & retry");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Demo receipt confirmed" }).waitFor();
}, { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true }));

test("the real SDK delivers an exposure and conversion with the same ID to a test endpoint", () => scenario(async (page, context) => {
  const payloads = [];
  await context.route("**/config.js", route => route.fulfill({ contentType: "text/javascript",
    body: `globalThis.DRAFTBRIDGE_CONFIG={environmentKey:"fixture",apiUrl:"${base}mock/api/v1/",eventsUrl:"${base}mock/api/"};` }));
  await context.route("**/mock/api/v1/identities/**", route => {
    const identifier = new URL(route.request().url()).searchParams.get("identifier");
    return route.fulfill({ json: { identifier, traits: [], flags: [{
      feature: { id: 1, name: "draftbridge_recovery" }, enabled: true,
      feature_state_value: "recovery", variant: "guided",
      metadata: { experiment: { id: 57, name: "Recovery", in_experiment: true } },
    }] } });
  });
  await context.route("**/mock/api/v1/events**", route => {
    payloads.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, json: {} });
  });
  await page.goto(new URL("?experiment=1", base).href);
  await page.getByText("Flagsmith connected", { exact: true }).waitFor();
  assert.equal(payloads.length, 0);
  await page.getByRole("button", { name: "Send application" }).click();
  await page.getByRole("heading", { name: "Connection interrupted" }).waitFor();
  await page.getByRole("button", { name: "Check & retry" }).click();
  await page.getByRole("heading", { name: "Demo receipt confirmed" }).waitFor();
  for (let attempt = 0; attempt < 50 && !JSON.stringify(payloads).includes("draftbridge_receipt_within_120s"); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.match(JSON.stringify(payloads), /\$flag_exposure/);
  assert.match(JSON.stringify(payloads), /draftbridge_receipt_within_120s/);
  const events = payloads.flatMap(payload => Array.isArray(payload) ? payload : payload.events);
  assert.ok(events.length >= 4);
  const identities = events.map(event => event.identifier);
  assert.equal(new Set(identities).size, 1);
  assert.match(identities[0], /^draftbridge-[a-f0-9-]+$/);
  assert.match(JSON.stringify(events[0]), /"experiment_id":57/);
  assert.doesNotMatch(JSON.stringify(events), /bus fare/);
}, { serviceWorkers: "block" }));
