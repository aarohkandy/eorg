#!/usr/bin/env bash
set -euo pipefail

.venv/bin/python3 tests/headless/run_triage_harness.py
.venv/bin/python3 tests/headless/run_chat_harness.py
.venv/bin/python3 tests/headless/run_compose_harness.py
.venv/bin/python3 tests/headless/run_reply_harness.py
.venv/bin/python3 tests/headless/run_pagination_harness.py
