# Findings Resolution Log

## Cycle 2026-03-11

### F-001 (P0) Duplicate manifest runtime ambiguity (`/manifest.json` vs `apps/extension/manifest.json`)
- Resolution:
  - Kept `apps/extension/manifest.json` as canonical runtime manifest.
  - Updated root `manifest.json` to delegate all runtime assets to `apps/extension/*`.
  - Removed legacy `web_accessible_resources` from both manifests.
- Evidence:
  - `manifest.json`
  - `apps/extension/manifest.json`
  - `tests/contracts/verify_runtime_contracts.mjs`

### F-002 (P0) Legacy page-world injection still active in service worker
- Resolution:
  - Removed `inboxsdk__injectPageWorld` message path and `chrome.scripting.executeScript` injection.
  - Removed `scripting` permission from manifests.
- Evidence:
  - `apps/extension/background/service-worker.js`
  - `manifest.json`
  - `apps/extension/manifest.json`
  - `tests/contracts/verify_runtime_contracts.mjs`

### F-003 (P1) Backend endpoint must be pinned to Render production URL
- Resolution:
  - Added runtime contract check asserting `BACKEND_URL` equals
    `https://email-bcknd.onrender.com`.
- Evidence:
  - `apps/extension/background/service-worker.js`
  - `tests/contracts/verify_runtime_contracts.mjs`

### F-004 (P1) Client credential handling must avoid app-password persistence
- Resolution:
  - Added contract checks asserting no `appPassword` writes to `chrome.storage`/`localStorage`.
  - Verified connect inputs are cleared in popup and Gmail-inject flows.
- Evidence:
  - `apps/extension/content/gmail-inject.js`
  - `apps/extension/popup/popup.js`
  - `tests/contracts/verify_runtime_contracts.mjs`

### F-005 (P2) Backend logs expose full email addresses
- Resolution:
  - Masked email addresses in IMAP/auth logs to reduce credential-adjacent leakage.
- Evidence:
  - `apps/backend/lib/imap.js`
  - `apps/backend/routes/auth.js`

### F-006 (P1) Onboarding guide could present stale/incorrect CTA target
- Resolution:
  - Added step-resolution helpers so UI step selection adapts to context/evidence.
  - Disabled "Take me there" buttons when already on target page and clarified hint copy.
  - Fixed external guide CTA to navigate using resolved step data, not hardcoded app-password path.
- Evidence:
  - `apps/extension/content/gmail-inject.js`
  - `apps/extension/content/styles.css`

### F-007 (P1) Popup onboarding step numbering and auto-progress mismatch
- Resolution:
  - Corrected popup headings to 4-step flow.
  - Added app-password pattern detector in popup input to auto-confirm guide progress.
- Evidence:
  - `apps/extension/popup/popup.html`
  - `apps/extension/popup/popup.js`

### F-008 (P1) Connect failure response mapping lacked user-actionable status/retry semantics
- Resolution:
  - Added `buildConnectFailure()` to map IMAP/auth/folder/network failures into consistent
    HTTP status + retry metadata.
  - Wired auth connect route to use mapped failures.
  - Added unit tests for mapping behavior.
- Evidence:
  - `apps/backend/lib/errors.js`
  - `apps/backend/routes/auth.js`
  - `apps/backend/lib/errors.test.js`

## Cycle 2026-03-12

### F-009 (P1) Onboarding complexity/regression risk (legacy IMAP + app-password generation steps still active)
- Resolution:
  - Simplified active onboarding model to two steps only: `welcome` and `connect_account`.
  - Added runtime migration handling in guide state normalization to safely map legacy 4-step states.
  - Kept `CONNECT` contract unchanged (`{ email, appPassword }`) and ensured password fields clear after submit attempts.
- Evidence:
  - `apps/extension/background/service-worker.js`
  - `apps/extension/content/gmail-inject.js`
  - `apps/extension/popup/popup.js`
  - `apps/extension/popup/popup.html`

### F-010 (P1) Removed onboarding features still left runtime baggage (spotlight/highlight + external setup helper)
- Resolution:
  - Removed spotlight/highlight runtime path and CSS artifacts.
  - Removed external Google Account onboarding surface and restricted content-script scope to Gmail only.
- Evidence:
  - `apps/extension/content/gmail-inject.js`
  - `apps/extension/content/styles.css`
  - `apps/extension/manifest.json`
  - `manifest.json`
  - `wxt.config.ts`
  - `src/entrypoints/content.ts`

### F-011 (P1) Contract coverage gap for simplified onboarding
- Resolution:
  - Extended runtime contract tests to assert:
    - two-step guide model only
    - no legacy `enable_imap` / `generate_app_password` in active overlay/popup flows
    - no spotlight runtime/CSS path
    - `CONNECT` payload remains `{ email, appPassword }`
    - Gmail-only content-script scope
- Evidence:
  - `tests/contracts/verify_runtime_contracts.mjs`
