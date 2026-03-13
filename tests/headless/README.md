# Headless Verification Harness

This folder contains local Playwright harnesses used to validate the extension logic without manual Gmail clicking.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install playwright
.venv/bin/playwright install chromium
```

## Run

```bash
bash tests/headless/run_all.sh
```

The CI-aligned deterministic subset currently runs:

```bash
.venv/bin/python3 tests/headless/run_triage_harness.py
.venv/bin/python3 tests/headless/run_compose_harness.py
npm run test:contracts
```

Legacy exploratory harnesses (`run_chat_harness.py`, `run_reply_harness.py`,
`run_pagination_harness.py`) remain in-tree for local debugging but are not in the default
deterministic run path.
