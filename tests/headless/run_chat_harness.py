#!/usr/bin/env python3
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright


STUB_AI = r'''
(() => {
  const settings = {
    enabled: false,
    consentTriage: false,
    provider: "groq",
    apiKey: "test",
    model: "llama-3.1-8b-instant",
    batchSize: 5,
    timeoutMs: 30000,
    retryCount: 0,
    retryBackoffMs: 300,
    maxInputChars: 2200
  };
  window.ReskinAI = {
    GROQ_FREE_MODELS: ["llama-3.1-8b-instant"],
    loadSettings: async () => ({ ...settings }),
    saveSettings: async (patch) => ({ ...settings, ...(patch || {}) }),
    testConnection: async () => ({ ok: true }),
    triageBatch: async () => [],
    chat: async (messages) => {
      const text = Array.isArray(messages) && messages[1] ? String(messages[1].content || "") : "";
      return text.includes("yesterday")
        ? "Yesterday: security alert from alerts@example.com"
        : "Summary OK";
    }
  };
})();
'''


async def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    html_path = repo_root / "tests" / "headless" / "chat_harness.html"
    content_path = repo_root / "content.js"
    triage_path = repo_root / "triage.js"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.on("console", lambda msg: print(f"CONSOLE[{msg.type}] {msg.text}"))
        await page.goto(html_path.as_uri() + "#inbox")
        await page.add_script_tag(content=STUB_AI)
        await page.add_script_tag(content=triage_path.read_text(encoding="utf-8"))
        await page.add_script_tag(content=content_path.read_text(encoding="utf-8"))
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

        await page.wait_for_selector("#rv-shadow-host >> .rv-ai-qa-input", timeout=10000)
        debug_bridge_result = await page.evaluate(
            """
            async () => {
              if (!window.ReskinChatDebug) return { ok: false, reason: "missing-global" };
              try {
                const state = await window.ReskinChatDebug.dumpState();
                return {
                  ok: Boolean(state && typeof state === 'object'),
                  hasThreadContext: Boolean(state && state.threadContext && typeof state.threadContext === 'object')
                };
              } catch (error) {
                return {
                  ok: false,
                  reason: String(error && error.message ? error.message : error || "unknown")
                };
              }
            }
            """
        )
        startup_filter_result = await page.evaluate(
            """
            () => {
              const hash = String(window.location.hash || "");
              return {
                hash,
                hasTriage: /[?&]triage=/i.test(hash)
              };
            }
            """
        )
        await page.fill("#rv-shadow-host >> .rv-ai-qa-input", "what happened yesterday")
        await page.click("#rv-shadow-host >> .rv-ai-qa-submit")
        await page.wait_for_function(
            """
            () => {
              const nodes = Array.from(window.__reskinQueryAll('.rv-chat-msg.is-assistant .rv-chat-bubble'));
              if (!nodes.length) return false;
              const text = (nodes[nodes.length - 1].textContent || '').trim();
              return text.length > 0 && !/^Thinking\\.{0,3}$/i.test(text);
            }
            """,
            timeout=12000,
        )
        answer = await page.evaluate(
            """
            () => {
              const nodes = Array.from(window.__reskinQueryAll('.rv-chat-msg.is-assistant .rv-chat-bubble'));
              if (!nodes.length) return '';
              return (nodes[nodes.length - 1].textContent || '').trim();
            }
            """
        )

        await page.evaluate(
            """
            () => {
              const main = document.querySelector('main[role="main"]');
              if (!(main instanceof HTMLElement)) return;
              main.innerHTML = `
                <section class="h7">
                  <div data-message-id="msg-a">
                    <span class="gD" email="alerts@example.com">alerts@example.com</span>
                    <span class="g3" title="Feb 25, 2026, 4:51 PM">Feb 25</span>
                    <div class="a3s aiL">same-body-text</div>
                  </div>
                  <div data-message-id="msg-b">
                    <span class="gD" email="alerts@example.com">alerts@example.com</span>
                    <span class="g3" title="Feb 25, 2026, 4:52 PM">Feb 25</span>
                    <div class="a3s aiL">same-body-text</div>
                  </div>
                </section>
              `;
              window.location.hash = '#thread-f:111';
            }
            """
        )
        await page.wait_for_selector("#rv-shadow-host >> .rv-thread-msg", timeout=10000)
        dedup_result = await page.evaluate(
            """
            () => {
              const bodies = Array.from(window.__reskinQueryAll('.rv-thread-msg .rv-thread-msg-body'))
                .map((node) => ((node && node.textContent) || '').trim())
                .filter(Boolean);
              return {
                count: bodies.length,
                sameBodyCount: bodies.filter((text) => text === 'same-body-text').length,
                bodies
              };
            }
            """
        )

        await page.evaluate(
            """
            () => {
              let accountNode = document.getElementById('acct');
              if (!(accountNode instanceof HTMLElement)) {
                accountNode = document.createElement('div');
                accountNode.id = 'acct';
                document.body.appendChild(accountNode);
              }
              accountNode.setAttribute('data-email', 'me@example.com');
              accountNode.textContent = 'me@example.com';

              const main = document.querySelector('main[role="main"]');
              if (!(main instanceof HTMLElement)) return;
              main.innerHTML = `
                <table>
                  <tr role="row" class="zA" data-thread-id="thread-f:222" aria-label="aaroh@example.com, hello, Feb 25">
                    <td><span class="yP">aaroh@example.com</span></td>
                    <td><span class="bog">Hello Thread</span></td>
                    <td><span class="y2">HELLOOOOO</span></td>
                    <td><span>Feb 25</span></td>
                    <td><a href="#inbox/thread-f:222">open</a></td>
                  </tr>
                  <tr role="row" class="zA" data-thread-id="thread-f:223" aria-label="me@example.com to aaroh@example.com, Feb 25">
                    <td><span class="yP">me@example.com</span></td>
                    <td><span class="bog">Reply Thread</span></td>
                    <td><span class="y2">MY-REPLY</span></td>
                    <td><span>Feb 25</span></td>
                    <td><a href="#sent/thread-f:223">open</a></td>
                  </tr>
                </table>
              `;
              const threadMarkup = {
                "thread-f:222": `
                  <section class="h7">
                    <div data-message-id="msg-222-a">
                      <span class="gD" email="aaroh@example.com">aaroh@example.com</span>
                      <span class="g3" title="Feb 25">Feb 25</span>
                      <div class="a3s aiL">HELLOOOOO</div>
                    </div>
                    <div data-message-id="msg-222-b">
                      <span class="gD" email="aaroh@example.com">aaroh@example.com</span>
                      <span class="g3" title="Feb 25">Feb 25</span>
                      <div class="a3s aiL">SAME-DOUBLE</div>
                    </div>
                    <div data-message-id="msg-222-c">
                      <span class="gD" email="aaroh@example.com">aaroh@example.com</span>
                      <span class="g3" title="Feb 25">Feb 25</span>
                      <div class="a3s aiL">SAME-DOUBLE</div>
                    </div>
                  </section>
                `,
                "thread-f:223": `
                  <section class="h7">
                    <div data-message-id="msg-223-a">
                      <span class="gD" email="me@example.com">me@example.com</span>
                      <span class="g3" title="Feb 25">Feb 25</span>
                      <div class="a3s aiL">MY-REPLY</div>
                    </div>
                  </section>
                `
              };
              const mountThread = (threadId, updateHash = true) => {
                const markup = threadMarkup[threadId];
                if (!markup) return false;
                main.innerHTML = markup;
                if (updateHash) {
                  const nextHash = `#inbox/${threadId}`;
                  if (window.location.hash !== nextHash) {
                    window.location.hash = nextHash;
                  }
                }
                return true;
              };
              const mountThreadFromHash = () => {
                const hash = String(window.location.hash || "");
                const match = hash.match(/(thread-f:[A-Za-z0-9_-]+)/i);
                if (!match || !match[1]) return;
                mountThread(match[1], false);
              };
              if (!window.__chatHarnessThreadHashBound) {
                window.addEventListener('hashchange', mountThreadFromHash);
                window.__chatHarnessThreadHashBound = true;
              }
              for (const row of Array.from(main.querySelectorAll('tr[role="row"]'))) {
                row.addEventListener('click', (event) => {
                  event.preventDefault();
                  const threadId = String(row.getAttribute('data-thread-id') || '').replace(/^#/, '');
                  mountThread(threadId || 'thread-f:222');
                });
              }
              for (const link of Array.from(main.querySelectorAll('a[href]'))) {
                link.addEventListener('click', (event) => {
                  event.preventDefault();
                  const href = String(link.getAttribute('href') || '');
                  const match = href.match(/(thread-f:[A-Za-z0-9_-]+)/i);
                  const threadId = match && match[1] ? match[1] : 'thread-f:222';
                  mountThread(threadId);
                });
              }
              window.location.hash = '#inbox';
            }
            """
        )
        await page.wait_for_selector("#rv-shadow-host >> .rv-item", timeout=12000)
        canonical_group_result = await page.evaluate(
            """
            () => {
              const labels = Array.from(window.__reskinQueryAll('.rv-item .rv-item-name'))
                .map((node) => ((node && node.textContent) || '').trim());
              const aarohCount = labels.filter((label) => /aaroh/i.test(label)).length;
              return {
                listCount: window.__reskinQueryAll('.rv-item').length,
                aarohCount,
                labels
              };
            }
            """
        )
        clicked_aaroh = await page.evaluate(
            """
            () => {
              const items = Array.from(window.__reskinQueryAll('.rv-item'));
              for (const item of items) {
                const name = ((item.querySelector('.rv-item-name') || {}).textContent || '').trim();
                if (/aaroh/i.test(name)) {
                  item.click();
                  return true;
                }
              }
              if (items[0]) {
                items[0].click();
              }
              return false;
            }
            """
        )
        await page.wait_for_selector("#rv-shadow-host >> .rv-thread-msg", timeout=12000)
        await page.wait_for_function(
            """
            () => {
              const bodies = Array.from(window.__reskinQueryAll('.rv-thread-msg .rv-thread-msg-body'))
                .map((node) => ((node && node.textContent) || '').trim())
                .filter(Boolean);
              const hasHello = bodies.includes('HELLOOOOO');
              const hasReply = bodies.includes('MY-REPLY');
              return hasHello && hasReply;
            }
            """,
            timeout=12000,
        )
        canonical_thread_result = await page.evaluate(
            """
            () => {
              const rows = Array.from(window.__reskinQueryAll('.rv-thread-msg'));
              const bodies = Array.from(window.__reskinQueryAll('.rv-thread-msg .rv-thread-msg-body'))
                .map((node) => ((node && node.textContent) || '').trim());
              const helloCount = bodies.filter((text) => text === 'HELLOOOOO').length;
              const myReplyCount = bodies.filter((text) => text === 'MY-REPLY').length;
              const outgoingCount = rows.filter((row) => row.classList.contains('rv-thread-msg--outgoing')).length;
              const incomingCount = rows.filter((row) => row.classList.contains('rv-thread-msg--incoming')).length;
              return {
                bubbleCount: bodies.length,
                helloCount,
                myReplyCount,
                outgoingCount,
                incomingCount,
                bodies
              };
            }
            """
        )

        await page.click("#rv-shadow-host >> .rv-back")
        await page.wait_for_selector("#rv-shadow-host >> .rv-item", timeout=12000)
        await page.evaluate(
            """
            () => {
              const main = document.querySelector('main[role="main"]');
              if (!(main instanceof HTMLElement)) return;
              main.innerHTML = `
                <table>
                  <tr role="row" class="zA" data-thread-id="thread-f:300" aria-label="zoe@example.com, first ping, Feb 25">
                    <td><span class="yP">zoe@example.com</span></td>
                    <td><span class="bog">First Ping</span></td>
                    <td><span class="y2">HELLO-ZOE</span></td>
                    <td><span>Feb 25</span></td>
                    <td><a href="#inbox/thread-f:300">open</a></td>
                  </tr>
                </table>
              `;
              window.location.hash = '#inbox';
            }
            """
        )
        await page.wait_for_selector("#rv-shadow-host >> .rv-item", timeout=12000)
        await page.wait_for_function(
            """
            () => Array.from(window.__reskinQueryAll('.rv-item'))
              .some((item) => /300/.test(String(item.getAttribute('data-thread-id') || '')))
            """,
            timeout=12000,
        )
        clicked_zoe = await page.evaluate(
            """
            () => {
              const items = Array.from(window.__reskinQueryAll('.rv-item'));
              for (const item of items) {
                const threadId = String(item.getAttribute('data-thread-id') || '');
                if (/300/.test(threadId)) {
                  item.click();
                  return true;
                }
              }
              return false;
            }
            """
        )
        if not clicked_zoe:
            raise RuntimeError("Could not click Zoe thread row")
        await page.wait_for_selector("#rv-shadow-host >> .rv-thread-msg", timeout=12000)
        warmup_before_result = await page.evaluate(
            """
            () => {
              const bodies = Array.from(window.__reskinQueryAll('.rv-thread-msg .rv-thread-msg-body'))
                .map((node) => ((node && node.textContent) || '').trim());
              return {
                hasHello: bodies.includes('HELLO-ZOE'),
                hasLateReply: bodies.includes('LATE-REPLY'),
                bubbleCount: bodies.length
              };
            }
            """
        )
        await page.evaluate(
            """
            () => {
              const main = document.querySelector('main[role="main"]');
              if (!(main instanceof HTMLElement)) return;
              main.innerHTML = `
                <table>
                  <tr role="row" class="zA" data-thread-id="thread-f:300" aria-label="zoe@example.com, first ping, Feb 25">
                    <td><span class="yP">zoe@example.com</span></td>
                    <td><span class="bog">First Ping</span></td>
                    <td><span class="y2">HELLO-ZOE</span></td>
                    <td><span>Feb 25</span></td>
                    <td><a href="#inbox/thread-f:300">open</a></td>
                  </tr>
                  <tr role="row" class="zA" data-thread-id="thread-f:301" aria-label="me@example.com to zoe@example.com, Feb 25">
                    <td><span class="yP">me@example.com</span></td>
                    <td><span class="bog">Late Reply</span></td>
                    <td><span class="y2">LATE-REPLY</span></td>
                    <td><span>Feb 25</span></td>
                    <td><a href="#sent/thread-f:301">open</a></td>
                  </tr>
                </table>
              `;
            }
            """
        )
        await page.wait_for_function(
            """
            () => {
              const bodies = Array.from(window.__reskinQueryAll('.rv-thread-msg .rv-thread-msg-body'))
                .map((node) => ((node && node.textContent) || '').trim());
              return bodies.includes('HELLO-ZOE') && bodies.includes('LATE-REPLY');
            }
            """,
            timeout=12000,
        )
        warmup_after_result = await page.evaluate(
            """
            () => {
              const rows = Array.from(window.__reskinQueryAll('.rv-thread-msg'));
              const bodies = rows
                .map((node) => ((node.querySelector('.rv-thread-msg-body') || {}).textContent || '').trim());
              const outgoingCount = rows.filter((row) => row.classList.contains('rv-thread-msg--outgoing')).length;
              return {
                hasLateReply: bodies.includes('LATE-REPLY'),
                hasHello: bodies.includes('HELLO-ZOE'),
                outgoingCount,
                bubbleCount: bodies.length,
                bodies
              };
            }
            """
        )

        await page.click("#rv-shadow-host >> .rv-back")
        await page.wait_for_selector("#rv-shadow-host >> .rv-item", timeout=12000)
        await page.evaluate(
            """
            () => {
              const main = document.querySelector('main[role="main"]');
              if (!(main instanceof HTMLElement)) return;
              main.innerHTML = `
                <section class="h7">
                  <div data-message-id="msg-inline-cut">
                    <span class="gD" email="alerts@example.com">alerts@example.com</span>
                    <span class="g3" title="Feb 25, 2026, 4:53 PM">Feb 25</span>
                    <div class="a3s aiL">newest text On Fri, Feb 27, 2026 at 5:47 PM jjnsjs <jjnsjs682@gmail.com> wrote: old text</div>
                  </div>
                </section>
              `;
              window.location.hash = '#thread-f:333';
            }
            """
        )
        await page.wait_for_selector("#rv-shadow-host >> .rv-thread-msg .rv-thread-msg-body", timeout=10000)
        inline_quote_result = await page.evaluate(
            """
            () => {
              const body = window.__reskinQuery('.rv-thread-msg .rv-thread-msg-body');
              const text = ((body && body.textContent) || '').trim();
              return {
                text,
                hasWrote: /\\bwrote:/i.test(text),
                hasInlineOn: /\\bOn\\s.+\\swrote:/i.test(text)
              };
            }
            """
        )

        await page.evaluate(
            """
            () => {
              const main = document.querySelector('main[role="main"]');
              if (!(main instanceof HTMLElement)) return;
              main.innerHTML = `
                <section class="h7">
                  <div class="adn ads" data-legacy-message-id="18cafe1234567890">
                    <span class="gD" email="legacy@example.com">legacy@example.com</span>
                    <span class="g3" title="Feb 25, 2026, 5:01 PM">Feb 25</span>
                    <div class="a3s aiL">legacy-id-message</div>
                  </div>
                </section>
              `;
              window.location.hash = '#thread-f:legacy1';
            }
            """
        )
        await page.wait_for_selector("#rv-shadow-host >> .rv-thread-msg .rv-thread-msg-body", timeout=10000)
        legacy_id_result = await page.evaluate(
            """
            () => {
              const bodies = Array.from(window.__reskinQueryAll('.rv-thread-msg .rv-thread-msg-body'))
                .map((node) => ((node && node.textContent) || '').trim());
              return {
                bodies,
                hasLegacyBody: bodies.includes('legacy-id-message')
              };
            }
            """
        )

        await page.evaluate(
            """
            () => {
              window.location.hash = '#f:445566778899';
            }
            """
        )
        await page.wait_for_function(
            """
            () => {
              const hash = String(window.location.hash || '');
              return hash === '#inbox/thread-f:445566778899';
            }
            """,
            timeout=8000,
        )
        normalized_hash_result = await page.evaluate(
            """
            () => ({ hash: String(window.location.hash || '') })
            """
        )

        perf_matrix = []
        for row_count in (120, 360, 600):
            perf_case = await page.evaluate(
                """
                async (rows) => {
                  const main = document.querySelector('main[role="main"]');
                  if (!(main instanceof HTMLElement)) return { rows, error: 'missing-main' };
                  let accountNode = document.getElementById('acct');
                  if (!(accountNode instanceof HTMLElement)) {
                    accountNode = document.createElement('div');
                    accountNode.id = 'acct';
                    document.body.appendChild(accountNode);
                  }
                  accountNode.setAttribute('data-email', 'me@example.com');
                  accountNode.textContent = 'me@example.com';

                  const out = ['<table>'];
                  for (let i = 0; i < rows; i += 1) {
                    const threadId = `thread-f:${990000 + i}`;
                    const sender = i % 2 === 0 ? 'target@example.com' : 'me@example.com';
                    const mailbox = i % 2 === 0 ? 'inbox' : 'sent';
                    const aria = i % 2 === 0
                      ? `target@example.com, perf subject ${i}, Feb ${1 + (i % 28)}`
                      : `me@example.com to target@example.com, perf subject ${i}, Feb ${1 + (i % 28)}`;
                    const snippet = i % 2 === 0 ? `IN-${i}` : `OUT-${i}`;
                    out.push(
                      `<tr role="row" class="zA" data-thread-id="${threadId}" aria-label="${aria}">` +
                      `<td><span class="yP">${sender}</span></td>` +
                      `<td><span class="bog">Perf ${i}</span></td>` +
                      `<td><span class="y2">${snippet}</span></td>` +
                      `<td><span>Feb ${1 + (i % 28)}</span></td>` +
                      `<td><a href="#${mailbox}/${threadId}">open</a></td>` +
                      `</tr>`
                    );
                  }
                  out.push('</table>');
                  main.innerHTML = out.join('');
                  window.location.hash = '#inbox';

                  const waitListUntil = performance.now() + 15000;
                  while (performance.now() < waitListUntil) {
                    const item = window.__reskinQuery && window.__reskinQuery('.rv-item');
                    if (item) break;
                    await new Promise((resolve) => setTimeout(resolve, 16));
                  }
                  const firstItem = window.__reskinQuery && window.__reskinQuery('.rv-item');
                  if (!(firstItem instanceof HTMLElement)) {
                    return { rows, error: 'missing-item' };
                  }

                  const start = performance.now();
                  firstItem.click();
                  let shellMs = null;
                  let firstMessageMs = null;
                  const deadline = start + 20000;
                  while (performance.now() < deadline) {
                    const now = performance.now();
                    const wrap = window.__reskinQuery && window.__reskinQuery('.rv-thread-wrap');
                    const msg = window.__reskinQuery && window.__reskinQuery('.rv-thread-msg .rv-thread-msg-body');
                    if (!shellMs && wrap instanceof HTMLElement && getComputedStyle(wrap).display !== 'none') {
                      shellMs = now - start;
                    }
                    if (!firstMessageMs && msg) {
                      firstMessageMs = now - start;
                    }
                    if (shellMs != null && firstMessageMs != null) break;
                    await new Promise((resolve) => setTimeout(resolve, 16));
                  }

                  const perf = window.ReskinChatDebug && typeof window.ReskinChatDebug.dumpPerf === 'function'
                    ? window.ReskinChatDebug.dumpPerf()
                    : {};
                  const backBtn = window.__reskinQuery && window.__reskinQuery('.rv-back');
                  if (backBtn instanceof HTMLElement) backBtn.click();
                  window.location.hash = '#inbox';
                  return {
                    rows,
                    shellMs: shellMs == null ? -1 : Math.round(shellMs),
                    firstMessageMs: firstMessageMs == null ? -1 : Math.round(firstMessageMs),
                    perf
                  };
                }
                """,
                row_count
            )
            perf_matrix.append(perf_case)

        await browser.close()

    answer = (answer or "").strip()
    print("ANSWER", answer)
    print("DEBUG_BRIDGE_RESULT", debug_bridge_result)
    print("STARTUP_FILTER_RESULT", startup_filter_result)
    print("DEDUP_RESULT", dedup_result)
    print("CANONICAL_GROUP_RESULT", canonical_group_result)
    print("CLICKED_AAROH", clicked_aaroh)
    print("CANONICAL_THREAD_RESULT", canonical_thread_result)
    print("WARMUP_BEFORE_RESULT", warmup_before_result)
    print("WARMUP_AFTER_RESULT", warmup_after_result)
    print("INLINE_QUOTE_RESULT", inline_quote_result)
    print("LEGACY_ID_RESULT", legacy_id_result)
    print("NORMALIZED_HASH_RESULT", normalized_hash_result)
    print("PERF_MATRIX", perf_matrix)
    ok_answer = "Yesterday:" in answer
    ok_debug_bridge = debug_bridge_result.get("ok") is True
    ok_startup_filter = startup_filter_result.get("hasTriage") is False
    ok_dedup = dedup_result.get("sameBodyCount", 0) >= 2
    ok_canonical = (
        canonical_group_result.get("aarohCount", 0) >= 1
        and clicked_aaroh is True
        and canonical_thread_result.get("helloCount", 0) == 1
        and canonical_thread_result.get("myReplyCount", 0) >= 1
        and canonical_thread_result.get("outgoingCount", 0) >= 1
        and canonical_thread_result.get("bodies", [])[:2] == ["HELLOOOOO", "MY-REPLY"]
    )
    warmup_bodies = warmup_after_result.get("bodies", []) if isinstance(warmup_after_result.get("bodies"), list) else []
    hello_index = warmup_bodies.index("HELLO-ZOE") if "HELLO-ZOE" in warmup_bodies else -1
    late_index = warmup_bodies.index("LATE-REPLY") if "LATE-REPLY" in warmup_bodies else -1
    ok_warmup = (
        warmup_before_result.get("hasHello") is True
        and warmup_before_result.get("hasLateReply") is False
        and warmup_after_result.get("hasHello") is True
        and warmup_after_result.get("hasLateReply") is True
        and warmup_after_result.get("outgoingCount", 0) >= 1
        and hello_index != -1
        and late_index != -1
        and hello_index < late_index
    )
    ok_inline_quote = (
        inline_quote_result.get("hasWrote") is False
        and inline_quote_result.get("hasInlineOn") is False
        and inline_quote_result.get("text") == "newest text"
    )
    ok_legacy_id = legacy_id_result.get("hasLegacyBody") is True
    ok_hash_normalized = normalized_hash_result.get("hash") == "#inbox/thread-f:445566778899"
    perf_cases_valid = all(
        isinstance(case, dict)
        and case.get("error") is None
        and case.get("shellMs", -1) >= 0
        and case.get("firstMessageMs", -1) >= 0
        for case in perf_matrix
    )
    perf_budget_ok = all(
        case.get("shellMs", 10_000) < 150 and case.get("firstMessageMs", 10_000) < 600
        for case in perf_matrix
        if isinstance(case, dict)
    )
    return 0 if ok_answer and ok_debug_bridge and ok_startup_filter and ok_dedup and ok_canonical and ok_warmup and ok_inline_quote and ok_legacy_id and ok_hash_normalized and perf_cases_valid and perf_budget_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
