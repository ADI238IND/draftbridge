# DraftBridge

**When the signal drops, the draft stays.**

A student has finished a travel-grant form and pressed Send. The connection drops. Has the service received it? Will retrying send it twice? DraftBridge is a working, offline-capable practice application that tests which recovery screen helps the student finish.

Toggle Wars · Track 01, **Test Something Real** · Aditya Singhal

## Try it

[Open the interactive demo](https://adi238ind.github.io/draftbridge/) · [Watch the 55-second walkthrough](./DraftBridge_Demo.mp4)

Run the demo locally with Node.js 22+.

```sh
npm run dev
```

Open **http://127.0.0.1:4173**. Use sample details only.

1. Choose **A Standard** and **Drop before arrival**. Send, reload while the error is visible, then try again. The edited draft survives.
2. Reset. Choose **B Guided** and **Lose receipt after arrival**. Send, then choose **Check & retry**. The simulated receiving service returns the receipt it created on the first attempt.
3. Choose **Keep connection stable** to see how an uninterrupted send skips the recovery experiment. To test real disconnection, first open the site online and let the service worker install. Then use your browser's Offline setting and reload.

A real receiving service can implement the same pattern with a database uniqueness constraint on the submission ID. This prototype simulates the service with transactional IndexedDB in the browser. The app shell is cached by a service worker, draft text is cached locally, and the receipt store keeps a fingerprint to detect changes under the same submission ID. Draft text and document content never enter Flagsmith events.

## The experiment

**Hypothesis.** Telling applicants that their draft is saved, explaining that a send may have reached the service, and giving them a clear recovery action will raise the chance of a confirmed receipt within 120 seconds.

| Design element | Choice |
| --- | --- |
| Variation A | Generic error and a retry link-style button |
| Variation B | Draft status, delivery uncertainty, and one explicit Check & retry button |
| Randomization | Flagsmith, 50/50 by pseudonymous session ID |
| Enrollment | First display of a recovery screen after an interrupted send |
| Primary metric | Unique exposed identities firing `draftbridge_receipt_within_120s` |
| Secondary metrics | Time and retries among confirmed applications, which exclude unsuccessful sessions |
| Invariant | Identical draft, network scenario, and receipt-engine behavior in both arms |

The browser emits exposure at first display, not when loading flags. It emits a conversion only after receiving an actual demo receipt within the window. The retry action itself never counts as conversion. Timeout is measured locally from first display. If analytics delivery is interrupted, the SDK flush is best effort. Compare missing-data rates before interpreting a real rollout.

## Connect Flagsmith Experimentation

1. In a dedicated Flagsmith environment, connect the warehouse in **Environment Settings → Warehouse**.
2. Create the multivariate flag `draftbridge_recovery`. Enable it, use string value `control` for the base, and add a variation with key and value `recovery`. Configure the experiment to split the enabled flag 50/50 with 100% enrollment.
3. Create an event-based unique-identity conversion metric with the exact event name `draftbridge_receipt_within_120s`. Set the expected direction to increase. Optionally register `draftbridge_time_to_receipt_ms` and `draftbridge_retries_to_receipt` as numeric event metrics.
4. Set **only** the client-side environment key in [dist/config.js](dist/config.js). For self-hosting, also set the SDK flags API URL and event ingestion URL. Admin and server keys must remain out of the browser.
5. Start the experiment. Open the configured app in a new browser profile with `?experiment=1`, wait for **Flagsmith connected**, send the sample application, and retry. Use a fresh profile for each synthetic identity. Verify in the Flagsmith dashboard that exposure and conversion share the same identity. The [official SDK guide](https://docs.flagsmith.com/experimentation/run-an-experiment) documents the exposure and flush behavior.
6. Use a separate environment for synthetic traffic. Run the same browser script or task instructions on both variants. Review assignment balance, event delivery, and whether the uncertainty supports a rollout decision. Leave the experiment open if evidence is insufficient.

Open the configured app with `?experiment=1` to join its Flagsmith experiment. The default URL opens a separate preview session with manual variant and fault controls. No analytics leave the browser in preview mode.

## Reproduce the checks

```sh
npm test
npm install
npx playwright install chromium
npm run test:browser
```

All 12 unit checks and 9 Chromium checks passed on three consecutive runs. Unit tests cover draft recovery, deduplication behavior, exposure attribution, and the conversion boundary. Browser tests drive both layouts, reload while offline, check keyboard and mobile behavior, and exercise the official Flagsmith SDK against a controlled endpoint that verifies the event payload. The product hypothesis needs participant data. Scripted recovery checks demonstrate functional behavior.

## References

- [Toggle Wars rules](https://www.wemakedevs.org/hackathons/flagsmith/rules)
- [Ofcom, Exploring digital disadvantage](https://www.ofcom.org.uk/research-and-data/internet-and-on-demand-research/exploring-digital-disadvantage)
- [Flagsmith JavaScript SDK](https://github.com/Flagsmith/flagsmith-js-client), bundled at v12.6.0 with its [license notice](dist/vendor/FLAGSMITH-LICENSE.txt).
