import { FLAG, METRIC, WINDOW_MS } from "./flow.mjs";

export async function connect(config, identity, importClient = url => import(url)) {
  if (!config?.environmentKey) return null;
  const { createFlagsmithInstance } = await importClient(config.sdkUrl || "./vendor/flagsmith.mjs");
  const sdk = createFlagsmithInstance();
  await sdk.init({
    environmentID: config.environmentKey,
    identity: `draftbridge-${identity}`,
    enableEvents: true,
    ...(config.apiUrl ? { api: config.apiUrl } : {}),
    ...(config.eventsUrl ? { eventProcessorConfig: { eventsApiUrl: config.eventsUrl } } : {}),
  });
  return {
    assignment() {
      const flag = sdk.getAllFlags()[FLAG];
      if (!flag?.enabled || !["control", "recovery"].includes(flag.value)) return null;
      return {
        variant: flag.value,
        source: flag.experiment?.inExperiment && flag.variant ? "flagsmith" : "remote",
        variationKey: flag.variant,
        experimentId: flag.experiment?.id,
      };
    },
    expose(assignment) {
      if (assignment.source === "flagsmith") {
        sdk.trackExposureEvent(FLAG, {
          value: assignment.variationKey,
          metadata: { experiment_id: assignment.experimentId },
        });
      }
    },
    convert(elapsedMs, retries) {
      if (elapsedMs <= WINDOW_MS) sdk.trackEvent(METRIC);
      sdk.trackEvent("draftbridge_time_to_receipt_ms", { value: elapsedMs });
      sdk.trackEvent("draftbridge_retries_to_receipt", { value: retries });
    },
    flush() {
      return sdk.flushEvents();
    },
  };
}
