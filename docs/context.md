# Mailita Context Document

Last updated: 2026-03-18 (America/Los_Angeles)

This document is intended to be the highest-signal handoff and context file in the repo.
It is deliberately long and repetitive in places because the goal is completeness, not
brevity.

This file tries to answer five questions:

1. What is Mailita supposed to be?
2. What is in the repository right now?
3. What happened recently, and why?
4. What is broken or incomplete right now?
5. What should happen next?

If this document and the code disagree, treat the code as the source of truth for current
implementation details and treat this document as the source of truth for historical context,
intent, and investigation state.

## 1. Product definition

Mailita is a Chrome extension that aims to completely replace Gmail's visible interface with
a custom chat-style UI.

The intended product experience is:

- The extension runs on `https://mail.google.com/*`.
- Gmail's normal UI is visually replaced by a full-screen custom interface.
- Messages are organized by person, not by Gmail thread.
- The left column should show the other person, the latest time, and the latest subject.
- Clicking a person should show every email sent to and received from that person as a
  clean, chronological chat.
- Long term, this should feel closer to Discord or iMessage than to Gmail.

The current implementation is not at that final state yet. It is partway there.

## 2. Current repository reality

### 2.1 Repo layout

The active Mailita code lives here:

- Extension:
  - [apps/extension/manifest.json](/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json)
  - [apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js)
  - [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js)
  - [apps/extension/content/styles.css](/Users/a_a_k/Downloads/EORG/apps/extension/content/styles.css)
- Backend:
  - [apps/backend/server.js](/Users/a_a_k/Downloads/EORG/apps/backend/server.js)
  - [apps/backend/routes/messages.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/messages.js)
  - [apps/backend/routes/auth.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/auth.js)
  - [apps/backend/routes/health.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/health.js)
  - [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js)
  - [apps/backend/lib/message-normalize.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/message-normalize.js)
  - [apps/backend/lib/build-info.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/build-info.js)

There is also older repo material outside `apps/`, including older docs and WXT scaffolding.
Some of that older material is still useful as historical context, but the active Mailita
runtime for this phase of work is the `apps/extension` + `apps/backend` stack.

### 2.2 Current branch and local state

As of the last update to this file:

- Branch: `main`
- Local HEAD: `4bc8ecb`
- Working tree: clean

Recent commits:

- `4bc8ecb` `fix: improve imap content extraction debugging`
- `7ecbb4b` `fix: add live message debug instrumentation`
- `6b3e346` `Add IMAP diagnostic probe matrix`
- `0bfff40` `this better work`
- `3ae4d19` `nvm wasn't done yet`
- `5046036` `should connect to backend now?`
- `b7a705f` `might work?`
- `3f1334d` `fix: skip snippet downloads during mailbox sync`
- `eeb68c6` `fix: avoid IMAP snippet downloads inside fetch loops`
- `a9b1f33` `cleanup: isolate legacy runtime and harden connect flow`

Important deployment note:

- A prior backend commit, `7ecbb4b`, was pushed and deployed to Render.
- The newer local backend commit, `4bc8ecb`, is not known to be pushed or deployed.
- A direct push test from this environment failed because SSH to GitHub timed out on port 22.
- That means local code may be ahead of the deployed backend.

### 2.3 Current file sizes / complexity

The biggest active files at the time this document was written are:

- [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js): 1699 lines
- [apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js): 1400 lines
- [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js): 1313 lines
- [apps/extension/content/styles.css](/Users/a_a_k/Downloads/EORG/apps/extension/content/styles.css): 961 lines
- [apps/backend/routes/messages.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/messages.js): 735 lines

This matters because structural cleanup is still a real need.

## 3. Build and runtime model

### 3.1 Extension runtime model

The active extension runtime is not currently a modular, bundled frontend app in the way
people usually mean when they say "Vite app" or "Webpack app."

Facts from the repo:

- The root repo contains WXT scaffolding in `package.json`.
- The active extension package is still described directly by
  [apps/extension/manifest.json](/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json).
- The manifest currently loads:
  - `background/service-worker.js`
  - `content/gmail-inject.js`
  - `content/styles.css`

The manifest currently contains exactly one content script entry:

- `content/gmail-inject.js`

So the current live extension runtime is still centered around one large content script and
one large service worker.

### 3.2 Backend runtime model

The backend is:

- Node.js
- Express
- deployed to Render
- backed by Supabase
- connected to Gmail over IMAP using ImapFlow

Backend package:

- [apps/backend/package.json](/Users/a_a_k/Downloads/EORG/apps/backend/package.json)
- version: `1.0.0`
- key dependencies:
  - `express`
  - `@supabase/supabase-js`
  - `imapflow`
  - `mailparser`

## 4. End-to-end architecture

### 4.1 High-level flow

The current end-to-end data path is:

1. Gmail page loads.
2. The extension content script injects a full-screen Mailita UI into Gmail.
3. The content script talks to the extension service worker through `chrome.runtime.sendMessage`.
4. The service worker talks to the backend on Render.
5. The backend checks Supabase cache.
6. If needed, the backend connects to Gmail over IMAP using the stored Gmail credentials.
7. IMAP results are normalized into flat message objects.
8. The backend returns those messages to the extension.
9. The content script groups them and renders the UI.

