# DraftBridge · Toggle Wars

- **Entrant** Aditya Singhal
- **Track** 01 · Test Something Real
- **Repository** https://github.com/ADI238IND/draftbridge
- **Interactive demo** https://adi238ind.github.io/draftbridge/
- **Live experiment** https://adi238ind.github.io/draftbridge/?experiment=1
- **Demo video** https://github.com/ADI238IND/draftbridge/blob/main/DraftBridge_Demo.mp4

A student presses Send on a travel-grant form. The network drops, and the portal can't say whether the service received it. DraftBridge compares a generic retry prompt with a guided recovery screen that confirms what has been saved, explains the uncertainty, and offers one action to find the original receipt or send safely. Both versions use the same offline draft and duplicate-safe receipt logic.

Flagsmith's multivariate flag selects the recovery screen and records exposure when that screen appears. The primary metric is a confirmed receipt within two minutes, with time and retries as secondary metrics. The A/B experiment is running in a dedicated Flagsmith Cloud Development environment. In the development run, Flagsmith accepted 24 synthetic exposures and 18 confirmed receipts. Standard recorded 10 of 14 and Guided recorded 8 of 10. The retry rule was the same for both arms. A participant study is needed to estimate the effect of the guided screen.

**Suggested judge walkthrough**

1. Preview A with a drop before arrival. Reload to verify the draft survives.
2. Preview B with a lost receipt. Check and retry to receive the original receipt.
3. Run the tests to reproduce the recovery, offline, keyboard, and event verification scenarios.

**What I would test with participants**

Give each participant the same fictional application and the same failure. Do not explain the retry flow in advance. Assign one arm per participant and compare confirmed receipts within two minutes. Run synthetic traffic in a separate environment to verify telemetry before collecting human data.
