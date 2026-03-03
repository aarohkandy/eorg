# EORG Engineering Deep Dive and Handoff

Date: 2026-03-01 (America/Los_Angeles)  
Prepared for: Senior engineering handoff

## 1) Executive summary

This repository is a Chrome Manifest V3 Gmail overlay extension ("Gmail Hard Reskin" / "Mailita") that replaces Gmail's visible UI with a custom shell while still using Gmail's native data and navigation surfaces.

The last two days of implementation (Feb 27-28, 2026) materially changed four areas:

1. Contact-centric thread model: from single-thread view to merged contact timeline (`contact timeline v2`).
2. Reply reliability: hardened send path with structured result contract (`{ ok, stage, reason? }`) and verification.
3. Data hydration depth: aggressive thread expansion + print-view hydration + InboxSDK-assisted discovery.
4. Runtime scheduling/observability: scan preemption and richer debug/event logging.

The current branch is synchronized with `origin/main` at commit `4f038fc`, with additional local uncommitted work in `content.js`, `styles.css`, and `manifest.json`.

## 2) Sequential thinking trace (investigation process)

This handoff was built with an explicit sequential workflow:

1. Baseline and constraints: loaded repo preferences, inspected current working tree and remote sync status.
2. Timeline reconstruction: extracted commit history (local git + GitHub) for Feb 27-28.
3. Implementation mapping: traced changed symbols and runtime paths in `content.js`, `compose.js`, docs, and harnesses.
4. Validation pass: executed headless harnesses and captured pass/fail evidence with exact failure points.
5. External grounding: cross-checked key design decisions using Context7 docs and official web/GitHub sources.
6. Risk synthesis: separated observed facts from inference and produced a concrete handoff plan.

## 3) Current repository state (as of this handoff)

Branch and sync:

- Branch: `main`
- HEAD: `4f038fc`
- Ahead/behind vs `origin/main`: `0/0`

Working tree:

- Modified: `content.js`, `manifest.json`, `styles.css`
- Untracked: `docs/event-log-delays-and-direction.md`

Recent churn (Feb 27 onward, committed):

- Total additions: `32,528`
- Total deletions: `1,581`
- Total churn: `34,109`
- Top churn files: `pageWorld.js` (20,650), `content.js` (9,239), `compose.js` (1,283), `styles.css` (1,061)

Local uncommitted churn:

- `3 files changed, 1024 insertions(+), 472 deletions(-)`

## 4) Project scope and architecture

### 4.1 Product scope

The extension is scoped to Gmail (`*://mail.google.com/*`) and has four major product capabilities:

1. Full UI reskin and navigation shell.
2. Contact-first timeline/chat experience (Inbox + Sent merged).
3. AI-assisted operations (triage, Ask Inbox) with explicit setting/consent controls.
4. Native Gmail action bridging (read/reply/label/send) through DOM + InboxSDK + fallback logic.

### 4.2 Runtime structure

Primary runtime modules:

- `content.js`: app shell lifecycle, extraction, timeline state, render loop, interaction scheduler.
- `compose.js`: Gmail reply acquisition/fill/send verification flow.
- `triage.js`: Gmail label application strategies and fallback.
- `ai.js`: provider settings and model request orchestration.
- `background.js`: page-world script injection path.
- `pageWorld.js`: injected support surface (large dependency/runtime payload).
- `page-debug-bridge.js`: page-context bridge for `ReskinChatDebug`.

Entry/build scaffolding:

- WXT scaffold exists (`src/entrypoints/*`, `wxt.config.ts`), but active runtime still leans on legacy JS stack imported into content script.

### 4.3 Core runtime flows

1. Boot: `waitForReady()` -> `bootstrap()` -> `applyReskin()` -> `ensureRoot()`
2. List extraction: Gmail DOM row/link extraction + mailbox cache.
3. Contact open: `openContactTimelineFromRowV2()` -> timeline build -> render -> async discovery/hydration.
4. Reply send: `submitThreadReply()` -> `ReskinCompose.replyToThread(...)` -> structured stage result.
5. Scan loop: `scheduleMailboxScanKick()` + `runFullMailboxScan()` with interaction-epoch preemption.

## 5) What was implemented in the last couple of days

Time window analyzed: Feb 27-28, 2026 (4 commits on `main`).

### Commit 1: `c02544e` (2026-02-27 14:20:54 -0800)

Message: `feat: Discord-style thread view, body extraction, multi-message and iframe fixes`

Observed implementation:

- Introduced cleaner chat-style thread rendering and contact grouping behavior.
- Expanded body extraction fallbacks across message containers and iframes.
- Improved dedupe/sorting of merged messages.
- Added/updated thread reply documentation (`docs/thread-reply.md`).

