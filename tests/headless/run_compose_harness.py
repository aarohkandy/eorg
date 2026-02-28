#!/usr/bin/env python3
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright


async def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    html_path = repo_root / "tests" / "headless" / "compose_harness.html"
    compose_path = repo_root / "compose.js"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.on("console", lambda msg: print(f"CONSOLE[{msg.type}] {msg.text}"))
        await page.goto(html_path.as_uri())
        await page.add_script_tag(content=compose_path.read_text(encoding="utf-8"))

        existing_open = await page.evaluate(
            """
            async () => {
              document.body.innerHTML = `
                <main role="main">
                  <section class="h7">
                    <div class="ip adB">
                      <div class="M9" id="compose-open">
                        <div id="reply-body-open" role="textbox" g_editable="true" contenteditable="true" aria-label="body"></div>
                        <div class="IZ"><div class="Up"><div>
                          <div id="schedule-open" role="button" aria-haspopup="true">schedule</div>
                          <div id="send-open" role="button">send</div>
                        </div></div></div>
                      </div>
                    </div>
                  </section>
                </main>
              `;
              let sendClicks = 0;
              const send = document.getElementById("send-open");
              send.addEventListener("click", () => {
                sendClicks += 1;
                const compose = document.getElementById("compose-open");
                const container = compose ? compose.closest(".ip") : null;
                if (compose) compose.remove();
                if (container) container.classList.remove("adB");
              });
              const result = await window.ReskinCompose.replyToThread("hello-open", {
                timeoutMs: 2200,
                forceThreadContext: false
              });
              return {
                result,
                bodyText: (document.getElementById("reply-body-open") || {}).textContent || "removed",
                sendClicks
              };
            }
            """
        )

        closed_then_open = await page.evaluate(
            """
            async () => {
              document.body.innerHTML = `
                <main role="main">
                  <section class="h7">
                    <div class="ip" id="reply-container-closed">
                      <div id="open-reply" role="button">open-reply</div>
                    </div>
                  </section>
                </main>
              `;
              let sendClicks = 0;
              const container = document.getElementById("reply-container-closed");
              const opener = document.getElementById("open-reply");
              opener.addEventListener("click", () => {
                if (container.classList.contains("adB")) return;
                container.classList.add("adB");
                const compose = document.createElement("div");
                compose.className = "M9";
                compose.id = "compose-closed-opened";
                compose.innerHTML = `
                  <div id="reply-body-closed" role="textbox" g_editable="true" contenteditable="true" aria-label="body"></div>
                  <div class="IZ"><div class="Up"><div>
                    <div id="send-closed" role="button">send</div>
                  </div></div></div>
                `;
                container.appendChild(compose);
                const send = document.getElementById("send-closed");
                send.addEventListener("click", () => {
                  sendClicks += 1;
                  const composeNow = document.getElementById("compose-closed-opened");
                  if (composeNow) composeNow.remove();
                  container.classList.remove("adB");
                });
              });

              const result = await window.ReskinCompose.replyToThread("hello-closed", {
                timeoutMs: 2600,
                forceThreadContext: false
              });
              return {
                result,
                opened: container.classList.contains("adB"),
                sendClicks
              };
            }
            """
        )

        hidden_reskin_surface = await page.evaluate(
            """
            async () => {
              document.documentElement.setAttribute("data-reskin-mode", "viewer");
              document.body.setAttribute("data-reskin-mode", "viewer");
              document.body.innerHTML = `
                <section id="reskin-root"></section>
                <main role="main">
                  <section class="h7">
                    <div class="ip adB">
                      <div class="M9" id="compose-hidden">
                        <div id="reply-body-hidden" role="textbox" g_editable="true" contenteditable="true" aria-label="body"></div>
                        <div class="IZ"><div class="Up"><div>
                          <div id="send-hidden" role="button">send</div>
                        </div></div></div>
                      </div>
                    </div>
                  </section>
                </main>
              `;
              let sendClicks = 0;
              const send = document.getElementById("send-hidden");
              send.addEventListener("click", () => {
                sendClicks += 1;
                const compose = document.getElementById("compose-hidden");
                const container = compose ? compose.closest(".ip") : null;
                if (compose) compose.remove();
                if (container) container.classList.remove("adB");
              });

              const result = await window.ReskinCompose.replyToThread("hello-hidden", {
                timeoutMs: 2400,
                forceThreadContext: false
              });
              return {
                result,
                sendClicks,
                bodyMode: document.body.getAttribute("data-reskin-mode") || "",
                htmlMode: document.documentElement.getAttribute("data-reskin-mode") || "",
                rootDisplay: (document.getElementById("reskin-root") || {}).style ? document.getElementById("reskin-root").style.display || "" : ""
              };
            }
            """
        )

        thread_id_navigation = await page.evaluate(
            """
            async () => {
              window.location.hash = "#inbox";
              document.body.innerHTML = `
                <section id="reskin-root"></section>
                <main role="main">
                  <section class="h7">
                    <a id="thread-hint-link" href="#thread-f:999">open-thread</a>
                    <div id="placeholder-row">list</div>
                  </section>
                </main>
              `;

              let sendClicks = 0;
              const mountThreadDom = () => {
                const main = document.querySelector('main[role="main"]');
                if (!main || document.getElementById("compose-hash")) return;
                const wrap = document.createElement("section");
                wrap.className = "h7";
                wrap.innerHTML = `
                  <div data-message-id="msg-1">message</div>
                  <div class="ip adB">
                    <div class="M9" id="compose-hash">
                      <div id="reply-body-hash" role="textbox" g_editable="true" contenteditable="true" aria-label="body"></div>
                      <div class="IZ"><div class="Up"><div>
                        <div id="send-hash" role="button">send</div>
                      </div></div></div>
                    </div>
                  </div>
                `;
                main.appendChild(wrap);
                const send = document.getElementById("send-hash");
                send.addEventListener("click", () => {
                  sendClicks += 1;
                  const compose = document.getElementById("compose-hash");
                  const container = compose ? compose.closest(".ip") : null;
                  if (compose) compose.remove();
                  if (container) container.classList.remove("adB");
                });
              };

              document.getElementById("thread-hint-link").addEventListener("click", (e) => {
                e.preventDefault();
                window.location.hash = "#thread-f:999";
                mountThreadDom();
              });
              window.addEventListener("hashchange", () => {
                if (window.location.hash === "#thread-f:999") {
                  mountThreadDom();
                }
              });

              const result = await window.ReskinCompose.replyToThread("hello-nav", {
                threadId: "#thread-f:999",
                mailbox: "inbox",
                threadHintHref: "#thread-f:999",
                forceThreadContext: true,
                timeoutMs: 5200
              });
              return {
                result,
                sendClicks,
                hash: window.location.hash || "",
                contextStep: ((window.ReskinCompose.getLastReplyDebug() || {}).contextStep || "")
              };
            }
            """
        )

        timeout_verify = await page.evaluate(
            """
            async () => {
              document.body.innerHTML = `
                <main role="main">
                  <section class="h7">
                    <div class="ip adB" id="reply-timeout-container">
                      <div class="M9" id="compose-timeout">
                        <div id="reply-body-timeout" role="textbox" g_editable="true" contenteditable="true" aria-label="body"></div>
                        <div class="IZ"><div class="Up"><div>
                          <div id="send-timeout" role="button">send</div>
                        </div></div></div>
                      </div>
                    </div>
                  </section>
                </main>
              `;
              let sendClicks = 0;
              document.getElementById("send-timeout").addEventListener("click", () => {
                sendClicks += 1;
              });
              const result = await window.ReskinCompose.replyToThread("hello-timeout", {
                timeoutMs: 2400,
                forceThreadContext: false
              });
              return { result, sendClicks };
            }
            """
        )

        await browser.close()

    print("EXISTING_OPEN", existing_open)
    print("CLOSED_THEN_OPEN", closed_then_open)
    print("HIDDEN_RESKIN_SURFACE", hidden_reskin_surface)
    print("THREAD_ID_NAVIGATION", thread_id_navigation)
    print("TIMEOUT_VERIFY", timeout_verify)

    ok_existing = (
        existing_open.get("result", {}).get("ok") is True
        and existing_open.get("sendClicks") == 1
    )
    ok_closed = (
        closed_then_open.get("result", {}).get("ok") is True
        and closed_then_open.get("sendClicks") == 1
    )
    ok_hidden_surface = (
        hidden_reskin_surface.get("result", {}).get("ok") is True
        and hidden_reskin_surface.get("sendClicks") == 1
        and hidden_reskin_surface.get("bodyMode") == "viewer"
        and hidden_reskin_surface.get("htmlMode") == "viewer"
    )
    ok_thread_id_navigation = (
        thread_id_navigation.get("result", {}).get("ok") is True
        and thread_id_navigation.get("sendClicks") == 1
        and thread_id_navigation.get("hash") == "#thread-f:999"
        and str(thread_id_navigation.get("result", {}).get("stage", "")).startswith("sendVerified")
        and bool(thread_id_navigation.get("contextStep"))
    )
    timeout_result = timeout_verify.get("result", {})
    ok_timeout = (
        timeout_result.get("ok") is False
        and timeout_result.get("stage") == "sendVerify"
        and timeout_verify.get("sendClicks", 0) >= 1
    )
    return 0 if ok_existing and ok_closed and ok_hidden_surface and ok_thread_id_navigation and ok_timeout else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
