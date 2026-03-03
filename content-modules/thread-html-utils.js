(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createThreadHtmlUtilsApi = function createThreadHtmlUtilsApi(deps = {}) {
    const escapeHtml = typeof deps.escapeHtml === "function"
      ? deps.escapeHtml
      : (value) => String(value || "");

    function stripGmailHtmlToClean(html) {
      const temp = document.createElement("div");
      temp.innerHTML = html || "";
      temp.querySelectorAll("style, script, link, meta, head, title, iframe, object, embed, video, audio, canvas, svg, form").forEach((el) => el.remove());

      temp.querySelectorAll("img").forEach((img) => {
        const src = (img.getAttribute("src") || "").toLowerCase();
        const w = parseInt(img.getAttribute("width") || "999", 10);
        const h = parseInt(img.getAttribute("height") || "999", 10);
        if (w <= 3 || h <= 3 || src.includes("spacer") || src.includes("pixel") || src.includes("track") || src.startsWith("data:")) {
          img.remove();
          return;
        }
        const alt = (img.getAttribute("alt") || "").trim();
        if (alt && alt.length > 1) {
          const span = document.createElement("span");
          span.textContent = `[${alt}]`;
          img.replaceWith(span);
        }
      });

      temp.querySelectorAll(".gmail_quote, blockquote").forEach((el) => {
        const text = (el.textContent || "").trim();
        if (!text) { el.remove(); return; }
        const marker = document.createElement("div");
        marker.className = "rv-quoted-block";
        marker.setAttribute("data-reskin", "true");
        marker.textContent = text.substring(0, 200) + (text.length > 200 ? "..." : "");
        el.replaceWith(marker);
      });

      temp.querySelectorAll("*").forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const tag = el.tagName.toLowerCase();
        if (tag !== "a") {
          el.removeAttribute("style");
          el.removeAttribute("class");
          el.removeAttribute("bgcolor");
          el.removeAttribute("background");
          el.removeAttribute("color");
          el.removeAttribute("width");
          el.removeAttribute("height");
          el.removeAttribute("align");
          el.removeAttribute("valign");
          el.removeAttribute("cellpadding");
          el.removeAttribute("cellspacing");
          el.removeAttribute("border");
          el.removeAttribute("face");
          el.removeAttribute("size");
        }
      });

      const tables = temp.querySelectorAll("table");
      tables.forEach((table) => {
        const rows = Array.from(table.querySelectorAll("tr"));
        const lines = [];
        rows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll("td, th"));
          const parts = cells.map((c) => {
            const links = Array.from(c.querySelectorAll("a[href]"));
            if (links.length) {
              return links.map((a) => {
                const text = (a.textContent || "").trim();
                const href = a.getAttribute("href") || "";
                return text ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : "";
              }).filter(Boolean).join(" ");
            }
            return (c.textContent || "").trim();
          }).filter(Boolean);
          if (parts.length) lines.push(parts.join("  "));
        });
        if (lines.length) {
          const div = document.createElement("div");
          div.innerHTML = lines.join("<br>");
          table.replaceWith(div);
        } else {
          const text = (table.textContent || "").trim();
          if (text) {
            const div = document.createElement("div");
            div.textContent = text;
            table.replaceWith(div);
          } else {
            table.remove();
          }
        }
      });

      let result = temp.innerHTML;
      result = result.replace(/<(div|p|br|hr)\s*\/?>\s*<\/(div|p)>\s*/gi, "");
      result = result.replace(/(<br\s*\/?>){3,}/gi, "<br><br>");
      return result;
    }

    function sanitizeForShadow(html) {
      const temp = document.createElement("div");
      temp.innerHTML = html || "";
      temp.querySelectorAll("script, meta, link[rel='stylesheet']").forEach((el) => el.remove());
      temp.querySelectorAll("img").forEach((img) => {
        const src = (img.getAttribute("src") || "").toLowerCase();
        const w = parseInt(img.getAttribute("width") || "999", 10);
        const h = parseInt(img.getAttribute("height") || "999", 10);
        if (w <= 2 || h <= 2 || src.includes("spacer") || src.includes("pixel") || src.includes("track")) {
          img.remove();
        }
      });
      return temp.innerHTML;
    }

    const SHADOW_EMBED_STYLE = `
      :host { display: inline-block; max-width: 100%; pointer-events: auto; }
      .rv-embed-inner {
        background: #111;
        color: #ddd;
        padding: 10px 14px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        overflow-x: auto;
        word-break: break-word;
        pointer-events: auto;
      }
      .rv-embed-inner a { color: #00a8fc; pointer-events: auto; }
      .rv-embed-inner img {
        max-width: 100%;
        height: auto;
        border-radius: 4px;
      }
      .rv-embed-inner table {
        border-collapse: collapse;
        max-width: 100%;
      }
      .rv-embed-inner blockquote,
      .rv-embed-inner .gmail_quote {
        border-left: 3px solid #4e5058;
        padding-left: 12px;
        margin: 8px 0;
        color: #999;
      }
    `;

    return {
      stripGmailHtmlToClean,
      sanitizeForShadow,
      SHADOW_EMBED_STYLE
    };
  };
})();
