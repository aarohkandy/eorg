# Contributing

## Workflow

1. Fork or branch from `main`.
2. Make focused changes.
3. Validate extension behavior in Gmail.
4. Submit a PR with:
   - Problem statement
   - Approach
   - Before/after behavior
   - Console evidence if selector-related

## Coding Guidelines

- Prefer semantic selectors (`role`, `aria-*`, `data-*`) over class names.
- Keep extraction logic tolerant of missing nodes.
- Avoid direct mutation of Gmail-owned DOM except user-like click/input events.
- Keep logs prefixed with `[reskin]` for clear triage.

## Manual Test Checklist

- Extension loads via `chrome://extensions`.
- Viewer renders non-zero messages on inbox.
- Clicking an item opens correct thread.
- Refresh button re-renders list.
- No uncaught errors in console.
