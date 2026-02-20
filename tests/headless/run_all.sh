#!/usr/bin/env bash
set -euo pipefail

.venv/bin/python tests/headless/run_triage_harness.py
.venv/bin/python tests/headless/run_chat_harness.py
