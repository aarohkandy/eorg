#!/usr/bin/env python3
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

from diag_client import (
    enable_e2e_diag,
    get_recent_diag,
    run_with_diag_timeout,
    set_diag_mode,
    wait_for_diagnostic_code,
    wait_for_run_terminal,
    new_diag_token,
)
from harness_loader import inject_content_runtime

EMPTY_THEN_ROWS_SCRIPT = r'''
(() => {
  const main = document.querySelector('main[role="main"]');
  if (!(main instanceof HTMLElement)) return;
  main.innerHTML = '';

  const PAGE_SIZE = 50;
  let total = 0;
  let pageIndex = 0;

  const controls = document.createElement('div');
  controls.id = 'pager-controls';
  controls.innerHTML = `
    <button id="pager-prev" role="button" aria-label="Newer">Newer</button>
    <button id="pager-next" role="button" aria-label="Older">Older</button>
  `;
  main.prepend(controls);

  const table = document.createElement('table');
  table.id = 'page-table';
  main.appendChild(table);

  const prev = controls.querySelector('#pager-prev');
  const next = controls.querySelector('#pager-next');

  const buildRow = (idx) => `
    <tr role="row" class="zA" data-thread-id="#thread-f:${200000 + idx}" aria-label="delayed${idx}@example.com, delayed subject ${idx}, Feb 25">
      <td><span class="yP">delayed${idx}@example.com</span></td>
      <td><span class="bog">Delayed Subject ${idx}</span></td>
      <td><span class="y2">Delayed Snippet ${idx}</span></td>
      <td><span>Feb 25</span></td>
      <td><a href="#inbox/thread-f:${200000 + idx}">open</a></td>
    </tr>
  `;

  const renderPage = () => {
    const hash = (window.location.hash || '#inbox').toLowerCase();
    const inInbox = hash.startsWith('#inbox');

    if (!inInbox) {
      table.innerHTML = '';
      prev.setAttribute('aria-disabled', 'true');
      next.setAttribute('aria-disabled', 'true');
      return;
    }

    const start = pageIndex * PAGE_SIZE;
    const end = Math.min(total, start + PAGE_SIZE);
    const rows = [];
    for (let i = start; i < end; i += 1) rows.push(buildRow(i));
    table.innerHTML = rows.join('');

    prev.setAttribute('aria-disabled', pageIndex <= 0 ? 'true' : 'false');
    next.setAttribute('aria-disabled', end >= total ? 'true' : 'false');
  };

  prev.addEventListener('click', (event) => {
    event.preventDefault();
    if (pageIndex <= 0) return;
    pageIndex -= 1;
    renderPage();
  });

  next.addEventListener('click', (event) => {
    event.preventDefault();
    if ((pageIndex + 1) * PAGE_SIZE >= total) return;
    pageIndex += 1;
    renderPage();
  });

  window.addEventListener('hashchange', () => {
    if ((window.location.hash || '').toLowerCase().startsWith('#inbox') && pageIndex < 0) {
      pageIndex = 0;
    }
    renderPage();
  });

  renderPage();

  setTimeout(() => {
    total = 35;
    pageIndex = 0;
    window.__emptyCaseRowsLoaded = true;
    renderPage();
  }, 950);
})();
'''


PAGINATION_SCRIPT = r'''
(() => {
  const main = document.querySelector('main[role="main"]');
  if (!(main instanceof HTMLElement)) return;
  main.innerHTML = '';

  const TOTAL = 117;
  const PAGE_SIZE = 50;
  let pageIndex = 0;

  const controls = document.createElement('div');
  controls.id = 'pager-controls';
  controls.innerHTML = `
    <button id="pager-prev" role="button" aria-label="Newer">Newer</button>
    <button id="pager-next" role="button" aria-label="Older">Older</button>
  `;
  main.prepend(controls);

  const table = document.createElement('table');
  table.id = 'page-table';
  main.appendChild(table);

  const prev = controls.querySelector('#pager-prev');
  const next = controls.querySelector('#pager-next');

  const buildRow = (idx) => `
    <tr role="row" class="zA" data-thread-id="#thread-f:${100000 + idx}" aria-label="sender${idx}@example.com, subject ${idx}, Feb 25">
      <td><span class="yP">sender${idx}@example.com</span></td>
      <td><span class="bog">Subject ${idx}</span></td>
      <td><span class="y2">Snippet ${idx}</span></td>
      <td><span>Feb 25</span></td>
      <td><a href="#inbox/thread-f:${100000 + idx}">open</a></td>
    </tr>
  `;

  const renderPage = () => {
    const hash = (window.location.hash || '#inbox').toLowerCase();
    const inInbox = hash.startsWith('#inbox');

    if (!inInbox) {
      table.innerHTML = '';
      prev.setAttribute('aria-disabled', 'true');
      next.setAttribute('aria-disabled', 'true');
      return;
    }

    const start = pageIndex * PAGE_SIZE;
    const end = Math.min(TOTAL, start + PAGE_SIZE);
    const rows = [];
    for (let i = start; i < end; i += 1) rows.push(buildRow(i));
    table.innerHTML = rows.join('');

    prev.setAttribute('aria-disabled', pageIndex <= 0 ? 'true' : 'false');
    next.setAttribute('aria-disabled', end >= TOTAL ? 'true' : 'false');
  };

  prev.addEventListener('click', (event) => {
    event.preventDefault();
    if (pageIndex <= 0) return;
    pageIndex -= 1;
    renderPage();
  });

  next.addEventListener('click', (event) => {
    event.preventDefault();
    if ((pageIndex + 1) * PAGE_SIZE >= TOTAL) return;
    pageIndex += 1;
    renderPage();
  });

  window.addEventListener('hashchange', () => {
    if ((window.location.hash || '').toLowerCase().startsWith('#inbox') && pageIndex < 0) {
      pageIndex = 0;
    }
    renderPage();
  });

  renderPage();
})();
'''