Primary touched files:

- `content.js`, `compose.js`, `styles.css`, `manifest.json`, `PERSISTENT_PREFERENCES.md`, `docs/thread-reply.md`

Impact:

- Shift from thread-subject-centric view toward contact-centric conversation UX.
- Better resilience when Gmail message bodies are nested/obfuscated.

### Commit 2: `83b4ad1` (2026-02-27 18:52:11 -0800)

Message: `cooking at the start.`

Observed implementation (inferred from added symbols/files):

- Major hardening of send flow in `compose.js`:
  - staged context acquisition,
  - send-button detection/fallbacks,
  - structured result semantics.
- Added optimistic message and draft reconciliation paths in `content.js`.
- Expanded full mailbox scan architecture (`scanMailboxPages`, queueing).
- Added headless harnesses:
  - `run_compose_harness.py`,
  - `run_reply_harness.py`,
  - `run_pagination_harness.py`.

Impact:

- This commit appears to be the reliability foundation pass for send + scan + test infrastructure.

### Commit 3: `f17baaa` (2026-02-28 00:26:57 -0800)

Message: `Implement contact chat view`

Observed implementation:

- Added conversation-context primitives in `content.js`:
  - account/contact context,
  - message party snapshotting,
  - `messageBelongsToConversation(...)`.
- Added debug bridge surface:
  - `page-debug-bridge.js`,
  - `ReskinChatDebug` exposure and dump APIs.
- Strengthened contact grouping and canonical thread normalization paths.
- Updated `compose.js` send evidence checks (`waitForSendCompletion` refinements).

Impact:

- Contact chat view moved from concept into concrete runtime path with debugging hooks.

### Commit 4: `4f038fc` (2026-02-28 20:20:51 -0800, current HEAD)

Message: `feat: deep thread expansion, body settle wait, and deep-hydration state guard`

Observed implementation:

- Contact timeline v2 deep hydration guard:
  - prevents shallow refresh from overwriting deep hydrated timeline state.
- Expanded thread extraction and hydration orchestration:
  - stronger collapsed-thread expansion selectors and waits,
  - hydration race controls.
- Introduced scan preemption/scheduler controls:
  - interaction epoch,
  - cooperative pause/queue model.
- Added MV3 background service worker + `pageWorld.js` injection path.

Impact:

- Biggest operational shift in this window: higher hydration depth with explicit race/safety controls.

## 6) In-progress (uncommitted) implementation

Local uncommitted changes appear to be an observability + responsiveness pass.

### `content.js` (major WIP)

Key observed deltas:

1. Shadow-root centralization:
   - `getRoot()` and `_shadowHost/_shadowRoot` references used broadly to avoid direct `document.getElementById(ROOT_ID)` dependence.
2. Event log panel:
   - in-app event buffer + flush pipeline (`EVENT_LOG_MAX`, `logEvent`, `logTimed`, DOM render list).
3. Discovery timing improvements:
   - pending discovery queue when InboxSDK is not ready.
   - immediate discovery kick from `openContactTimelineFromRowV2(...)`.
4. Direction/account fixes:
   - ensures `activeAccountEmail` and `activeContactEmail` are set before timeline build/hydration.
5. Bootstrap scan delay fix:
   - startup scan kick moved to explicit `setTimeout(..., 500)` to avoid idle-callback drift.
6. Retry pacing adjustment:
   - `THREAD_READY_RETRY_BASE_MS` reduced from `260` to `80`.

### `styles.css`

- Added sidebar event log UI blocks:
  - `.rv-event-logs`, `.rv-event-logs-head`, `.rv-event-logs-list`, `.rv-event-log-entry`.

### `manifest.json`

- Version bumped locally to `1.2.19`.
- Added `"unlimitedStorage"` permission.

### `docs/event-log-delays-and-direction.md` (untracked)

- Detailed root-cause analysis and proposed fixes for:
  - delayed discovery start,
  - delayed bootstrap scan kick,
  - message direction/account mismatches,
  - dropped print-view messages.

## 7) Deep dive by subsystem (current code paths)

### 7.1 Shell and lifecycle (`content.js`)

Relevant anchors:

- Mode/config constants and root references around `content.js:120-170`
- `ensureRoot()` around `content.js:3559+`
- boot/observer around `content.js:10262+`

What exists now:

- Overlay runs in Shadow DOM host (`#rv-shadow-host`) with separate style strategy:
  - body-hiding style in document head,
  - app styles as shadow `<link>` to `styles.css`.
