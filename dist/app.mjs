import { confirmed, fresh, interrupted, restore, sendToDemoService, startSend } from "./flow.mjs";
import { receiptStore } from "./receipts.mjs";
import { connect } from "./flags.mjs";

const $ = id => document.getElementById(id);
const field = $("reason");
const form = $("application-form");
const feedback = $("feedback");
const config = globalThis.DRAFTBRIDGE_CONFIG;
const preview = !config?.environmentKey || new URLSearchParams(location.search).get("experiment") !== "1";
document.body.classList.toggle("experiment-mode", !preview);
const storeKey = preview ? "draftbridge-preview-v1" : `draftbridge-experiment-${config.environmentKey}-v1`;
const createId = () => crypto.randomUUID();
let storageWorks = true;
let saved;
try {
  saved = JSON.parse(localStorage.getItem(storeKey));
} catch {
  // A new draft can still be edited when storage is unavailable.
}
let state = restore(saved, createId());
let client;
let loading;
let syncing = false;

function persist() {
  try {
    localStorage.setItem(storeKey, JSON.stringify(state));
    storageWorks = true;
  } catch {
    storageWorks = false;
  }
  $("save-note").textContent = storageWorks
    ? "Draft saved on this device"
    : "Draft kept in this tab. Leave it open.";
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showFeedback(shouldFocus) {
  feedback.replaceChildren();
  const kind = state.phase;
  feedback.classList.toggle("hidden", kind !== "interrupted" && kind !== "received");
  feedback.dataset.kind = kind === "received" ? "success" : "warning";
  if (kind === "received") {
    feedback.append(element("h3", "Demo receipt confirmed"),
      element("p", "The practice service received this application."),
      element("code", state.receipt.number, "receipt"));
  } else if (kind === "interrupted") {
    if ((state.exposure?.variant ?? state.variant) === "recovery") {
      feedback.append(element("h3", "Connection interrupted"),
        element("p", storageWorks ? "Your draft is saved on this device." : "Your draft is kept in this tab. Leave it open."),
        element("p", "The service may already have your application. Reconnect, then check for your receipt or resend it safely."));
      const resume = element("button", "Check & retry", "primary");
      resume.type = "button";
      resume.addEventListener("click", submit);
      feedback.append(resume);
    } else {
      feedback.append(element("h3", "Something went wrong"),
        element("p", "We couldn't finish the request. Please try again."));
      const retry = element("button", "Try again", "text-button");
      retry.type = "button";
      retry.addEventListener("click", submit);
      feedback.append(retry);
    }
  }
  if (shouldFocus && ["interrupted", "received"].includes(kind)) feedback.focus();
}

function render(shouldFocus = false) {
  const kind = state.phase;
  const variant = state.exposure?.variant ?? state.variant;
  $("status-pill").dataset.state = kind;
  $("status-pill").textContent = {
    draft: storageWorks ? "Draft on this device" : "Draft in this tab",
    sending: "Sending…", interrupted: "Send interrupted", received: "Receipt confirmed",
  }[kind];
  if (field.value !== state.reason) field.value = state.reason;
  field.readOnly = kind !== "draft";
  $("count").textContent = `${field.value.length}/280`;
  $("send").classList.toggle("hidden", kind !== "draft" && kind !== "sending");
  $("send").disabled = kind === "sending";
  $("send").textContent = kind === "sending" ? "Sending…" : "Send application";
  $("variant-controls").disabled = !preview || kind !== "draft";
  $("fault").disabled = !preview || kind !== "draft";
  $("reset").disabled = kind === "sending";
  $("fault").value = state.fault;
  for (const radio of form.ownerDocument.querySelectorAll("[name='variant']")) {
    radio.checked = radio.value === variant;
  }
  showFeedback(shouldFocus);
  $("activity").replaceChildren(...state.activity.slice(-5).map(item => {
    const row = element("li", "");
    const time = new Date(item.time);
    row.append(element("time", time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })), item.label);
    return row;
  }));
}

function metric() {
  if (syncing || !client || !state.pendingMetric || !navigator.onLine) return;
  syncing = true;
  const identity = state.id;
  try {
    client.convert(state.completedAt - state.exposure.time, state.attempt - 1);
    // Hand off once to the SDK buffer. Its flush is best-effort.
    state = { ...state, pendingMetric: false };
    persist();
    void client.flush().catch(() => {});
  } catch {
    // Retain the pending conversion if the SDK rejected the call.
  } finally {
    if (state.id === identity) syncing = false;
  }
}

function refreshMode() {
  $("mode-badge").textContent = preview ? "Local preview" : client?.assignment() ? "Flagsmith connected" : loading ? "Connecting" : "Flagsmith unavailable";
  $("mode-note").textContent = preview ? "Events stay in this browser in preview mode."
    : "Use fictional details. Draft text stays on this device. Flagsmith receives pseudonymous experiment events.";
}

function loadExperiment() {
  if (preview || loading || !navigator.onLine) return;
  const id = state.id;
  loading = connect(config, id).then(service => {
    if (state.id === id) client = service;
  }).catch(() => {}).finally(() => {
    if (state.id === id) {
      loading = null;
      refreshMode();
      metric();
    }
  });
  refreshMode();
}

async function canReachDemoService() {
  if (!navigator.onLine) return false;
  try {
    const response = await fetch("./icon.svg", {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function submit() {
  if (["sending", "received"].includes(state.phase)) return;
  if (!form.reportValidity() || field.value.trim().length < 10) {
    field.setCustomValidity("Enter at least 10 characters.");
    field.reportValidity();
    return;
  }
  const fault = state.attempt === 0 ? state.fault : "none";
  state = startSend(state);
  persist();
  render();
  let result;
  try {
    result = await sendToDemoService({ id: state.id, reason: state.reason, fault, online: await canReachDemoService(), repo: receiptStore });
  } catch {
    result = { failure: "Demo receipt storage unavailable" };
  }
  let assignment;
  if (result.receipt) {
    state = confirmed(state, result.receipt);
  } else {
    assignment = !state.exposure && client?.assignment();
    state = interrupted(state, assignment || { variant: preview ? state.variant : "control", source: "local" }, result.failure);
  }
  persist();
  render(true);
  if (assignment?.source === "flagsmith") {
    try {
      client.expose(assignment);
      if (navigator.onLine) void client.flush().catch(() => {});
    } catch {
      state.exposure.source = "local";
      persist();
    }
  }
  metric();
}

field.addEventListener("input", () => {
  field.setCustomValidity("");
  state = { ...state, reason: field.value };
  persist();
  $("count").textContent = `${field.value.length}/280`;
});
form.addEventListener("submit", event => {
  event.preventDefault();
  void submit();
});
$("variant-controls").addEventListener("change", event => {
  state = { ...state, variant: event.target.value };
  persist();
  render();
});
$("fault").addEventListener("change", event => {
  state = { ...state, fault: event.target.value };
  persist();
});
$("reset").addEventListener("click", () => {
  state = fresh(createId());
  field.setCustomValidity("");
  persist();
  render();
  field.focus();
});
window.addEventListener("online", () => {
  if (!client) loadExperiment();
  else void client.flush().catch(() => {});
  metric();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && client && navigator.onLine) void client.flush().catch(() => {});
});
if (!preview) $("reset").hidden = true;
persist();
render();
refreshMode();
loadExperiment();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