SCAN_PREEMPTION_SCRIPT = r'''
(() => {
  const main = document.querySelector('main[role="main"]');
  if (!(main instanceof HTMLElement)) return;
  main.innerHTML = '';

  const TOTAL = 220;
  const PAGE_SIZE = 50;
  let pageIndex = 0;
  let busy = false;
  window.__scanNextClicks = 0;

  const controls = document.createElement('div');
  controls.id = 'pager-controls';
  controls.innerHTML = `
    <button id="pager-prev" role="button" aria-label="Newer">Newer</button>
    <button id="pager-next" role="button" aria-label="Older">Older</button>
  `;
  main.prepend(controls);

  const table = document.createElement('table');
  table.id = 'page-table';
  main.appendChild(table);

  const prev = controls.querySelector('#pager-prev');
  const next = controls.querySelector('#pager-next');

  const buildRow = (idx) => {
    const contact = `scan${idx % 8}@example.com`;
    return `
      <tr role="row" class="zA" data-thread-id="#thread-f:${300000 + idx}" aria-label="${contact}, scan subject ${idx}, Feb 25">
        <td><span class="yP">${contact}</span></td>
        <td><span class="bog">Scan Subject ${idx}</span></td>
        <td><span class="y2">Scan Snippet ${idx}</span></td>
        <td><span>Feb 25</span></td>
        <td><a href="#inbox/thread-f:${300000 + idx}">open</a></td>
      </tr>
    `;
  };

  const renderPage = () => {
    const hash = (window.location.hash || '#inbox').toLowerCase();
    const inInbox = hash.startsWith('#inbox');
    if (!inInbox) {
      table.innerHTML = '';
      prev.setAttribute('aria-disabled', 'true');
      next.setAttribute('aria-disabled', 'true');
      return;
    }

    const start = pageIndex * PAGE_SIZE;
    const end = Math.min(TOTAL, start + PAGE_SIZE);
    const rows = [];
    for (let i = start; i < end; i += 1) rows.push(buildRow(i));
    table.innerHTML = rows.join('');

    prev.setAttribute('aria-disabled', pageIndex <= 0 || busy ? 'true' : 'false');
    next.setAttribute('aria-disabled', end >= TOTAL || busy ? 'true' : 'false');
  };

  const delayedRender = (delta) => {
    if (busy) return;
    busy = true;
    prev.setAttribute('aria-disabled', 'true');
    next.setAttribute('aria-disabled', 'true');
    setTimeout(() => {
      pageIndex = Math.max(0, pageIndex + delta);
      busy = false;
      renderPage();
    }, 220);
  };

  prev.addEventListener('click', (event) => {
    event.preventDefault();
    if (busy || pageIndex <= 0) return;
    delayedRender(-1);
  });

  next.addEventListener('click', (event) => {
    event.preventDefault();
    if (busy || (pageIndex + 1) * PAGE_SIZE >= TOTAL) return;
    window.__scanNextClicks += 1;
    delayedRender(1);
  });

  window.addEventListener('hashchange', () => {
    if ((window.location.hash || '').toLowerCase().startsWith('#inbox') && pageIndex < 0) {
      pageIndex = 0;
    }
    renderPage();
  });

  renderPage();
})();
'''