- Hash change synchronizes list/thread views and forces rerender path.
- Shadow guardian re-creates shell if host is removed.

Engineering implications:

- Better isolation from Gmail CSS and event propagation.
- A single `getRoot()` path reduces stale root references during SPA churn.

### 7.2 Contact timeline v2 and deep hydration

Relevant anchors:

- `buildActiveContactTimelineV2(...)` around `content.js:7894+`
- `applyActiveContactTimelineV2(...)` around `content.js:7931+`
- `openContactTimelineFromRowV2(...)` around `content.js:8048+`

What exists now:

- Timeline is built from live rows + cached inbox/sent rows + optimistic rows.
- Deep-hydration guard blocks shallow refreshes from shrinking already deep timelines.
- On contact open:
  - active account/contact context is captured early,
  - preferred thread + hint href are established,
  - sent scan and discovery/hydration are kicked asynchronously.

Engineering implications:

- This is now a merged-conversation architecture, not a simple per-thread render.
- Correctness depends heavily on context coherence (`activeAccountEmail`, `activeContactEmail`, `conversationKey`).

### 7.3 Thread discovery and hydration

Relevant anchors:

- `discoverThreadIds(...)` around `content.js:8341+`
- `fetchAndRenderThreads(...)` around `content.js:8452+`
- `extractMessagesFromPrintView(...)` around `content.js:7108+`
- `hydrateThreadFromPrintView(...)` around `content.js:7207+`

What exists now:

- Discovery uses InboxSDK router/search + thread row handlers.
- Hydration resolves thread IDs, checks cache tiers, and fetches Gmail print view when needed.
- Print-view extraction includes sender/date/body parsing and direction assignment.

Engineering implications:

- Data quality for merged timeline now depends on both Gmail DOM extraction and print-view extraction.
- Two-tier cache path improves perceived performance but increases cache invalidation complexity.

### 7.4 Reply send contract and hardened pipeline

Relevant anchors:

- `submitThreadReply(...)` in `content.js` around `3853+`
- `replyToThread(...)` in `compose.js` around `1024+`
- `waitForSendCompletion(...)` in `compose.js` around `937+`

Current contract:

- `content.js` expects `{ ok, stage, reason? }` from `compose.js`.
- Both Send button and Enter route to the same submit handler.

Hardened behavior:

- Thread context acquisition before send.
- Multi-path compose acquisition (existing compose, container open, reply button, keyboard shortcut).
- Send verification by compose closure, visible send indicator, or body evidence.
- Explicit failure staging (`threadContext`, `replyCompose`, `fillBody`, `sendButton`, `sendVerify`, etc.).

Engineering implications:

- This path is now debuggable and diagnosable, not binary pass/fail.
- UI path and Gmail interaction path are correctly decoupled.

### 7.5 Scan scheduler and preemption

Relevant anchors:

- `scheduleMailboxScanKick(...)` around `content.js:5251+`
- `scanMailboxPages(...)` around `content.js:5293+`
- `runFullMailboxScan(...)` around `content.js:5541+`

What exists now:

- Queue-based mailbox scanning with progress state.
- Interaction epoch tokening to preempt scan when user enters active interaction paths.
- Conditional rerender and sent-scan completion hooks into contact timeline refresh.

Engineering implications:

- This addresses contention between background scan and foreground thread interactions.
- Remaining risk is scheduler fairness and race behavior under rapid hash/interaction churn.

### 7.6 Debug bridge and observability

Relevant anchors:

- `buildChatDebugApi()` around `content.js:10372+`
- `installDebugBridgeListener()` around `content.js:10427+`
- `page-debug-bridge.js`

What exists now:

- In content world: debug API and state dump methods.
- In page world: event-based bridge (`reskin:debug:request/response`) exposing the same diagnostics to standard console context.
- In local WIP: event log panel integrated in sidebar.

Engineering implications:

- Significantly faster diagnosis loop for race and extraction issues.

## 8) Test and verification status

Commands executed:

- `npm run test:headless` (fails overall)
- Individual harness runs executed for attribution

Results matrix:

1. `tests/headless/run_triage_harness.py`: PASS
2. `tests/headless/run_compose_harness.py`: PASS
3. `tests/headless/run_chat_harness.py`: FAIL
4. `tests/headless/run_reply_harness.py`: FAIL
5. `tests/headless/run_pagination_harness.py`: FAIL

Failure points observed:

- Chat harness timeout waiting for assistant response bubble completion (`run_chat_harness.py:86`).
- Reply harness timeout waiting for stubbed reply invocation (`run_reply_harness.py:155`).
- Pagination harness timeout waiting for delayed empty->rows recovery condition (`run_pagination_harness.py:305`).

