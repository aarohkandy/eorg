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

STUB_COMPOSE = r'''
(() => {
  window.__replyCalls = [];
  window.__replyMode = "ok";
  window.__replyDelayMs = 0;
  window.ReskinCompose = {
    replyToThread: async (body, opts) => {
      const call = {
        body: String(body || ""),
        opts: opts && typeof opts === "object" ? { ...opts } : {}
      };
      window.__replyCalls.push(call);
      const delay = Number(window.__replyDelayMs || 0);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (window.__replyMode === "fail") {
        return { ok: false, stage: "sendVerify", reason: "compose-did-not-close" };
      }
      return { ok: true, stage: "sendVerified" };
    }
  };
})();
'''


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
    html_path = repo_root / "tests" / "headless" / "chat_harness.html"
    artifacts_dir = repo_root / "tests" / "headless" / "artifacts"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.on("console", lambda msg: print(f"CONSOLE[{msg.type}] {msg.text}"))
        await page.goto(html_path.as_uri() + "#inbox")
        await inject_content_runtime(page, repo_root, skip_files={"compose.js", "inboxsdk.js"})
        await page.add_script_tag(content=STUB_COMPOSE)
        diag_token = new_diag_token("reply")
        await enable_e2e_diag(page, diag_token, ttl_ms=10 * 60 * 1000)
        await set_diag_mode(page, "important", diag_token)

        async def wait_reply_terminal(step_name: str, after_seq: int, expect_failure: bool = False):
            expected_code = "RP199" if expect_failure else "RP180"
            matched = await run_with_diag_timeout(
                step_name,
                wait_for_diagnostic_code(
                    page,
                    expected_code,
                    token=diag_token,
                    run_type="reply",
                    after_seq=after_seq,
                    timeout_ms=10000,
                ),
                page=page,
                token=diag_token,
                artifacts_dir=artifacts_dir,
                timeout_ms=11000,
            )
            run_id = str((matched.get("event") or {}).get("r") or "")
            if run_id:
                await run_with_diag_timeout(
                    f"{step_name}-run-terminal",
                    wait_for_run_terminal(
                        page,
                        run_id,
                        token=diag_token,
                        timeout_ms=10000,
                        after_seq=matched.get("seq"),
                    ),
                    page=page,
                    token=diag_token,
                    artifacts_dir=artifacts_dir,
                    timeout_ms=11000,
                )
            return matched

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

        await page.evaluate(
            """
            () => {
              const main = document.querySelector('main[role="main"]');
              const row = document.querySelector('tr[role="row"]');
              const link = row ? row.querySelector('a[href]') : null;
              const mountThreadContext = () => {
                if (!(main instanceof HTMLElement)) return;
                let marker = document.getElementById('thread-marker');
                if (!marker) {
                  marker = document.createElement('div');
                  marker.id = 'thread-marker';
                  marker.setAttribute('data-message-id', 'msg-1');
                  marker.innerHTML = `
                    <span class="gD" email="alerts@example.com">alerts@example.com</span>
                    <span class="g3" title="Feb 25, 2026, 4:51 PM">Feb 25</span>
                    <div class="a3s aiL">incoming marker message<br><br>On Fri, Feb 27, 2026 at 5:47 PM test@example.com wrote:<br>older line</div>
                  `;
                  main.appendChild(marker);
                }
                let reply = document.getElementById('reply-marker');
                if (!reply) {
                  reply = document.createElement('button');
                  reply.id = 'reply-marker';
                  reply.setAttribute('aria-label', 'Reply');
                  reply.textContent = 'Reply';
                  main.appendChild(reply);
                }
                window.location.hash = '#thread-f:111';
              };
              if (link) {
                link.addEventListener('click', (event) => {
                  event.preventDefault();
                  mountThreadContext();
                });
              }
              if (row) {
                row.addEventListener('click', () => {
                  mountThreadContext();
                });
              }
              window.__mountThreadContext = mountThreadContext;
            }
            """
        )

        await run_with_diag_timeout(
            "reply-initial-list-ready",
            page.wait_for_selector("#rv-shadow-host >> .rv-item", timeout=12000),
            page=page,
            token=diag_token,
            artifacts_dir=artifacts_dir,
            timeout_ms=13000,
        )
        open_after_seq = await latest_diag_seq(page, diag_token)
        await page.click("#rv-shadow-host >> .rv-item")
        open_shell = await run_with_diag_timeout(
            "reply-open-fast-shell",
            wait_for_diagnostic_code(
                page,
                "O130",
                token=diag_token,
                run_type="open",
                after_seq=open_after_seq,
                timeout_ms=8000,
            ),
            page=page,
            token=diag_token,
            artifacts_dir=artifacts_dir,
            timeout_ms=9000,
        )
        open_run_id = str((open_shell.get("event") or {}).get("r") or "")
        if open_run_id:
            await run_with_diag_timeout(
                "reply-open-run-terminal",
                wait_for_run_terminal(
                    page,
                    open_run_id,
                    token=diag_token,
                    timeout_ms=10000,
                    after_seq=open_shell.get("seq"),
                ),
                page=page,
                token=diag_token,
                artifacts_dir=artifacts_dir,
                timeout_ms=11000,
            )
        await page.wait_for_selector("#rv-shadow-host >> .rv-thread-input", timeout=12000)
        initial_thread_result = await page.evaluate(
            """
            () => {
              const incomingRows = Array.from(window.__reskinQueryAll('.rv-thread-msg.rv-thread-msg--incoming'));
              const incomingBodies = incomingRows.map((row) => (
                ((row.querySelector('.rv-thread-msg-body') || {}).textContent || '').trim()
              ));
              return {
                incomingBodies
              };
            }
            """
        )
        await page.evaluate("() => { window.__replyDelayMs = 380; }")

        # Enter key path should succeed from list-like hash by forcing thread-context open first.
        await page.evaluate("() => { window.location.hash = '#inbox'; }")
        await page.fill("#rv-shadow-host >> .rv-thread-input", "hello-enter")
        enter_after_seq = await latest_diag_seq(page, diag_token)
        optimistic_enter_ms = await page.evaluate(
            """
            async () => {
              const input = window.__reskinQuery('.rv-thread-input');
              if (!(input instanceof HTMLInputElement)) return -1;
              const startedAt = performance.now();
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
              input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
              const deadline = startedAt + 1200;
              while (performance.now() < deadline) {
                const rows = Array.from(window.__reskinQueryAll('.rv-thread-msg.rv-thread-msg--outgoing'));
                if (rows.length > 0) {
                  const body = rows[rows.length - 1].querySelector('.rv-thread-msg-body');
                  const text = ((body && body.textContent) || '').trim();
                  if (text === 'hello-enter') return Math.round(performance.now() - startedAt);
                }
                await new Promise((resolve) => setTimeout(resolve, 16));
              }
              return 1201;
            }
            """,
        )
        optimistic_enter = await page.evaluate(
            """
            () => {
              const rows = Array.from(window.__reskinQueryAll('.rv-thread-msg.rv-thread-msg--outgoing'));
              if (!rows.length) return { hasOutgoing: false, text: "" };
              const body = rows[rows.length - 1].querySelector('.rv-thread-msg-body');
              return {
                hasOutgoing: true,
                text: ((body && body.textContent) || "").trim()
              };
            }
            """
        )
        await wait_reply_terminal("reply-enter-success", enter_after_seq, expect_failure=False)
        await page.wait_for_function(
            "() => { const input = window.__reskinQuery('.rv-thread-input'); return input && !input.disabled; }",
            timeout=10000,
        )
        enter_result = await page.evaluate(
            """
            () => ({
              callCount: window.__replyCalls.length,
              lastBody: (window.__replyCalls[window.__replyCalls.length - 1] || {}).body || "",
              lastOpts: (window.__replyCalls[window.__replyCalls.length - 1] || {}).opts || {},
              inputValue: (window.__reskinQuery('.rv-thread-input') || {}).value || "",
              buttonText: ((window.__reskinQuery('.rv-thread-send') || {}).textContent || "").trim()
            })
            """
        )

        # Button success path should also work from list-like hash.
        await page.evaluate("() => { window.location.hash = '#inbox'; }")
        await page.fill("#rv-shadow-host >> .rv-thread-input", "hello-click")
        click_after_seq = await latest_diag_seq(page, diag_token)
        await page.click("#rv-shadow-host >> .rv-thread-send")
        await wait_reply_terminal("reply-click-success", click_after_seq, expect_failure=False)
        await page.wait_for_function(
            "() => { const input = window.__reskinQuery('.rv-thread-input'); return input && !input.disabled; }",
            timeout=10000,
        )
        click_success_result = await page.evaluate(
            """
            () => ({
              callCount: window.__replyCalls.length,
              lastBody: (window.__replyCalls[window.__replyCalls.length - 1] || {}).body || "",
              lastOpts: (window.__replyCalls[window.__replyCalls.length - 1] || {}).opts || {},
              inputValue: (window.__reskinQuery('.rv-thread-input') || {}).value || ""
            })
            """
        )

        # Same-text sends should remain as distinct bubbles.
        await page.evaluate("() => { window.__replyMode = 'ok'; window.__replyDelayMs = 420; window.location.hash = '#inbox'; }")
        await page.fill("#rv-shadow-host >> .rv-thread-input", "repeat-text")
        repeat_one_after_seq = await latest_diag_seq(page, diag_token)
        await page.click("#rv-shadow-host >> .rv-thread-send")
        await wait_reply_terminal("reply-repeat-first", repeat_one_after_seq, expect_failure=False)
        await page.wait_for_function(
            "() => { const btn = window.__reskinQuery('.rv-thread-send'); return btn && !btn.disabled; }",
            timeout=10000,
        )
        await page.fill("#rv-shadow-host >> .rv-thread-input", "repeat-text")
        repeat_two_after_seq = await latest_diag_seq(page, diag_token)
        await page.click("#rv-shadow-host >> .rv-thread-send")
        await wait_reply_terminal("reply-repeat-second", repeat_two_after_seq, expect_failure=False)
        repeat_result = await page.evaluate(
            """
            () => {
              const outgoingBodies = Array.from(window.__reskinQueryAll('.rv-thread-msg.rv-thread-msg--outgoing .rv-thread-msg-body'))
                .map((node) => ((node && node.textContent) || '').trim());
              const repeatBodies = outgoingBodies.filter((text) => text === 'repeat-text');
              return {
                repeatCount: repeatBodies.length,
                outgoingBodies
              };
            }
            """
        )

        # Failure path must preserve input text and expose retry stage label.
        await page.evaluate(
            """
            () => {
              window.__replyMode = 'fail';
              if (typeof window.__mountThreadContext === 'function') window.__mountThreadContext();
            }
            """
        )
        await page.fill("#rv-shadow-host >> .rv-thread-input", "hello-fail")
        fail_after_seq = await latest_diag_seq(page, diag_token)
        await page.click("#rv-shadow-host >> .rv-thread-send")
        await wait_reply_terminal("reply-click-failure", fail_after_seq, expect_failure=True)
        saw_retry = False
        try:
          await page.wait_for_function(
              "() => { const btn = window.__reskinQuery('.rv-thread-send'); return btn && ((btn.textContent || '').trim().startsWith('Retry (')); }",
              timeout=3000,
          )
          saw_retry = True
        except Exception:
          saw_retry = False
        await page.wait_for_function(
            "() => { const input = window.__reskinQuery('.rv-thread-input'); return input && !input.disabled; }",
            timeout=10000,
        )
        fail_result = await page.evaluate(
            """
            () => ({
              callCount: window.__replyCalls.length,
              lastBody: (window.__replyCalls[window.__replyCalls.length - 1] || {}).body || "",
              lastOpts: (window.__replyCalls[window.__replyCalls.length - 1] || {}).opts || {},
              inputValue: (window.__reskinQuery('.rv-thread-input') || {}).value || "",
              buttonText: ((window.__reskinQuery('.rv-thread-send') || {}).textContent || "").trim(),
              hasFailBubble: Array.from(window.__reskinQueryAll('.rv-thread-msg.rv-thread-msg--outgoing .rv-thread-msg-body'))
                .some((node) => ((node && node.textContent) || '').includes('hello-fail')),
              hasFailedStatus: Array.from(window.__reskinQueryAll('.rv-thread-msg-status'))
                .some((node) => ((node && node.textContent) || '').trim().toLowerCase() === 'failed')
            })
            """
        )

        await browser.close()

    print("ENTER_RESULT", enter_result)
    print("INITIAL_THREAD_RESULT", initial_thread_result)
    print("OPTIMISTIC_ENTER", optimistic_enter)
    print("OPTIMISTIC_ENTER_MS", optimistic_enter_ms)
    print("FAIL_RESULT", fail_result)
    print("CLICK_SUCCESS_RESULT", click_success_result)
    print("REPEAT_RESULT", repeat_result)
    print("SAW_RETRY_LABEL", saw_retry)

    ok_enter = (
        enter_result.get("callCount", 0) >= 1
        and enter_result.get("lastBody") == "hello-enter"
        and enter_result.get("inputValue", "") == ""
        and enter_result.get("lastOpts", {}).get("forceThreadContext") is False
        and bool(str(enter_result.get("lastOpts", {}).get("threadHintHref", "")).strip())
    )
    ok_optimistic_enter = (
        optimistic_enter.get("hasOutgoing") is True
        and optimistic_enter.get("text") == "hello-enter"
        and optimistic_enter_ms < 150
    )
    ok_click = (
        click_success_result.get("callCount", 0) >= 2
        and click_success_result.get("lastBody") == "hello-click"
        and click_success_result.get("inputValue", "") == ""
        and click_success_result.get("lastOpts", {}).get("forceThreadContext") is False
        and bool(str(click_success_result.get("lastOpts", {}).get("threadHintHref", "")).strip())
    )
    ok_quote_cleanup = (
        len(initial_thread_result.get("incomingBodies", [])) >= 1
        and not any("wrote:" in body.lower() for body in initial_thread_result.get("incomingBodies", []))
    )
    ok_repeat = repeat_result.get("repeatCount", 0) >= 2

    ok_fail = (
        fail_result.get("callCount", 0) >= 5
        and fail_result.get("lastBody") == "hello-fail"
        and fail_result.get("inputValue", "") == "hello-fail"
        and saw_retry is True
        and fail_result.get("lastOpts", {}).get("forceThreadContext") is False
        and fail_result.get("hasFailBubble") is True
        and fail_result.get("hasFailedStatus") is True
    )

    return 0 if ok_enter and ok_optimistic_enter and ok_click and ok_quote_cleanup and ok_repeat and ok_fail else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
