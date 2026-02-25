# Repository Guidelines

## Session Start Rule
Before doing other work, read `PERSISTENT_PREFERENCES.md` and apply those preferences.

## Project Structure & Module Organization
This repository is currently in bootstrap state (no source tree yet). Use the structure below as the default layout when adding code:
- `src/` application or library source code
- `tests/` automated tests mirroring `src/` module paths
- `assets/` static files (images, fixtures, sample data)
- `docs/` design notes, ADRs, and onboarding docs

Keep modules small and focused. Prefer feature-based folders (for example, `src/auth/`, `src/api/`) over large utility dumps.

## Build, Test, and Development Commands
No build system is configured yet. After toolchain setup, expose consistent commands through a single entry point (`Makefile` or package scripts). Recommended baseline:
- `make setup` installs dependencies
- `make test` runs the full test suite
- `make lint` runs formatting/lint checks
- `make dev` starts local development mode

Until then, use:
- `git status` to verify local changes
- `git diff` to review edits before committing

## Coding Style & Naming Conventions
Use 4 spaces for Python files and 2 spaces for JS/TS/JSON/YAML. Keep line length near 100 characters.
- Files/modules: `snake_case` (Python), `kebab-case` (web/config)
- Classes/types: `PascalCase`
- Functions/variables: `snake_case` (Python) or `camelCase` (JS/TS)

Adopt language-native formatters/linters as soon as the stack is chosen (for example, `ruff`/`black` or `eslint`/`prettier`) and run them in CI.

## Testing Guidelines
Place tests in `tests/` with names like `test_<module>.py` or `<module>.test.ts`. Prefer deterministic unit tests first, then add integration tests for cross-module flows. Target meaningful coverage for changed code (aim for at least 80% on new modules).

## Commit & Pull Request Guidelines
No historical commit convention exists yet. Start with Conventional Commits:
- `feat: add user session manager`
- `fix: handle empty config file`

PRs should include:
- clear summary of behavior changes
- linked issue/task (if available)
- test evidence (commands run and results)
- screenshots/log excerpts for UI or workflow changes

## Cursor Cloud specific instructions

### Overview
This is a Chrome Manifest V3 extension ("Gmail Hard Reskin" / "Mailita") that overlays Gmail with a custom UI. There is no backend — it is purely client-side.

### Key commands
All npm scripts are in `package.json`:
- `npm run dev` — WXT dev server with hot-reload (opens a Chrome window with the extension loaded)
- `npm run build` — production build to `.output/chrome-mv3/`
- `npm run typecheck` — TypeScript type-check (`tsc --noEmit`); has pre-existing errors because `tsconfig.json` does not extend `.wxt/tsconfig.json`
- `npm run test:headless` — runs both Playwright harnesses (Python-based, requires `.venv`)

### Python venv for headless tests
The Playwright test harnesses require a Python venv at `.venv/`. To recreate:
```
python3 -m venv .venv
.venv/bin/pip install playwright
.venv/bin/playwright install --with-deps chromium
```
The system package `python3.12-venv` must be installed first (`sudo apt-get install -y python3.12-venv`).

### Manual testing
To test the extension manually in Chrome:
1. Load unpacked from the repo root (`/workspace`) at `chrome://extensions`
2. Navigate to `https://mail.google.com/mail/u/0/#inbox` (requires a logged-in Gmail account)
3. The extension's custom "Mailita" overlay should mount automatically

### Known caveats
- `npm run typecheck` fails with pre-existing errors (`defineBackground`, `defineContentScript` not found, `extensionApi` unknown). The project `tsconfig.json` does not reference WXT's generated types in `.wxt/tsconfig.json`.
- The chat headless test (`run_chat_harness.py`) has a pre-existing timeout failure; the triage harness passes.
- `npm run dev` launches a Chrome window via WXT — this works in the cloud VM's desktop environment.
- Gmail login credentials are needed to exercise the extension end-to-end in the browser.
