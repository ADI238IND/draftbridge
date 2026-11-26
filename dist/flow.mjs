export const METRIC = "draftbridge_receipt_within_120s";
export const WINDOW_MS = 120_000;
export const FLAG = "draftbridge_recovery";
export const SAMPLE = "The grant would help cover my bus fare to campus this semester.";

export function fresh(id, now = Date.now()) {
  return { id, reason: SAMPLE, attempt: 0, phase: "draft", variant: "recovery",
    fault: "drop", exposure: null, receipt: null, completedAt: null,
    pendingMetric: false, activity: [{ time: now, label: "Sample draft ready" }] };
}

export function log(state, label, time = Date.now()) {
  return { ...state, activity: [...state.activity.slice(-15), { label, time }] };
}

export function startSend(state, now = Date.now()) {
  if (state.phase === "received") return state;
  return log({ ...state, attempt: state.attempt + 1, phase: "sending" },
    state.attempt ? "Retry requested" : "Application send started", now);
}

export function interrupted(state, assignment, fault, now = Date.now()) {
  if (state.phase !== "sending") return state;
  const exposure = state.exposure ?? { variant: assignment.variant, source: assignment.source, time: now };
  const updated = { ...state, phase: "interrupted", exposure };
  if (!state.exposure) {
    const arm = assignment.variant === "recovery" ? "B · Guided" : "A · Standard";
    return log(updated, `${arm} shown · ${fault}`, now);
  }
  return log(updated, fault, now);
}

export function confirmed(state, receipt, now = Date.now()) {
  if (state.phase !== "sending") return state;
  const elapsed = state.exposure ? now - state.exposure.time : null;
  const pendingMetric = state.exposure?.source === "flagsmith" && elapsed !== null && elapsed >= 0;
  return log({ ...state, phase: "received", receipt, completedAt: now, pendingMetric },
    `Demo receipt confirmed${elapsed === null ? "" : ` · ${(elapsed / 1000).toFixed(1)}s`}`, now);
}

export async function sendToDemoService({ id, reason, fault, online, repo }) {
  if (!online) return { failure: "Offline on this device" };
  if (fault === "drop") return { failure: "Connection dropped before arrival" };
  const receipt = await repo.receive(id, reason);
  if (fault === "ack") return { failure: "Connection dropped after arrival" };
  return { receipt };
}

export function restore(saved, id, now = Date.now()) {
  if (!saved || typeof saved.reason !== "string" || typeof saved.id !== "string" ||
      !Array.isArray(saved.activity) || !["draft","sending","interrupted","received"].includes(saved.phase)) {
    return fresh(id, now);
  }
  if (saved.phase === "sending") {
    return log({ ...saved, phase: "interrupted" }, "Send interrupted by page reload", now);
  }
  return saved;
}
