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

        await page.wait_for_selector("#reskin-root .rv-ai-qa-input", timeout=10000)
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
        await page.fill("#reskin-root .rv-ai-qa-input", "what happened yesterday")
        await page.click("#reskin-root .rv-ai-qa-submit")
        await page.wait_for_function(
            """
            () => {
              const nodes = Array.from(document.querySelectorAll('#reskin-root .rv-chat-msg.is-assistant .rv-chat-bubble'));
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
              const nodes = Array.from(document.querySelectorAll('#reskin-root .rv-chat-msg.is-assistant .rv-chat-bubble'));
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
        await page.wait_for_selector("#reskin-root .rv-thread-msg", timeout=10000)
        dedup_result = await page.evaluate(
            """
            () => {
              const bodies = Array.from(document.querySelectorAll('#reskin-root .rv-thread-msg .rv-thread-msg-body'))
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
              const main = document.querySelector('main[role="main"]');
              if (!(main instanceof HTMLElement)) return;
              main.innerHTML = `
                <table>
                  <tr role="row" class="zA" data-thread-id="#thread-f:222" aria-label="aaroh, hello, Feb 25">
                    <td><span class="yP">aaroh@example.com</span></td>
                    <td><span class="bog">Hello Thread</span></td>
                    <td><span class="y2">HELLOOOOO</span></td>
                    <td><span>Feb 25</span></td>
                    <td><a href="#inbox/thread-f:222">open</a></td>
                  </tr>
                  <tr role="row" class="zA" data-thread-id="thread-f:222" aria-label="aaroh, hello, Feb 25">
                    <td><span class="yP">aaroh@example.com</span></td>
                    <td><span class="bog">Hello Thread</span></td>
                    <td><span class="y2">HELLOOOOO</span></td>
                    <td><span>Feb 25</span></td>
                    <td><a href="#sent/f:222">open</a></td>
                  </tr>
                </table>
              `;
              const mountThread = () => {
                main.innerHTML = `
                  <section class="h7">
                    <div data-message-id="msg-222">
                      <span class="gD" email="aaroh@example.com">aaroh@example.com</span>
                      <span class="g3" title="Feb 25, 2026, 4:51 PM">Feb 25</span>
                      <div class="a3s aiL">HELLOOOOO</div>
                    </div>
                  </section>
                `;
                window.location.hash = '#inbox/thread-f:222';
              };
              for (const row of Array.from(main.querySelectorAll('tr[role="row"]'))) {
                row.addEventListener('click', (event) => {
                  event.preventDefault();
                  mountThread();
                });
              }
              for (const link of Array.from(main.querySelectorAll('a[href]'))) {
                link.addEventListener('click', (event) => {
                  event.preventDefault();
                  mountThread();
                });
              }
              window.location.hash = '#inbox';
            }
            """
        )
        await page.wait_for_selector("#reskin-root .rv-item", timeout=12000)
        canonical_group_result = await page.evaluate(
            """
            () => {
              const labels = Array.from(document.querySelectorAll('#reskin-root .rv-item .rv-item-name'))
                .map((node) => ((node && node.textContent) || '').trim());
              const aarohCount = labels.filter((label) => /aaroh/i.test(label)).length;
              return {
                listCount: document.querySelectorAll('#reskin-root .rv-item').length,
                aarohCount,
                labels
              };
            }
            """
        )
        clicked_aaroh = await page.evaluate(
            """
            () => {
              const items = Array.from(document.querySelectorAll('#reskin-root .rv-item'));
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
        await page.wait_for_selector("#reskin-root .rv-thread-msg", timeout=12000)
        canonical_thread_result = await page.evaluate(
            """
            () => {
              const bodies = Array.from(document.querySelectorAll('#reskin-root .rv-thread-msg .rv-thread-msg-body'))
                .map((node) => ((node && node.textContent) || '').trim());
              const helloCount = bodies.filter((text) => text === 'HELLOOOOO').length;
              return {
                bubbleCount: bodies.length,
                helloCount,
                bodies
              };
            }
            """
        )

        await page.click("#reskin-root .rv-back")
        await page.wait_for_selector("#reskin-root .rv-item", timeout=12000)
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
        await page.wait_for_selector("#reskin-root .rv-thread-msg .rv-thread-msg-body", timeout=10000)
        inline_quote_result = await page.evaluate(
            """
            () => {
              const body = document.querySelector('#reskin-root .rv-thread-msg .rv-thread-msg-body');
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
        await page.wait_for_selector("#reskin-root .rv-thread-msg .rv-thread-msg-body", timeout=10000)
        legacy_id_result = await page.evaluate(
            """
            () => {
              const bodies = Array.from(document.querySelectorAll('#reskin-root .rv-thread-msg .rv-thread-msg-body'))
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

        await browser.close()

    answer = (answer or "").strip()
    print("ANSWER", answer)
    print("DEBUG_BRIDGE_RESULT", debug_bridge_result)
    print("DEDUP_RESULT", dedup_result)
    print("CANONICAL_GROUP_RESULT", canonical_group_result)
    print("CLICKED_AAROH", clicked_aaroh)
    print("CANONICAL_THREAD_RESULT", canonical_thread_result)
    print("INLINE_QUOTE_RESULT", inline_quote_result)
    print("LEGACY_ID_RESULT", legacy_id_result)
    print("NORMALIZED_HASH_RESULT", normalized_hash_result)
    ok_answer = "Yesterday:" in answer
    ok_debug_bridge = debug_bridge_result.get("ok") is True
    ok_dedup = dedup_result.get("sameBodyCount", 0) >= 2
    ok_canonical = (
        canonical_group_result.get("aarohCount", 0) >= 1
        and clicked_aaroh is True
        and canonical_thread_result.get("helloCount", 0) == 1
    )
    ok_inline_quote = (
        inline_quote_result.get("hasWrote") is False
        and inline_quote_result.get("hasInlineOn") is False
        and inline_quote_result.get("text") == "newest text"
    )
    ok_legacy_id = legacy_id_result.get("hasLegacyBody") is True
    ok_hash_normalized = normalized_hash_result.get("hash") == "#inbox/thread-f:445566778899"
    return 0 if ok_answer and ok_debug_bridge and ok_dedup and ok_canonical and ok_inline_quote and ok_legacy_id and ok_hash_normalized else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
