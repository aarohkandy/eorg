#!/usr/bin/env python3
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright


PAGE_MODEL_SCRIPT = r'''
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
    <tr role="row" class="zA" data-thread-id="#thread-f:${100000 + idx}" aria-label="sender${idx}, subject ${idx}, Feb 25">
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
    if ((window.location.hash || '').toLowerCase().startsWith('#inbox')) {
      if (pageIndex < 0) pageIndex = 0;
    }
    renderPage();
  });

  renderPage();
})();
'''


async def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    html_path = repo_root / 'tests' / 'headless' / 'chat_harness.html'
    content_path = repo_root / 'content.js'

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.on('console', lambda msg: print(f"CONSOLE[{msg.type}] {msg.text}"))
        await page.goto(html_path.as_uri() + '#inbox')
        await page.add_script_tag(content=PAGE_MODEL_SCRIPT)
        await page.add_script_tag(content=content_path.read_text(encoding='utf-8'))

        await page.wait_for_selector('#reskin-root .rv-item', timeout=12000)
        await page.wait_for_function(
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

        result = await page.evaluate(
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

        await browser.close()

    print('PAGINATION_RESULT', result)
    ok = result.get('renderedCount', 0) >= 117 and result.get('hasLoadMore') is False
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