Additional signal:

- Multiple failing runs logged `Failed to load resource: net::ERR_FILE_NOT_FOUND` in harness console output.
- In one reply run, account detect fell back to missing account state before contact open.

Inference:

- Recent runtime changes likely broke one or more harness assumptions around warmup timing, event ordering, or synthetic DOM compatibility.
- This is currently the highest-priority stabilization gap before further feature expansion.

## 9) GitHub and external context (web + Context7)

### 9.1 GitHub repository state

From GitHub web inspection:

- Repo: `aarohkandy/eorg`
- Branches: 1 (`main`)
- Tags visible: `v1.0.0`, `pre-discord-state`
- Public activity appears minimal:
  - stars: 0,
  - forks: 0,
  - issues: 0,
  - PRs: 0,
  - Actions workflow activity: none visible.
- Recent commit list aligns with local SHAs and dates.

### 9.2 Context7 findings

1. WXT (`/wxt-dev/wxt`):
   - `defineContentScript` is the intended way to encode `matches`, `runAt`, and related manifest options directly in entrypoints.
   - Current repo reflects this in `src/entrypoints/content.ts`, while legacy scripts still drive runtime behavior.
2. Playwright Python (`/microsoft/playwright-python`):
   - async patterns (`async_playwright`, `page.goto`, `page.evaluate`, `wait_for_selector`, `wait_for_function`) align with harness structure.
3. Playwright general (`/microsoft/playwright`):
   - emphasizes web-first/auto-wait assertions and resilient selectors; current harnesses still rely heavily on fixed waiting conditions in places.

Context7 limitation:

- Could not resolve an InboxSDK library ID in Context7 in this pass; InboxSDK references were validated via official InboxSDK docs and repository sources instead.

### 9.3 External design rationale checks

Web docs validation for implementation choices:

1. MV3 script injection:
   - `chrome.scripting.executeScript(..., world: "MAIN")` is a valid pattern, matching `background.js`.
2. Idle scheduling:
   - `requestIdleCallback` is intentionally best-effort and can be delayed significantly; using `setTimeout` for scan kick is reasonable for deterministic startup.
3. Permission choice:
   - `"unlimitedStorage"` is a documented extension permission and consistent with larger local cache goals.

## 10) Risks, gaps, and engineering debt

Top risks:

1. Harness regression debt:
   - 3/5 key harnesses currently failing.
2. Single-file concentration:
   - `content.js` has become a high-complexity hotspot (state, UI, extraction, scheduler, hydration all co-located).
3. Changelog drift:
   - `CHANGELOG.md` does not yet reflect latest `1.2.x` behavior.
4. Large runtime payload:
   - `pageWorld.js` is very large and raises maintainability and debugging cost.
5. Multiple source-of-truth risks:
   - WXT scaffold exists, but active runtime path is still hybrid with legacy script loading.

## 11) Recommended immediate plan for next senior engineer

1. Stabilize tests first:
   - Fix failing harness assumptions vs runtime behavior (`chat`, `reply`, `pagination`) and restore green baseline.
2. Lock send/timeline contracts:
   - Keep `submitThreadReply -> replyToThread -> { ok, stage, reason? }` immutable while refactoring internals.
3. Isolate critical domains:
   - Extract scheduler, timeline builder, and hydration logic from `content.js` into modules.
4. Align documentation/versioning:
   - Update `CHANGELOG.md` and reconcile package/manifest version strategy.
5. Add deterministic diagnostics:
   - Promote event log and structured debug dumps to first-class regression tooling with explicit harness hooks.

## 12) Evidence references

Local repository anchors:

- `README.md`
- `docs/thread-reply.md`
- `content.js`
- `compose.js`
- `background.js`
- `manifest.json`
- `styles.css`
- `tests/headless/*.py`

GitHub and web sources:

- GitHub repo: https://github.com/aarohkandy/eorg
- GitHub commits: https://github.com/aarohkandy/eorg/commits/main
- GitHub tags: https://github.com/aarohkandy/eorg/tags
- GitHub branches: https://github.com/aarohkandy/eorg/branches
- GitHub actions: https://github.com/aarohkandy/eorg/actions
- Chrome scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome permissions list (`unlimitedStorage`): https://developer.chrome.com/docs/extensions/reference/permissions-list
- MDN `requestIdleCallback`: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback
- InboxSDK docs (Conversations): https://inboxsdk.github.io/inboxsdk-docs/conversations/
- Playwright Python API (`page.wait_for_function`): https://playwright.dev/python/docs/api/class-page#page-wait-for-function
