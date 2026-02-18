# Changelog

## v0.6.4 - 2026-02-18

- Replaced full-page `MutationObserver` rerender loop with a low-power UI poller (900ms) to reduce CPU pressure.
- Preserved render dedupe and guardrails while cutting high-frequency Gmail DOM callback load.
- Updated runtime startup logging to reflect low-power polling mode.

## v0.6.3 - 2026-02-18

- Added direct capture-phase binding for sidebar Settings button to prevent Gmail-level handlers from swallowing the click.
- Centralized settings-open action into a single route-safe handler and reused it for delegated click fallback.
- Kept in-app settings navigation pinned to `#app-settings` for consistent rendering.

## v0.6.2 - 2026-02-18

- Reduced observer-driven rerender pressure to mitigate Gmail lag/crash risk.
- Added observer render throttling (debounce + minimum render gap) to avoid rapid redraw loops.
- Added lightweight DOM signature checks so unchanged Gmail states do not trigger full overlay rerenders.

## v0.6.1 - 2026-02-18

- Fixed Settings button interaction reliability by consuming handled overlay clicks before Gmail can intercept them.
- Settings button now explicitly routes to `#app-settings` so the settings view stays pinned and restorable.
- Broadened settings-route detection to support `#app-settings` with query params.

## v0.6.0 - 2026-02-17

- Added Inbox-only AI triage with left-sidebar urgency filters (Critical/High/Medium/Low/FYI).
- Added provider-backed AI settings in-app (OpenRouter free, Groq free allowlist, local Ollama).
- Added triage status and refresh controls, plus inline urgency badges on message cards.
- Added one-time triage consent + advanced runtime controls (batch size, timeout, retries, input cap).
- Added Gmail label automation path for persistent triage labels (`Triage/*`) and no re-triage behavior.

## v0.5.0 - 2026-02-17

- Locked exact stable state with working in-app settings route (`#app-settings`).
- Includes current sidebar navigation, folder behavior, thread view, and interaction stability fixes.


## v0.4.4 - 2026-02-17

- Fixed Settings button no-op by adding persistent in-app settings route hash (`#app-settings`).
- Updated hash sync logic to preserve settings view instead of immediately reverting to list view.
- Back to Inbox from settings now restores mailbox hash and returns to list reliably.


## v0.4.3 - 2026-02-17

- Replaced native-settings navigation with a fully in-app Settings page (inside the overlay UI).
- Settings button now opens custom settings view and supports `Back to Inbox` action.
- Removed settings suspend/resume overlay behavior tied to Gmail native settings routes.
- Added dedicated settings UI styling and active-state indicator for sidebar Settings button.


## v0.4.2 - 2026-02-17

- Fixed Settings button visibility issue by suspending overlay/reskin when opening Gmail settings.
- Added reskin suspend/resume guards so native settings remains visible until user exits settings route.
- Added explicit mode disable during settings navigation to prevent overlay immediately re-hiding Gmail UI.


## v0.4.1 - 2026-02-17

- Restored bottom-left sidebar `Settings` button.
- Wired settings button to open native Gmail settings control when available, with direct route fallback.


## v0.4.0 - 2026-02-17

- Locked stable sidebar + inbox/folder behavior baseline for exact rollback point.
- Includes inbox lenient capture with strict non-inbox folder filtering and stable interaction handling.


## v0.3.7 - 2026-02-17

- Fixed inbox regression from over-strict folder filtering in v0.3.6.
- Inbox now uses lenient capture of visible rows/links; non-inbox folders remain strict.
- Restored normal inbox rendering while keeping cross-folder bleed protection for Sent/Drafts/etc.


## v0.3.6 - 2026-02-17

- Enforced strict folder matching for list extraction based on active mailbox hash.
- Sent/Drafts/etc. now only render messages whose thread links match that mailbox route.
- Removed cross-folder row bleed that showed inbox-style items under other folders.


## v0.3.5 - 2026-02-17

- Rebuilt left sidebar navigation on top of v0.3.0 baseline (Inbox/Starred/Snoozed/Sent/Drafts/All Mail/Spam/Trash).
- Added deterministic folder switching via hash + native Gmail nav click with loading state and rerender retries.
- Restored stable button behavior using interaction lock, observer external-mutation filtering, and list signature dedupe.
- Moved app shell to fullscreen left layout with sidebar + main panel.


## v0.3.0 - 2026-02-17

- Stabilized interaction model for production use (reduced jitter, improved observer behavior, reliable list rendering).
- Added full app-shell UX improvements (left nav, settings control, thread view consistency).
- Improved navigation flow reliability and removed default forced hard navigations to prevent leave-confirm popups.


## v0.2.22 - 2026-02-17

- Removed forced full-page navigations from normal sidebar/back flows to avoid browser `beforeunload` leave prompts.
- Switched mailbox/back actions to SPA-safe Gmail navigation (`hash` + native mailbox click) with rerender retries.
- Kept hard navigation as an opt-in emergency fallback (`allowHardNavigation = false` by default).


## v0.2.21 - 2026-02-17

- Centered left sidebar mailbox options vertically within the sidebar column.
- Added bottom `Settings` button in the sidebar.
- Wired settings button to trigger native Gmail settings control when available.


## v0.2.20 - 2026-02-17

- Fixed disappearing-list regression: moved list clear after signature dedupe guard in `renderList`.
- Prevents blank panel when observer triggers unchanged list renders.


## v0.2.19 - 2026-02-17

