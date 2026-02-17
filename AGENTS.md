# Repository Guidelines

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
