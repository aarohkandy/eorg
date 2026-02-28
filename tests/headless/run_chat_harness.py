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
        await browser.close()

    answer = (answer or "").strip()
    print("ANSWER", answer)
    print("DEDUP_RESULT", dedup_result)
    ok_answer = "Yesterday:" in answer
    ok_dedup = dedup_result.get("sameBodyCount", 0) >= 2
    return 0 if ok_answer and ok_dedup else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