- Fixed button jitter by locking UI updates briefly during clicks (sidebar, message open, back).
- Mutation observer now ignores reskin-root self-mutations and pauses during interaction lock.
- Added list signature dedupe to skip redundant DOM rebuilds when message set has not changed.


## v0.2.18 - 2026-02-17

- Fixed Back to inbox: action now always targets `#inbox` (not last mailbox hash).
- Added robust Gmail route URL builder for account-aware navigation (`/mail/u/<n>/`).
- Hard navigation now uses `location.replace` with `assign` fallback plus post-nav hash safety check.


## v0.2.17 - 2026-02-17

- Fixed Back to inbox by switching to deterministic hard-route navigation (same reliability path as sidebar folder switches).
- Back action now sets pending mailbox state before navigation to keep overlay/list sync stable after reload.


## v0.2.16 - 2026-02-17

- Enforced strict mailbox content rendering (Sent/Drafts/etc. no longer falls back to inbox rows).
- Sidebar folder switches now use deterministic full-route navigation for reliability.
- Removed broad extraction fallback so empty folders correctly display empty state.
- Shifted app shell fully left/fullscreen (no centered outer gap).


## v0.2.15 - 2026-02-17

- Added reliability-first mailbox navigation: target Gmail native sidebar links by folder label on click.
- Added hard-route fallback navigation when Gmail does not switch mailbox after sidebar action.
- Wired sidebar items with native label metadata for deterministic folder targeting.


## v0.2.14 - 2026-02-17

- Reliability refactor: removed strict mailbox-link filtering that caused intermittent empty lists.
- Added pending-route loading gate so sidebar switches wait for Gmail to land before rendering.
- Added multi-pass rerender retries and timeout guard to avoid permanent blank states.
- Expanded row thread-id fallback link detection to include `th=` and generic anchors.


## v0.2.13 - 2026-02-17

- Hotfix: restored message visibility by adding Gmail `th=` link selectors to extraction paths.
- Relaxed row-level mailbox filtering when rows lack mailbox-qualified hrefs.
- Expanded row link detection to include generic and `th=` anchors.


## v0.2.12 - 2026-02-17

- Fixed mailbox matching for Gmail query-based thread links (`th=` + `search=`), not just hash links.
- Added resilient extraction fallback when strict mailbox filtering returns zero messages.
- Prevented blank list state on inbox/folder loads caused by route format differences.


## v0.2.11 - 2026-02-17

- Fixed mailbox switching data scope: message extraction is now filtered to the active sidebar mailbox route.
- Strengthened route switching by attempting native mailbox link click plus hash fallback.
- Added short loading state and delayed rerenders after sidebar navigation to avoid stale inbox rows.


## v0.2.10 - 2026-02-17

- Fixed sidebar switching by removing brittle hidden-DOM click-through logic.
- Folder switches now use sanitized hash route navigation plus immediate list render refresh.
- Removed forced list-lock on sidebar clicks to prevent state desync/breakage.


## v0.2.9 - 2026-02-17

- Added a custom left sidebar with mailbox navigation (Inbox, Starred, Snoozed, Sent, Drafts, All Mail, Spam, Trash).
- Implemented active mailbox highlighting and route-synced navigation from the sidebar.
- Upgraded layout to a polished shell with sidebar + main content panel across list and thread views.


## v0.2.8 - 2026-02-17

- Thread reader now renders actual Gmail email HTML instead of flattened plain text.
- Added black-theme skin layer for email HTML while preserving original email structure/layout.
- Added safe HTML escaping for thread header/meta and plain-text fallback rendering.


## v0.2.7 - 2026-02-17

- Fixed Back to inbox by forcing list-lock mode until a mailbox list hash is active.
- Added robust list-hash sanitization and explicit inbox/list navigation trigger.
- Prevented hash rebound from re-opening thread mode immediately after back action.


## v0.2.6 - 2026-02-17

- Fixed Back to inbox navigation by restoring the previous list hash reliably.
- Improved thread parsing for sender/date/body using stronger Gmail selectors and innerText extraction.
- Aligned thread view typography/spacing with the app list card style.


## v0.2.5 - 2026-02-17

- Added full in-app thread reading view so opening emails stays inside custom UI.
- Added custom thread renderer with back action and live hash/observer sync.
- Removed fallback behavior that exposed native Gmail thread screen while reading.


## v0.2.4 - 2026-02-17

- Fixed thread open interaction: clicking an item now suspends overlay so native Gmail thread view is visible.
- Added auto-resume of overlay when navigating back to list routes.


## v0.2.3 - 2026-02-17

- Tightened subject extraction to prefer concise subject text over long snippet/date metadata.
- Improved subject cleanup by stripping date fragments and trailing snippet separators.


## v0.2.2 - 2026-02-17

- Narrowed centered layout width for a tighter side-to-side presentation.
- Improved subject extraction to avoid date/time metadata and prioritize real subject text.

## v0.2.1 - 2026-02-17

- Switched viewer UI to clean monochrome centered card layout.
- Removed top header and outer panel/frame borders.
- Reduced card sizing and spacing for denser list view.
- Fixed duplicated date rendering by cleaning date/timestamp fragments from subject text.

## v0.2.0 - 2026-02-17

- Improved Gmail thread extraction resilience across DOM variants.
- Added fallback thread-id extraction from nested attributes and `href`.
- Added broader selectors for rows and links.
- Improved thread open behavior with additional link and hash fallback.
- Added full project documentation:
  - `README.md`
  - `CONTRIBUTING.md`
  - `PUBLISHING.md`
