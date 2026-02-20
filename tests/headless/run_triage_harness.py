#!/usr/bin/env python3
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright


async def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    html_path = repo_root / "tests" / "headless" / "triage_harness.html"
    triage_path = repo_root / "triage.js"

    async with async_playwright() as p:
      browser = await p.chromium.launch(headless=True)
      page = await browser.new_page()
      page.on("console", lambda msg: print(f"CONSOLE[{msg.type}] {msg.text}"))
      await page.goto(html_path.as_uri())
      await page.add_script_tag(content=triage_path.read_text(encoding="utf-8"))

      result_with_href = await page.evaluate(
          """
          async () => {
            if (!window.ReskinTriage) return { ok: false, reason: "missing-module" };
            const ok = await window.ReskinTriage.applyLabelToMessage(
              { threadId: "#thread-f:123", href: "#thread-f:123", row: null },
              "critical"
            );
            const row = document.querySelector('[role="row"][data-thread-id="thread-f:123"]');
            const marker = row ? row.querySelector('.label-marker') : null;
            return {
              ok,
              marker: marker ? marker.getAttribute("aria-label") : "",
              hash: window.location.hash || ""
            };
          }
          """
      )

      await page.evaluate(
          """
          () => {
            const row = document.querySelector('[role="row"][data-thread-id="thread-f:123"]');
            const marker = row ? row.querySelector('.label-marker') : null;
            if (marker) marker.remove();
            window.location.hash = "#inbox";
          }
          """
      )

      result_without_href = await page.evaluate(
          """
          async () => {
            const ok = await window.ReskinTriage.applyLabelToMessage(
              { threadId: "f:123", href: "", row: null },
              "critical"
            );
            const row = document.querySelector('[role="row"][data-thread-id="thread-f:123"]');
            const marker = row ? row.querySelector('.label-marker') : null;
            return {
              ok,
              marker: marker ? marker.getAttribute("aria-label") : "",
              hash: window.location.hash || ""
            };
          }
          """
      )

      await browser.close()

    print("RESULT_WITH_HREF", result_with_href)
    print("RESULT_WITHOUT_HREF", result_without_href)
    ok_with = result_with_href.get("ok") and result_with_href.get("marker", "").lower() == "triage/critical"
    ok_without = result_without_href.get("ok") and result_without_href.get("marker", "").lower() == "triage/critical"
    return 0 if ok_with and ok_without else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
