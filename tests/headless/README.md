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
.venv/bin/python3 tests/headless/run_triage_harness.py
.venv/bin/python3 tests/headless/run_chat_harness.py
.venv/bin/python3 tests/headless/run_compose_harness.py
.venv/bin/python3 tests/headless/run_reply_harness.py
```

All scripts exit with code `0` on success.
