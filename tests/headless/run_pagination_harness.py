#!/usr/bin/env python3
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright


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


async def run_case(page, html_uri: str, content_js: str, model_script: str):
    await page.goto(html_uri + '#inbox')
    await page.add_script_tag(content=model_script)
    await page.add_script_tag(content=content_js)


async def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    html_path = repo_root / 'tests' / 'headless' / 'chat_harness.html'
    content_path = repo_root / 'content.js'
    html_uri = html_path.as_uri()
    content_js = content_path.read_text(encoding='utf-8')

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        # Case 1: initial empty render self-recovers without filter hopping.
        page_empty = await browser.new_page()
        page_empty.on('console', lambda msg: print(f"EMPTY_CONSOLE[{msg.type}] {msg.text}"))
        await run_case(page_empty, html_uri, content_js, EMPTY_THEN_ROWS_SCRIPT)
        await page_empty.wait_for_selector('#reskin-root .rv-list', timeout=12000)
        empty_initial = await page_empty.evaluate(
            """
            () => ({
              itemCount: document.querySelectorAll('#reskin-root .rv-item').length,
              hash: String(window.location.hash || ''),
              delayedLoaded: Boolean(window.__emptyCaseRowsLoaded)
            })
            """
        )
        await page_empty.wait_for_function(
            """
            () => {
              const count = document.querySelectorAll('#reskin-root .rv-item').length;
              return count > 0 && Boolean(window.__emptyCaseRowsLoaded);
            }
            """,
            timeout=20000,
        )
        empty_recovered = True
        empty_after = await page_empty.evaluate(
            """
            () => ({
              itemCount: document.querySelectorAll('#reskin-root .rv-item').length,
              hash: String(window.location.hash || ''),
              delayedLoaded: Boolean(window.__emptyCaseRowsLoaded)
            })
            """
        )

        # Case 2: full pagination scan goes beyond first 50.
        page_pagination = await browser.new_page()
        page_pagination.on('console', lambda msg: print(f"PAGINATION_CONSOLE[{msg.type}] {msg.text}"))
        await run_case(page_pagination, html_uri, content_js, PAGINATION_SCRIPT)
        await page_pagination.wait_for_selector('#reskin-root .rv-item', timeout=12000)
        await page_pagination.wait_for_function(
            """
            () => {
              const count = document.querySelectorAll('#reskin-root .rv-item').length;
              const statusNode = document.querySelector('#reskin-root .rv-triage-status:last-child');
              const status = ((statusNode && statusNode.textContent) || '').toLowerCase();
              return count >= 117 || status.includes('cached 117') || status.includes('117 emails');
            }
            """,
            timeout=45000,
        )
        pagination_result = await page_pagination.evaluate(
            """
            () => {
              const count = document.querySelectorAll('#reskin-root .rv-item').length;
              const loadMore = document.querySelector('#reskin-root .rv-list-more');
              const statuses = Array.from(document.querySelectorAll('#reskin-root .rv-triage-status'))
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
        await run_case(page_preempt, html_uri, content_js, SCAN_PREEMPTION_SCRIPT)
        await page_preempt.wait_for_selector('#reskin-root .rv-item', timeout=12000)
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
              itemCount: document.querySelectorAll('#reskin-root .rv-item').length
            })
            """
        )
        await page_preempt.click('#reskin-root .rv-item')
        await page_preempt.wait_for_selector('#reskin-root .rv-thread-msg', timeout=12000)
        await page_preempt.wait_for_timeout(1200)
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
