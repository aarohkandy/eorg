# Legacy Runtime Notice

The files in `legacy/gmail-dom-v1/` and the copies in `apps/extension/content-modules/`
are the old Mailita-style Gmail DOM runtime. They are kept for reference and are exercised
by the headless test harnesses in `tests/headless/`.

**The active product is in `apps/extension/`.** That is the only code loaded by the
active manifest (`apps/extension/manifest.json`).

Do not edit the legacy files unless you are intentionally working on the headless test suite.