async def run_case(page, repo_root: Path, html_uri: str, model_script: str):
    await page.goto(html_uri + '#inbox')
    await page.add_script_tag(content=model_script)
    await inject_content_runtime(page, repo_root, skip_files={"inboxsdk.js"})
    await page.evaluate(
        """
        () => {
          window.__reskinRoot = () => {
            const host = document.querySelector('#rv-shadow-host');
            return (host && host.shadowRoot && host.shadowRoot.querySelector('#reskin-root'))
              || document.querySelector('#reskin-root');
          };
          window.__reskinQuery = (selector) => {
            const root = window.__reskinRoot && window.__reskinRoot();
            return root ? root.querySelector(selector) : null;
          };
          window.__reskinQueryAll = (selector) => {
            const root = window.__reskinRoot && window.__reskinRoot();
            return root ? Array.from(root.querySelectorAll(selector)) : [];
          };
        }
        """
    )


async def latest_diag_seq(page, token: str) -> int:
    recent = await get_recent_diag(page, token, limit=1)
    if not recent:
        return 0
    event = recent[-1] if isinstance(recent[-1], dict) else {}
    try:
        return int(event.get("seq") or 0)
    except Exception:
        return 0


async def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    html_path = repo_root / 'tests' / 'headless' / 'chat_harness.html'
    artifacts_dir = repo_root / 'tests' / 'headless' / 'artifacts'
    html_uri = html_path.as_uri()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # Case 1: initial empty render self-recovers without filter hopping.
        page_empty = await browser.new_page()
        page_empty.on('console', lambda msg: print(f"EMPTY_CONSOLE[{msg.type}] {msg.text}"))
        await run_case(page_empty, repo_root, html_uri, EMPTY_THEN_ROWS_SCRIPT)
        empty_token = new_diag_token("pagination-empty")
        await enable_e2e_diag(page_empty, empty_token, ttl_ms=10 * 60 * 1000)
        await set_diag_mode(page_empty, "important", empty_token)
        await run_with_diag_timeout(
            "pagination-empty-ui-ready",
            page_empty.wait_for_selector('#rv-shadow-host >> .rv-list', timeout=12000),
            page=page_empty,
            token=empty_token,
            artifacts_dir=artifacts_dir,
            timeout_ms=13000,
        )
        empty_initial = await page_empty.evaluate(
            """
            () => ({
              itemCount: window.__reskinQueryAll('.rv-item').length,
              hash: String(window.location.hash || ''),
              delayedLoaded: Boolean(window.__emptyCaseRowsLoaded)
            })
            """
        )
        await page_empty.wait_for_function(
            """
            () => {
              const count = window.__reskinQueryAll('.rv-item').length;
              return count > 0 && Boolean(window.__emptyCaseRowsLoaded);
            }
            """,
            timeout=20000,
        )
        empty_recovered = True
        empty_after = await page_empty.evaluate(
            """
            () => ({
              itemCount: window.__reskinQueryAll('.rv-item').length,
              hash: String(window.location.hash || ''),
              delayedLoaded: Boolean(window.__emptyCaseRowsLoaded)
            })
            """
        )

        # Case 2: full pagination scan goes beyond first 50.
        page_pagination = await browser.new_page()
        page_pagination.on('console', lambda msg: print(f"PAGINATION_CONSOLE[{msg.type}] {msg.text}"))
        await run_case(page_pagination, repo_root, html_uri, PAGINATION_SCRIPT)
        pagination_token = new_diag_token("pagination-main")
        await enable_e2e_diag(page_pagination, pagination_token, ttl_ms=10 * 60 * 1000)
        await set_diag_mode(page_pagination, "important", pagination_token)
        await run_with_diag_timeout(
            "pagination-main-list-ready",
            page_pagination.wait_for_selector('#rv-shadow-host >> .rv-item', timeout=12000),
            page=page_pagination,
            token=pagination_token,
            artifacts_dir=artifacts_dir,
            timeout_ms=13000,
        )
        scan_start = await run_with_diag_timeout(
            "pagination-scan-start",
            wait_for_diagnostic_code(
                page_pagination,
                "S100",
                token=pagination_token,
                timeout_ms=25000,
            ),
            page=page_pagination,
            token=pagination_token,
            artifacts_dir=artifacts_dir,
            timeout_ms=26000,
        )
        await run_with_diag_timeout(
            "pagination-scan-done",
            wait_for_diagnostic_code(
                page_pagination,
                "S180",
                token=pagination_token,
                after_seq=scan_start.get("seq"),
                timeout_ms=45000,
            ),
            page=page_pagination,
            token=pagination_token,
            artifacts_dir=artifacts_dir,
            timeout_ms=46000,
        )
        pagination_result = await page_pagination.evaluate(
            """
            () => {
              const count = window.__reskinQueryAll('.rv-item').length;
              const loadMore = window.__reskinQuery('.rv-list-more');
              const statuses = Array.from(window.__reskinQueryAll('.rv-triage-status'))
                .map((node) => ((node && node.textContent) || '').trim());
              return {
                renderedCount: count,
                hasLoadMore: Boolean(loadMore),
                statuses,
              };
            }
            """
        )

        # Case 3: scan preemption while opening conversation.
        page_preempt = await browser.new_page()
        page_preempt.on('console', lambda msg: print(f"PREEMPT_CONSOLE[{msg.type}] {msg.text}"))
        await run_case(page_preempt, repo_root, html_uri, SCAN_PREEMPTION_SCRIPT)
        preempt_token = new_diag_token("pagination-preempt")
        await enable_e2e_diag(page_preempt, preempt_token, ttl_ms=10 * 60 * 1000)
        await set_diag_mode(page_preempt, "important", preempt_token)
        await run_with_diag_timeout(
            "pagination-preempt-list-ready",
            page_preempt.wait_for_selector('#rv-shadow-host >> .rv-item', timeout=12000),
            page=page_preempt,
            token=preempt_token,
            artifacts_dir=artifacts_dir,
            timeout_ms=13000,
        )
        await page_preempt.wait_for_function(
            """
            () => (typeof window.__scanNextClicks === 'number') && window.__scanNextClicks >= 1
            """,
            timeout=20000,
        )
        scan_before = await page_preempt.evaluate(
            """
            () => ({
              nextClicks: Number(window.__scanNextClicks || 0),
              itemCount: window.__reskinQueryAll('.rv-item').length
            })
            """
        )
        preempt_after_seq = await latest_diag_seq(page_preempt, preempt_token)
        await page_preempt.click('#rv-shadow-host >> .rv-item')
        open_shell = await run_with_diag_timeout(
            "pagination-preempt-open-shell",
            wait_for_diagnostic_code(
                page_preempt,
                "O130",
                token=preempt_token,
                run_type="open",
                after_seq=preempt_after_seq,
                timeout_ms=8000,
            ),
            page=page_preempt,
            token=preempt_token,
            artifacts_dir=artifacts_dir,
            timeout_ms=9000,
        )
        open_run_id = str((open_shell.get("event") or {}).get("r") or "")
        if open_run_id:
            await run_with_diag_timeout(
                "pagination-preempt-open-terminal",
                wait_for_run_terminal(
                    page_preempt,
                    open_run_id,
                    token=preempt_token,
                    timeout_ms=10000,
                    after_seq=open_shell.get("seq"),
                ),
                page=page_preempt,
                token=preempt_token,
                artifacts_dir=artifacts_dir,
                timeout_ms=11000,
            )
        await page.wait_for_selector('#rv-shadow-host >> .rv-thread-msg', timeout=12000)
        preempt_result = await page_preempt.evaluate(
            """
            async () => {
              const debug = window.ReskinChatDebug && typeof window.ReskinChatDebug.dumpState === 'function'
                ? await window.ReskinChatDebug.dumpState()
                : {};
              return {
                nextClicks: Number(window.__scanNextClicks || 0),
                view: String((debug && debug.view) || ''),
                scanPaused: Boolean(debug && debug.scanPaused),
                scanPauseReason: String((debug && debug.scanPauseReason) || ''),
                activeTask: String((debug && debug.activeTask) || ''),
                interactionEpoch: Number((debug && debug.interactionEpoch) || 0)
              };
            }
            """
        )

        await browser.close()

    print('EMPTY_RECOVERY_INITIAL', empty_initial)
    print('EMPTY_RECOVERY_AFTER', empty_after)
    print('PAGINATION_RESULT', pagination_result)
    print('SCAN_PREEMPT_BEFORE', scan_before)
    print('SCAN_PREEMPT_AFTER', preempt_result)

    ok_empty_recovery = (
        empty_recovered is True
        and empty_after.get('delayedLoaded') is True
        and empty_after.get('itemCount', 0) > 0
        and (
            empty_initial.get('itemCount', 0) == 0
            or empty_initial.get('delayedLoaded') is True
        )
    )
    ok_pagination = (
        pagination_result.get('renderedCount', 0) >= 117
        and pagination_result.get('hasLoadMore') is False
    )
    next_before = int(scan_before.get('nextClicks', 0) or 0)
    next_after = int(preempt_result.get('nextClicks', 0) or 0)
    next_delta = max(0, next_after - next_before)
    ok_preemption = (
        preempt_result.get('view') == 'thread'
        and next_delta <= 1
        and preempt_result.get('scanPaused') is True
        and bool(str(preempt_result.get('scanPauseReason', '')).strip())
    )

    return 0 if ok_empty_recovery and ok_pagination and ok_preemption else 1


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