### 4.2 Current logical responsibilities

#### Content script

[apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js)
currently handles many jobs at once:

- shell boot
- UI state
- onboarding/setup flow
- rendering
- grouping
- mailbox loading
- search
- retry logic
- debug panel rendering
- contact debug refetch behavior

#### Service worker

[apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js)
currently handles:

- backend requests
- auth/connect/disconnect actions
- storage reads/writes
- diagnostics normalization and forwarding
- health checks
- mailbox/search/sync actions
- contact debug refetch transport

#### Backend message route

[apps/backend/routes/messages.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/messages.js)
currently handles:

- request parsing
- Supabase cache reads/writes
- IMAP sync orchestration
- search orchestration
- content-coverage analysis
- response `debug` blocks
- contact debug refetch endpoint

#### Backend IMAP library

[apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js)
currently handles:

- IMAP client setup
- fetch target resolution
- mailbox locking
- header fetches
- thread ID derivation
- content/snippet extraction
- IMAP trace generation
- contact debug extraction diagnostics

## 5. Current user-facing behavior

### 5.1 Onboarding and connection

The extension currently supports:

- a setup flow for entering Gmail address + Gmail App Password
- helper links for:
  - App Passwords
  - 2-Step Verification
- connect/disconnect through the backend

Recent UX work already done:

- the App Password action was made larger and more prominent
- the central onboarding overlay was fixed so it can actually disappear after connection
- temporary activity logs were made easier to remove later via a toggle

### 5.2 Left rail behavior

The left rail is currently closer to the desired direction than before:

- contact/person-based grouping is the intended current behavior
- the simplified left row should show:
  - other person
  - latest time
  - latest subject

However, this is still not considered "done":

- the overall look still feels too Gmail-like
- the final product should feel more like a clean chat application

### 5.3 Conversation view behavior

When a user opens a contact conversation, the detail view currently:

- renders the conversation area
- shows fallback text like `(message content unavailable)` when no snippet/body text exists
- shows a temporary debug log panel in the detail view
- allows the copied debug log to be pasted into chat for diagnosis

That debug log is intentionally temporary.

## 6. Current deployed backend state vs local backend state

### 6.1 Known deployed backend state

From the user's copied debug logs, the Render backend was at least successfully running:

- version: `1.0.0`
- build SHA: `7ecbb4b936ea47e4756da58c89cb02d815d44342`

That means the "live debug instrumentation" round did make it to Render.

### 6.2 Known local-only backend state

The newer local commit:

- `4bc8ecb` `fix: improve imap content extraction debugging`

contains additional IMAP extraction/debug changes that are likely not deployed yet.

### 6.3 Push/deploy limitation

Push testing from this environment failed with:

- `ssh: connect to host github.com port 22: Operation timed out`
- `fatal: Could not read from remote repository.`

That means:

- local commits can be made
- local checks can be run
- but backend deployment may be blocked until push access works from another environment

## 7. Current known problems

This is the most important section for anyone picking up the repo.

### 7.1 Main blocker: many messages still have no content

Symptoms:

- In the UI, many messages show `(message content unavailable)`.
- Notification-like senders such as Reddit and Google are common repro cases.
- In at least one live mailbox refresh, all 100 recent messages came back with missing content.

This is currently the main product blocker.

### 7.2 This is probably not a frontend rendering bug

The frontend is correctly displaying the fallback when the backend returns blank content.

Evidence:

- The debug panel shows `snippet_length: 0`.
- The copied debug payload shows the backend returning blank content for the selected messages.

So the immediate issue is upstream of rendering.

### 7.3 This is probably not a Gmail IMAP limitation

Research from official/primary sources strongly points away from "Gmail IMAP cannot return
the content."

Important findings:

- RFC 3501 defines `BODYSTRUCTURE` and how MIME part numbers are addressed. It explicitly
  supports nested multipart trees and nested `message/rfc822` parts.
- ImapFlow docs show part paths being computed while traversing the MIME tree.
- ImapFlow also supports downloading the full message source when no part is passed to
  `download()`.

References:

