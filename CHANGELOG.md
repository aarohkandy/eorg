# Changelog

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
