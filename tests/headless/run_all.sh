#!/usr/bin/env bash
set -euo pipefail

.venv/bin/python3 tests/headless/run_triage_harness.py
.venv/bin/python3 tests/headless/run_compose_harness.py
npm run test:contracts