- [RFC 3501](https://www.rfc-editor.org/rfc/rfc3501)
- [ImapFlow fetching examples](https://imapflow.com/docs/examples/fetching-messages/)
- [Gmail IMAP extensions](https://developers.google.com/workspace/gmail/imap/imap-extensions)

Conclusion:

- Gmail IMAP is giving us structure and access.
- Our extractor was, or still may be, choosing the wrong section or failing to derive the
  correct section path.

### 7.4 Most likely technical cause

The strongest current hypothesis is:

- our MIME-part selection logic was too shallow or too strict
- and/or it relied on part identifiers that were not actually being derived correctly

Strong evidence from the user's debug logs:

- `has_body_structure: true`
- `selected_part: none`
- `empty_reason: no_text_part`
- `downloaded_bytes: 0`

That means the failure was happening before successful body-part download.

### 7.5 Current local fix attempt

The local-only IMAP patch in commit `4bc8ecb` tries to address this by:

- computing MIME part paths while traversing `bodyStructure`
- widening candidate selection to `text/*` plus `message/rfc822`
- keeping attachment preference low
- adding full raw-message fallback when part selection or part parsing fails
- adding richer extraction diagnostics

This is a real fix attempt, not just more logging.

### 7.6 The logs are temporary and should be removable later

The current debug/logging surface is intentionally temporary.

Current policy:

- keep logs because they are needed right now
- make them easy to remove later
- do not treat them as final product UI

## 8. Important debugging history

### 8.1 Mailbox cache was initially suspected

Earlier debug logs showed:

- cache hits from Supabase
- blank snippets in cached rows
- mailbox responses using cached data

This led to an initial hypothesis that stale cached rows were the main cause.

That was only partly true.

### 8.2 Contact debug refetch narrowed the issue

Once the contact debug endpoint was added and deployed, the logs improved.

A key Reddit example showed:

- `contact_live_refetch.attempted: true`
- `after_count: 6`
- `after_missing_content_count: 6`
- each message still blank after live contact refetch

This mattered because it proved:

- the contact grouping logic was capable of merging more than one message for that sender
- the backend was actively going back to Gmail live
- the live Gmail path still produced blank content

That moved the primary suspicion away from stale cache and toward the IMAP extraction path.

### 8.3 Render/backend mismatch happened in the middle of the investigation

At one point, the extension had the new frontend debug logic but Render did not yet have the
new backend contact debug endpoint.

This caused errors like:

- `Backend returned an invalid response.`
- `Cannot POST /api/messages/debug/contact`

That specific mismatch was eventually resolved once the backend debug route reached Render.

### 8.4 The current best evidence

The best available evidence so far is:

- the deployed backend can run contact debug refetch
- live fetch found the relevant messages
- content was still blank
- `BODYSTRUCTURE` existed
- no usable part was selected in that build

That is why the current local work is focused on MIME-path derivation and raw fallback.

## 9. Current local IMAP extraction/debug changes

These changes exist locally in commit `4bc8ecb`.

### 9.1 In the backend

In [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js):

- MIME structure traversal now derives section paths explicitly
- structure summaries are recorded
- candidate parts are collected and scored
- fallback strategy is recorded
- full raw-message fallback is attempted with:
  - `client.download(uid, undefined, { uid: true })`
  - `simpleParser`
  - fallback to parsed text, stripped HTML, or raw UTF-8

Richer per-message debug fields now include:

- `structureSummary`
- `candidateParts`
- `selectionStrategy`
- `fallbackAttempted`
- `fallbackStage`
- `fallbackTriggerReason`
- `rawDownloadBytes`
- `rawFallbackParserSource`
- `finalContentSource`
- `finalEmptyReason`

### 9.2 In the frontend debug report

In [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js):

the copied debug report now includes:

- structure summary
- candidate parts
- selection strategy
- fallback attempted
- fallback stage
- fallback trigger reason
- final content source
- final empty reason

The goal is that if message recovery still fails after deployment, the next copied log should
be decision-complete rather than merely suggestive.

## 10. Current testing state

### 10.1 Tests/checks run recently

The following local syntax checks passed during the latest IMAP/debug work:

- `node --check apps/backend/lib/imap.js`
- `node --check apps/backend/routes/messages.js`
- `node --check apps/backend/lib/message-normalize.js`
- `node --check apps/extension/content/gmail-inject.js`

### 10.2 What has not been fully verified locally

The following are still pending or environment-dependent:

- full live Gmail verification after the newest local backend commit
- Render deployment of commit `4bc8ecb`
- confirmation that recovered text now appears for Reddit/Google notification messages

## 11. Current design gap vs desired future state

This section is about product direction, not just bugs.

### 11.1 Desired future state

The desired Mailita experience is:

- person-first left rail
- clean chat-first conversation view
- visually distinct from Gmail
- reliable full or near-full message body visibility
- minimal friction onboarding
- temporary debug/log surfaces removed once stable

### 11.2 Current gap

Current gaps include:

- UI still feels too Gmail-like
- content extraction is unreliable
- active files are too large
- temporary logs are still visible in product UI
- backend deployment can lag local extension work

## 12. Structural refactor status

There is an important distinction between:

- work that was discussed/planned
- work that is actually present in the current tree

### 12.1 What is clearly still monolithic in the current tree

The following files are still single large files in the current repo:

- [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js)
- [apps/backend/routes/messages.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/messages.js)
- [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js)
- [apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js)
- [apps/extension/content/styles.css](/Users/a_a_k/Downloads/EORG/apps/extension/content/styles.css)

### 12.2 What was planned

There were explicit plans to split these areas into focused modules, including concepts like:

- IMAP client / fetch targets / snippets / trace / probes / operations
- message params / repository / cache / sync / search / router
- content-script foundation / render / mailbox / setup / sidebar / main

Those plans are still good design directions.

However, the current repo tree should be treated as monolithic until those splits actually
land in code.

## 13. Important product constraints and decisions

### 13.1 Active backend URL

The extension is pointed at:

- `https://email-bcknd.onrender.com`

This is documented in:

- [apps/extension/README.md](/Users/a_a_k/Downloads/EORG/apps/extension/README.md)

### 13.2 Current active manifest behavior

Current manifest facts:

- MV3 extension
- one background service worker
- one content script
- one content stylesheet

See:

- [apps/extension/manifest.json](/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json)

### 13.3 Health endpoint now returns build info

The backend health route currently returns:

- `status`
- `timestamp`
- `uptime`
- `version`
- `buildSha`
- `deployedAt` when available

See:

- [apps/backend/routes/health.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/health.js)
- [apps/backend/lib/build-info.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/build-info.js)

### 13.4 Normal mailbox responses now carry debug coverage summaries

Normal mailbox responses include lightweight debug info about:

- cache usage
- live usage
- missing-content counts
- short-content counts
- coverage percentage
- backend build metadata

The heavy per-message extraction diagnostics are reserved for the contact debug endpoint.

### 13.5 Debug/log UI is intentionally temporary

The current in-app debug surface is not meant to survive into the finished product.

It exists because:

- it made backend/frontend mismatches visible
- it proved cache vs live behavior
- it made the IMAP extraction failure diagnosable

## 14. Important historical context

This section is intentionally selective. It is not every change ever made; it is the most
important past context for understanding the current state.

### 14.1 Mailita started from a different extension generation

Older repo docs and older code paths describe an earlier "Gmail Hard Reskin" generation using
different files like `content.js`, `compose.js`, and older runtime surfaces.

That material still contains useful ideas, but the current active implementation for this
phase is the `apps/extension` and `apps/backend` stack.

### 14.2 Important IMAP history

Important past backend learnings:

- relative IMAP ranges like `*:-50` were a bug risk
- absolute fetch ranges became necessary
- snippet downloading inside fetch loops caused problems and had to be avoided
- more diagnostics were added over time because IMAP/Gmail failures were not obvious enough

### 14.3 Important UI history

Important recent UI direction changes:

- move from Gmail-thread-centric thinking toward person-centric grouping
- simplify the left rail to person, time, subject
- reduce the visual resemblance to Gmail over time
- make onboarding feel less broken and less visually awkward

## 15. Best current theory of the missing-content bug

This section states the current theory plainly.

### 15.1 What is probably true

The most likely situation is:

- Gmail IMAP is returning `BODYSTRUCTURE`
- those notification emails have body content in a structure our earlier selector did not
  handle well
- we were not deriving section numbers robustly enough
- therefore we never downloaded the meaningful part
- therefore `snippet` stayed blank

### 15.2 What the new local code tries to do

The new local code tries to recover from that by:

- computing paths instead of assuming them
- considering more text-part candidates
- handling HTML-derived text
- falling back to full raw-message parsing

### 15.3 If the new local code still fails

If the newest local patch gets deployed and messages are still blank, the next likely causes
will probably be one of:

- wrong computed MIME path for a nested structure
- `message/rfc822` section needing a more specific `.TEXT` handling strategy
- weird content-transfer-encoding case
- sanitized HTML stripping too much
- provider-specific message structure with text hidden in an unexpected leaf

The new debug fields should make that next decision much easier.

## 16. Immediate next steps

These are the best next actions in order.

### 16.1 First priority

Get the local backend commit `4bc8ecb` pushed and deployed if possible.

Reason:

- without that deployment, the best current fix and best current diagnostics are still local

### 16.2 Second priority

Open a failing Reddit or Google notification again and copy the new debug log after the latest
backend is deployed.

The ideal outcomes are:

- readable message content appears
- or the log clearly states the remaining exact failure

### 16.3 Third priority

Once content extraction is working reliably enough, continue UI cleanup:

- make the product look less Gmail-like
- keep the left rail minimal
- continue toward a real contact chat feel

### 16.4 Fourth priority

After behavior stabilizes, resume structural cleanup:

- split large files into focused modules
- keep runtime behavior unchanged while splitting

## 17. Medium-term roadmap

### 17.1 Product

- stable person-based conversations
- reliable body extraction for common email formats
- cleaner visual identity
- less debugging UI
- improved perceived responsiveness

### 17.2 Engineering

- split monolithic files
- add more targeted tests for IMAP extraction and debug routes
- make deployment/debug loops less painful
- tighten the contract between service worker, backend, and content script

## 18. Long-term vision

Long term, Mailita should behave like:

- a real person-centric mail messenger
- with Gmail as the backend data source
- not a reskinned Gmail clone
- and not a fragile demo dependent on lucky MIME structures

The ideal long-term system would have:

- person-first backend and frontend concepts
- strong body extraction or original-message rendering
- much smaller files
- easier observability
- temporary debug surfaces removed

## 19. High-confidence truths

These are the safest statements to rely on right now.

- The current main product blocker is missing message content.
- The frontend fallback rendering is not the primary cause of blank content.
- Gmail IMAP itself is probably not the limiting factor.
- MIME structure selection/parsing is the main suspected technical failure.
- The deployed backend has at least the live debug instrumentation commit.
- The newer MIME-fallback fix exists locally but may not be deployed.
- Push access from this environment is currently blocked.
- The repo still has several oversized, monolithic files.

## 20. Open questions

These questions are still unresolved.

- After the `4bc8ecb` backend patch is deployed, do Reddit and Google notification emails gain
  visible content?
- If not, what exact `structureSummary`, `candidateParts`, and `finalEmptyReason` do they show?
- Are there message types where full raw-message fallback works while part download does not?
- How much of the remaining UI should be rethought before doing more file splits?
- Should future content recovery store a richer body field than `snippet`?

## 21. Suggested reading order for a new engineer or agent

If someone is new to this codebase and needs to become effective quickly, this is the best
reading order:

1. This file:
   - [docs/context.md](/Users/a_a_k/Downloads/EORG/docs/context.md)
2. Extension overview:
   - [apps/extension/README.md](/Users/a_a_k/Downloads/EORG/apps/extension/README.md)
3. Backend overview:
   - [apps/backend/README.md](/Users/a_a_k/Downloads/EORG/apps/backend/README.md)
4. Active manifest:
   - [apps/extension/manifest.json](/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json)
5. Backend message route:
   - [apps/backend/routes/messages.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/messages.js)
6. IMAP implementation:
   - [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js)
7. Extension UI/runtime:
   - [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js)
   - [apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js)
8. Styles:
   - [apps/extension/content/styles.css](/Users/a_a_k/Downloads/EORG/apps/extension/content/styles.css)

## 22. Final note

The single most important thing to understand right now is this:

Mailita is no longer blocked on "we don't know what's wrong."

The team has already narrowed the core failure from:

- vague blank-message behavior

to:

- backend live refetch still returning blank content

to:

- `BODYSTRUCTURE` exists but MIME-part selection was failing

to:

- a concrete local patch that computes MIME paths, broadens candidate selection, and falls
  back to raw-message parsing

That is real progress. The remaining problem is mostly execution and verification:

- deploy the latest backend fix
- rerun the failing cases
- inspect the richer logs
- then either keep the fix or use the new diagnostics to make the next extraction change with
  much less guessing.

## 23. File-by-file runtime map

This section is intentionally dense. The goal is that another engineer or agent can read this
section and get a strong mental model of the actual runtime files without reading them all
line by line first.

Where helpful, each file entry includes:

- purpose
- important symbols / functions / routes
- how it interacts with the rest of the system
- important quirks or risks
- current known status

### 23.1 Root-level files

#### `AGENTS.md`

Purpose:

- repo-specific instructions for coding agents

Important current instruction:

- read `PERSISTENT_PREFERENCES.md` at session start

#### `PERSISTENT_PREFERENCES.md`

Purpose:

- stores recurring user preferences across sessions

Important preferences in effect:

- always read this file first
- version/status changes should use `+0.0.1` unless the user says otherwise
- there are also older preferences from the earlier extension generation

Important caution:

- some preferences reference old files and old extension architecture
- they are still useful as user intent/history, but not all of them apply directly to the
  current `apps/extension` + `apps/backend` Mailita stack

#### `package.json`

Purpose:

- root repo tooling file

What it tells us:

- root project version is `1.1.6`
- WXT tooling exists
- there are headless test commands from an older/parallel extension generation

Important implication:

- this file does not fully describe the active Mailita runtime on its own
- the active extension still uses `apps/extension/manifest.json`

### 23.2 Extension package

#### [apps/extension/manifest.json](/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json)

Purpose:

- the actual extension manifest for the active Mailita runtime

Current key facts:

- MV3 manifest
- name: `Gmail Unified`
- version: `1.2.21`
- permissions:
  - `storage`
  - `unlimitedStorage`
  - `tabs`
- host permissions:
  - `https://mail.google.com/*`
  - `https://email-bcknd.onrender.com/*`
- background service worker:
  - `background/service-worker.js`
- content scripts:
  - only `content/gmail-inject.js`
- content styles:
  - `content/styles.css`
- popup:
  - `popup/popup.html`

Why this matters:

- the live extension currently still uses one big content script, not a split manifest-loaded
  series of content files
- any assumption that the extension runtime is already split into `gmail-inject-foundation.js`
  and similar files would currently be wrong

#### [apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js)

Purpose:

- backend transport layer plus local extension state/guide/diagnostic orchestrator

High-level responsibilities:

- calls the Render backend
- normalizes backend errors
- stores and compresses onboarding/setup diagnostics
- stores and recalculates onboarding guide state
- handles all runtime messages from popup and content script
- syncs guide state to browser tab context

Important constants and concepts:

- `BACKEND_URL` points to Render
- `FETCH_TIMEOUT_MS` controls backend request timeout
- `SETUP_DIAGNOSTICS_KEY` stores onboarding diagnostics in Chrome local storage
- `GUIDE_STEPS` currently has two steps:
  - `welcome`
  - `connect_account`

Important helper clusters:

- diagnostics helpers:
  - `normalizeDiagnosticEntry`
  - `compressTraceEntries`
  - `appendSetupDiagnostics`
  - `clearSetupDiagnostics`
- guide helpers:
  - `defaultGuideStatus`
  - `buildConnectedGuideState`
  - `normalizeGuideState`
  - `recalcGuideState`
  - `setGuideBadge`
- backend helpers:
  - `normalizeError`
  - `fetchBackend`
  - `fetchHealth`
- action handlers:
  - `handleGuideAction`
  - `handleBackendAction`

Important supported actions:

- `CONNECT`
- `DISCONNECT`
- `FETCH_MESSAGES`
- `DEBUG_REFETCH_CONTACT`
- `SEARCH_MESSAGES`
- `SYNC_MESSAGES`
- `HEALTH_CHECK`
- `DIAGNOSTICS_LOG`
- `GET_STORAGE`
- `GUIDE_GET_STATE`
- `GUIDE_NAVIGATE_TO_STEP`
- `GUIDE_CONFIRM_STEP`
- `GUIDE_RESET`

Important runtime listeners:

- `chrome.tabs.onActivated`
- `chrome.tabs.onUpdated`
- `chrome.runtime.onMessage`

Why this file matters:

- this is the core glue between extension UI and backend
- if the content script appears to behave strangely, a large percentage of the time the root
  cause can be found in how this file shapes backend responses or tracks guide/setup state

Current risks:

- very large and multi-responsibility
- difficult to refactor safely without careful interface preservation
- guide/setup logic and backend logic are heavily mixed

#### [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js)

Purpose:

- the main Gmail page UI runtime

This is currently the single most important frontend file.

Major responsibilities:

- booting inside Gmail
- managing extension UI state
- rendering the left rail and conversation view
- handling onboarding overlay / guide UI inside Gmail
- sending requests to the service worker
- managing mailbox/search/refresh state
- running per-contact debug refetch flow
- rendering and copying the temporary debug log

Important state object:

- `state` holds:
  - `messages`
  - `filter`
  - `selectedThreadId`
  - `searchQuery`
  - retry timers
  - auto refresh timer
  - connection state
  - guide state
  - setup diagnostics
  - last mailbox trace/debug
  - mailbox auto refresh debug state
  - per-contact debug state
  - connect-in-flight state

Important helper groups:

- diagnostics and trace normalization:
  - `normalizeDiagnosticEntry`
  - `normalizeTraceEntries`
  - `mergeTraceEntries`
- mailbox debug normalization:
  - `normalizeBuildInfo`
  - `normalizeMailboxDebug`
  - `blankMailboxDebug`
- contact/thread identity helpers:
  - `threadIdToContactEmail`
  - `getGroupContactEmail`
  - `buildSelectedMessageRefs`
  - `replaceMessagesForThread`
  - `messageContentCounts`
- guide/setup helpers:
  - `defaultGuideState`
  - `normalizeGuideState`
  - `resolvedGuideStepForUi`
  - `currentPageContext`
  - `friendlyContextLabel`
- rendering helpers:
  - `formatDate`
  - `escapeHtml`
  - `formatActivityLine`
  - `renderActivityPanel`
- grouping and selection helpers:
  - `threadCounterparty`
  - `threadCounterpartyKey`
  - `groupByThread`
  - `findSelectedGroup`
  - `filteredMessages`
  - `snippetHealth`
- debug log helpers:
  - `formatCandidatePartsShort`
  - `buildDebugDiagnosis`
  - `buildThreadDebugReport`
  - `renderThreadDebug`
- mailbox/search behavior:
  - `loadMessages`
  - `setFilter`
  - `handleSearch`
- contact debug behavior:
  - `maybeDebugRefetchContact`
- detail rendering:
  - `renderThreads`
  - `renderThreadDetail`
- setup/onboarding behavior:
  - `updateGuideProgressUI`
  - `refreshGuideAndAuthState`
  - `guideConfirm`
  - `applyGmailLayoutMode`
  - `mapConnectError`
  - `setConnectUiState`
  - `connectFromGuide`
- DOM wiring:
  - `bindGuideEvents`
  - `buildSidebar`
  - `startAutoRefresh`
  - `bootGmailSurface`

Important current behavior:

- the left rail is intended to be person-based
- the detail view uses `state.selectedThreadId`, but in practice the thread ID is a contact-style
  key such as `contact:no-reply@accounts.google.com`
- when blank content is detected for a selected conversation, the file can trigger an automatic
  contact-level debug refetch through the service worker

Important current debug/logging behavior:

- the file contains a copyable "Temporary Debug Log" panel in the conversation area
- it includes mailbox-level and contact-level debug information
- it is intentionally temporary

Important quirks:

- function names still say "thread" in many places even though the active grouping direction is
  person/contact-centric
- this file is doing too many jobs at once
- a future split should preserve behavior very carefully

#### [apps/extension/content/styles.css](/Users/a_a_k/Downloads/EORG/apps/extension/content/styles.css)

Purpose:

- all major content-script styles for the active Mailita Gmail overlay

What it currently styles:

- full-screen shell
- left rail
- header actions
- search UI
- conversation detail panel
- onboarding overlay
- state/error cards
- debug panel
- activity panel

Important current role:

- several behavioral bugs have actually been CSS bugs, not JS bugs

Examples:

- onboarding overlay failing to disappear because `hidden` lost to explicit `display`
- left rail scroll not working because of layout/overflow/min-height behavior

Why this file matters:

- the product “looks too much like Gmail” problem is partly a design issue, but also partly just
  a CSS-direction issue that still lives in this file

Current risk:

- large, monolithic stylesheet
- likely contains a mix of stable product styling and temporary debugging styles

#### [apps/extension/popup/popup.html](/Users/a_a_k/Downloads/EORG/apps/extension/popup/popup.html)

Purpose:

- popup UI markup for setup and connected state

Current structure:

- onboarding wizard
- two-step setup card layout
- helper buttons for Google pages
- connected state summary

Why it matters:

- the popup is a separate, simpler setup surface from the in-Gmail overlay

#### [apps/extension/popup/popup.js](/Users/a_a_k/Downloads/EORG/apps/extension/popup/popup.js)

Purpose:

- popup behavior for onboarding and connected-state actions

Important elements and behavior:

- onboarding mode vs connected mode
- two-step wizard
- connect flow via service worker `CONNECT`
- guide state fetch/confirm calls
- sync and disconnect actions when connected
- helper buttons for App Passwords and 2-Step Verification

Important functions:

- `refreshPopupState`
- `connectFromOnboarding`
- `fetchGuideState`
- `confirmGuideStep`
- `mapConnectError`

Why it matters:

- this file is the fastest way to understand the intended setup flow without reading the more
  complex in-Gmail overlay logic

#### [apps/extension/README.md](/Users/a_a_k/Downloads/EORG/apps/extension/README.md)

Purpose:

- concise extension overview

Important value:

- documents the active backend URL and current product framing

### 23.3 Backend package

#### [apps/backend/server.js](/Users/a_a_k/Downloads/EORG/apps/backend/server.js)

Purpose:

- Express app entry point

Current responsibilities:

- load env
- create Express app
- set JSON body limit
- set CORS headers for Chrome extension requests
- mount routes:
  - `/health`
  - `/api/auth`
  - `/api/messages`
- global 500 handler
- keepalive timers

Important note:

- this file is intentionally small
- most backend behavior lives in route and lib files

#### [apps/backend/routes/health.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/health.js)

Purpose:

- health endpoint

Current response includes:

- `status`
- `timestamp`
- `uptime`
- `version`
- `buildSha`
- `deployedAt` if available

Why it matters:

- used to detect whether Render is on the expected build
- was important during the backend/frontend mismatch investigation

#### [apps/backend/routes/auth.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/auth.js)

Purpose:

- connect/disconnect backend routes

Endpoints:

- `POST /api/auth/connect`
- `DELETE /api/auth/disconnect`

Connect flow:

- validates email + app password
- calls IMAP `testConnection`
- encrypts app password
- upserts user into Supabase
- returns `userId`, `email`, and trace

Disconnect flow:

- validates `userId`
- loads existing user
- deletes user row from Supabase

Important helpers:

- `maskEmail`
- `isValidEmail`
- `pushDbTrace`

Why it matters:

- setup problems often cross this file, IMAP auth logic, and service-worker error normalization

#### [apps/backend/routes/messages.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/messages.js)

Purpose:

- main mailbox/search/debug/sync backend route file

This is the main backend orchestration file.

Key constants:

- `IMAP_FOLDERS`
  - `INBOX`
  - `[Gmail]/Sent Mail`

Important helper groups:

- request parsing:
  - `parseFolder`
  - `parseLimit`
  - `parseBoolean`
  - `getRequestedFolders`
- sorting and identity:
  - `sortByDateDesc`
  - `dedupeById`
- content analysis:
  - `hasPreviewContent`
  - `buildContentCoverage`
- contact matching:
  - `normalizeEmail`
  - `messageMatchesContact`
  - `filterMessagesByContact`
- DB access:
  - `getUser`
  - `loadCachedMessages`
  - `loadLatestCacheTimestamp`
  - `pruneOldCache`
  - `upsertMessages`
  - `updateLastSync`
- IMAP orchestration:
  - `fetchFromImap`
- response shaping:
  - `buildMailboxDebug`
  - `buildCounts`

Endpoints:

- `GET /api/messages`
  - mailbox load
  - checks cache freshness
  - returns cached rows if fresh enough and preview coverage is considered good enough
  - otherwise fetches live from IMAP
  - returns lightweight mailbox debug coverage info
- `POST /api/messages/debug/contact`
  - live debug refetch for a single contact
  - fetches large recent windows from IMAP
  - filters by contact
  - returns per-message extraction diagnostics
- `GET /api/messages/search`
  - cached search first
  - live IMAP search fallback
- `POST /api/messages/sync`
  - explicit manual sync

Important current behavior:

- normal mailbox route can still return cache if cache is fresh and preview coverage is good
- contact debug route is the heavy diagnostic endpoint
- per-message extraction details are only intended for the debug route

Important risk:

- this file mixes request validation, database access, caching policy, IMAP orchestration, and
  response formatting in one place

#### [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js)

Purpose:

- all major IMAP and extraction behavior

This is currently the most critical backend file.

Major areas inside the file:

- IMAP client creation:
  - `buildClient`
- fetch query construction:
  - `buildFetchQuery`
  - `describeFetchQuery`
  - `resolveFetchTarget`
- trace formatting:
  - `pushImapTrace`
  - `buildImapFailureDetails`
  - `logImapFailure`
- content parsing helpers:
  - `stripHtmlTags`
  - `sanitizeSnippet`
  - `streamToBuffer`
  - `parseBufferToText`
- MIME structure traversal:
  - `collectStructureNodes`
  - `buildStructureSummary`
  - `collectCandidateParts`
  - `selectBestCandidate`
  - `selectionStrategyForCandidate`
- extraction debug helpers:
  - `defaultExtractionDebug`
  - `finalizeExtractionDebug`
  - `pushFinalExtractionTrace`
- fallback path:
  - `attemptRawMessageFallback`
- main extraction flow:
  - `extractMessageContent`
- snippet attachment helper:
  - `attachSnippets`
- exported public functions:
  - `fetchMessages`
  - `searchMessages`
  - `testConnection`
  - `probeImapConnection`
  - `probeMailboxOpen`
  - `probeFetch`
  - `probeSearch`
  - `deriveThreadId`

Important current hypothesis encoded in this file:

- the main content failure is probably MIME-part selection/parsing, not lack of IMAP access

Important current local-only behavior:

- newer local code computes part paths during `BODYSTRUCTURE` traversal instead of assuming they
  already exist on nodes
- raw full-message fallback is attempted when part selection/download/parsing fails

Important current risk:

- this file is large enough that small extraction changes can have unintended side effects
- changes here should always be paired with explicit syntax checks and careful log review

#### [apps/backend/lib/message-normalize.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/message-normalize.js)

Purpose:

- maps between IMAP messages, frontend messages, and Supabase rows

Exports:

- `normalizeImapMessage`
- `mapRowToMessage`
- `mapMessageToRow`

Important details:

- determines `isOutgoing`
- normalizes addresses and dates
- carries `snippet`
- carries `debug` through from IMAP messages into live responses
- cached rows are mapped back with `debug: null`

Why it matters:

- this file is small, but very important because shape mismatches here propagate everywhere

#### [apps/backend/lib/build-info.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/build-info.js)

Purpose:

- returns backend build/version metadata

Current behavior:

- version from backend `package.json`
- build SHA from `RENDER_GIT_COMMIT` or `unknown`
- deploy timestamp/id from Render env if available

Why it matters:

- this file was added because deploy mismatch was a real debugging problem

#### [apps/backend/lib/errors.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/errors.js)

Purpose:

- shared backend error shaping and trace utilities

Key pieces:

- `AppError`
- `sanitizeTraceDetails`
- `pushTrace`
- `buildConnectFailure`
- `buildErrorResponse`
- `parseImapError`

Why it matters:

- this file defines the shared backend error contract that the service worker and UI depend on

#### [apps/backend/lib/crypto.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/crypto.js)

Purpose:

- encrypt/decrypt stored Gmail App Passwords

Important details:

- uses `aes-256-cbc`
- requires a 32-byte `ENCRYPTION_KEY`
- throws an `AppError` if env config is invalid

Why it matters:

- connect flow and IMAP fetch depend on this working correctly

#### [apps/backend/lib/supabase.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/supabase.js)

Purpose:

- creates the shared Supabase client

Important details:

- requires:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
- no persisted session / no auto refresh

Why it matters:

- this file is small but it is the backend boot gate; missing env vars fail the backend

#### [apps/backend/README.md](/Users/a_a_k/Downloads/EORG/apps/backend/README.md)

Purpose:

- concise backend overview

Useful for:

- quick endpoint list
- boot commands

### 23.4 Supporting docs that still matter

#### [docs/engineering-handoff-2026-03-01.md](/Users/a_a_k/Downloads/EORG/docs/engineering-handoff-2026-03-01.md)

Purpose:

- older deep handoff from a previous extension generation / phase

Why it still matters:

- contains historical reasoning and earlier product direction

Why it is not the main truth source now:

- parts of it refer to older files and runtime architecture that are not the active Mailita
  implementation for the current stack

#### [docs/thread-reply.md](/Users/a_a_k/Downloads/EORG/docs/thread-reply.md)

Purpose:

- older documentation around reply/send flow

Current relevance:

- useful historical reference, but not the main current blocker

### 23.5 Quick dependency graph

This is a simplified runtime dependency map.

Extension side:

- `manifest.json`
  - loads `background/service-worker.js`
  - loads `content/gmail-inject.js`
  - loads `content/styles.css`
  - loads `popup/popup.html`
- `popup/popup.html`
  - runs `popup/popup.js`
- `content/gmail-inject.js`
  - talks to `background/service-worker.js`
- `background/service-worker.js`
  - talks to backend Render API

Backend side:

- `server.js`
  - mounts `routes/health.js`
  - mounts `routes/auth.js`
  - mounts `routes/messages.js`
- `routes/auth.js`
  - uses `lib/imap.js`
  - uses `lib/crypto.js`
  - uses `lib/supabase.js`
  - uses `lib/errors.js`
- `routes/messages.js`
  - uses `lib/imap.js`
  - uses `lib/crypto.js`
  - uses `lib/supabase.js`
  - uses `lib/message-normalize.js`
  - uses `lib/build-info.js`
  - uses `lib/errors.js`
- `routes/health.js`
  - uses `lib/build-info.js`

### 23.6 If another AI needs to start debugging immediately

If another AI opens this doc and wants the fastest route to productive debugging, it should:

1. Read the current missing-content history in Sections 7, 8, 9, and 15.
2. Check whether local HEAD is still `4bc8ecb` or newer.
3. Check whether the deployed backend build SHA matches local expectations.
4. Read:
   - [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js)
   - [apps/backend/routes/messages.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/messages.js)
   - [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js)
   - [apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js)
5. If content is still blank after deploying the latest backend:
   - inspect `structure_summary`
   - inspect `candidate_parts`
   - inspect `selection_strategy`
   - inspect `fallback_stage`
   - inspect `final_content_source`
   - inspect `final_empty_reason`
6. If push access is still broken, treat local and deployed states as separate realities and
   say so explicitly.
