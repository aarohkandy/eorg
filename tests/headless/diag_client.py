#!/usr/bin/env python3
"""Deterministic diagnostics helpers for Playwright headless harnesses."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable


TERMINAL_RUN_CODES = {"R180", "R190", "R199"}


class DiagnosticWaitTimeout(TimeoutError):
    """Raised when a diagnostic event did not appear before timeout."""


def _now_ms() -> int:
    return int(time.time() * 1000)


def new_diag_token(prefix: str = "diag") -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


async def _call_debug_method(page, method: str, *args: Any) -> Any:
    response = await page.evaluate(
        """
        async ({ method, args }) => {
          const api = window.ReskinChatDebug;
          if (!api || typeof api[method] !== "function") {
            return { ok: false, error: `missing-debug-method:${method}` };
          }
          try {
            const result = await api[method](...(Array.isArray(args) ? args : []));
            return { ok: true, result };
          } catch (error) {
            return {
              ok: false,
              error: String(error && error.message ? error.message : error || "debug-call-failed")
            };
          }
        }
        """,
        {"method": method, "args": list(args)},
    )
    if isinstance(response, dict) and response.get("ok"):
        return response.get("result")
    err = "debug call failed"
    if isinstance(response, dict):
        err = str(response.get("error") or err)
    raise RuntimeError(err)


async def enable_e2e_diag(page, token: str, ttl_ms: int = 10 * 60 * 1000) -> dict[str, Any]:
    try:
        result = await _call_debug_method(page, "enableE2EDiag", token, int(ttl_ms))
        if isinstance(result, dict):
            return result
    except RuntimeError as error:
        message = str(error)
        if "missing-debug-method:enableE2EDiag" not in message:
            raise
    return {
        "ok": True,
        "enabled": True,
        "legacy": True,
        "token": token,
        "ttlMs": int(ttl_ms),
    }


async def disable_e2e_diag(page, token: str) -> dict[str, Any]:
    try:
        result = await _call_debug_method(page, "disableE2EDiag", token)
        if isinstance(result, dict):
            return result
    except RuntimeError as error:
        message = str(error)
        if "missing-debug-method:disableE2EDiag" not in message:
            raise
    return {"ok": True, "enabled": False, "legacy": True}


async def get_diag_mode(page) -> str:
    try:
        mode = await _call_debug_method(page, "getDiagMode")
        return str(mode or "important")
    except RuntimeError as error:
        if "missing-debug-method:getDiagMode" not in str(error):
            raise
        return "important"


async def set_diag_mode(page, mode: str, token: str) -> str:
    try:
        result = await _call_debug_method(page, "setDiagMode", mode, token)
        return str(result or "important")
    except RuntimeError as error:
        if "missing-debug-method:setDiagMode" not in str(error):
            raise
        return str(mode or "important")


async def get_diag_dump(
    page,
    token: str,
    *,
    recent_limit: int = 120,
    verbose: bool = True,
) -> dict[str, Any]:
    payload = await _call_debug_method(
        page,
        "dumpDiag",
        {"recentLimit": int(recent_limit), "verbose": bool(verbose)},
        token,
    )
    return payload if isinstance(payload, dict) else {}


async def get_recent_diag(page, token: str, limit: int = 50) -> list[dict[str, Any]]:
    dump = await get_diag_dump(page, token, recent_limit=max(limit, 10), verbose=True)
    recent = dump.get("recent")
    return recent if isinstance(recent, list) else []


async def get_active_runs(page, token: str) -> list[dict[str, Any]]:
    dump = await get_diag_dump(page, token, recent_limit=120, verbose=False)
    runs: list[dict[str, Any]] = []
    for key in ("openRuns", "hydrationRuns", "activeRuns"):
        values = dump.get(key)
        if not isinstance(values, list):
            continue
        for run in values:
            if not isinstance(run, dict):
                continue
            if str(run.get("status") or "") == "running":
                runs.append(run)
    dedup: dict[str, dict[str, Any]] = {}
    for run in runs:
        run_id = str(run.get("runId") or "")
        if run_id:
            dedup[run_id] = run
    return list(dedup.values())


def _run_ids_for_type(diag_dump: dict[str, Any], run_type: str) -> set[str]:
    normalized = str(run_type or "").strip().lower()
    if not normalized:
        return set()
    key = "openRuns" if normalized == "open" else "hydrationRuns" if normalized == "hydration" else ""
    if not key:
        return set()
    out: set[str] = set()
    runs = diag_dump.get(key)
    if not isinstance(runs, list):
        return out
    for run in runs:
        if not isinstance(run, dict):
            continue
        run_id = str(run.get("runId") or "").strip()
        if run_id:
            out.add(run_id)
    return out


def _event_seq(event: dict[str, Any], fallback_index: int) -> int:
    seq_value = event.get("seq")
    if isinstance(seq_value, int):
        return seq_value
    try:
        return int(seq_value)
    except Exception:
        return fallback_index


async def wait_for_diagnostic_code(
    page,
    code: str,
    *,
    token: str,
    run_type: str | None = None,
    after_seq: int | None = None,
    timeout_ms: int = 8_000,
    predicate: Callable[[dict[str, Any]], bool] | None = None,
    poll_ms: int = 50,
) -> dict[str, Any]:
    deadline = _now_ms() + max(1, int(timeout_ms))
    expected = str(code or "").strip().upper()
    if not expected:
        raise ValueError("wait_for_diagnostic_code requires a non-empty code")
    last_seen_seq = int(after_seq or 0)
    last_code = ""

    while _now_ms() < deadline:
        diag_dump = await get_diag_dump(page, token, recent_limit=160, verbose=True)
        recent = diag_dump.get("recent")
        if not isinstance(recent, list):
            recent = []
        run_ids = _run_ids_for_type(diag_dump, run_type or "")
        for index, event in enumerate(recent, start=1):
            if not isinstance(event, dict):
                continue
            seq = _event_seq(event, index)
            if seq <= last_seen_seq:
                continue
            event_code = str(event.get("c") or "").strip().upper()
            if event_code:
                last_code = event_code
            if event_code != expected:
                continue
            run_id = str(event.get("r") or "").strip()
            if run_type and run_ids and run_id and run_id not in run_ids:
                continue
            if predicate and not predicate(event):
                continue
            return {
                "event": event,
                "seq": seq,
                "dump": diag_dump,
                "matched_code": expected,
            }
        if recent:
            last_seen_seq = max(last_seen_seq, _event_seq(recent[-1], len(recent)))
        await asyncio.sleep(max(0.01, poll_ms / 1000))

    raise DiagnosticWaitTimeout(
        f"Timed out waiting for diagnostic code {expected} after seq>{after_seq or 0}; last_seen={last_code or 'none'}"
    )


async def wait_for_run_terminal(
    page,
    run_id: str,
    *,
    token: str,
    timeout_ms: int = 8_000,
    after_seq: int | None = None,
    poll_ms: int = 50,
) -> dict[str, Any]:
    normalized_run_id = str(run_id or "").strip()
    if not normalized_run_id:
        raise ValueError("wait_for_run_terminal requires run_id")
    deadline = _now_ms() + max(1, int(timeout_ms))
    last_seen_seq = int(after_seq or 0)
    while _now_ms() < deadline:
        diag_dump = await get_diag_dump(page, token, recent_limit=200, verbose=True)
        recent = diag_dump.get("recent")
        if not isinstance(recent, list):
            recent = []
        for index, event in enumerate(recent, start=1):
            if not isinstance(event, dict):
                continue
            seq = _event_seq(event, index)
            if seq <= last_seen_seq:
                continue
            if str(event.get("r") or "").strip() != normalized_run_id:
                continue
            code = str(event.get("c") or "").strip().upper()
            if code in TERMINAL_RUN_CODES:
                return {
                    "event": event,
                    "seq": seq,
                    "dump": diag_dump,
                    "matched_code": code,
                }
        if recent:
            last_seen_seq = max(last_seen_seq, _event_seq(recent[-1], len(recent)))
        await asyncio.sleep(max(0.01, poll_ms / 1000))
    raise DiagnosticWaitTimeout(f"Timed out waiting for terminal run event for run_id={normalized_run_id}")


async def capture_diag_failure_bundle(
    page,
    name: str,
    *,
    token: str,
    artifacts_dir: Path,
    error: Exception | None = None,
) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    slug = "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in name).strip("-") or "diag-failure"
    target_dir = artifacts_dir / "diag"
    target_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = target_dir / f"{slug}-{stamp}.png"
    artifact_path = target_dir / f"{slug}-{stamp}.json"

    dump_diag: dict[str, Any] = {}
    dump_budgets: dict[str, Any] = {}
    dump_state: dict[str, Any] = {}
    dump_perf: dict[str, Any] = {}
    location: dict[str, Any] = {}

    try:
        dump_diag = await get_diag_dump(page, token, recent_limit=50, verbose=True)
    except Exception as exc:
        dump_diag = {"error": f"dumpDiag failed: {exc}"}
    try:
        dump_budgets = await _call_debug_method(page, "dumpDiagBudgets", token)
    except Exception as exc:
        dump_budgets = {"error": f"dumpDiagBudgets failed: {exc}"}
    try:
        dump_state = await _call_debug_method(page, "dumpState")
    except Exception as exc:
        dump_state = {"error": f"dumpState failed: {exc}"}
    try:
        dump_perf = await _call_debug_method(page, "dumpPerfBudgets")
    except Exception as exc:
        dump_perf = {"error": f"dumpPerfBudgets failed: {exc}"}
    try:
        location = await page.evaluate(
            "() => ({ href: String(window.location.href || ''), hash: String(window.location.hash || '') })"
        )
    except Exception as exc:
        location = {"error": f"location failed: {exc}"}
    try:
        await page.screenshot(path=str(screenshot_path), full_page=True)
    except Exception as exc:
        screenshot_path = Path(f"unavailable:{exc}")

    recent_events = dump_diag.get("recent") if isinstance(dump_diag, dict) else []
    recent_events = recent_events if isinstance(recent_events, list) else []
    last_event = recent_events[-1] if recent_events else {}
    active_runs = []
    if isinstance(dump_diag, dict):
        for key in ("openRuns", "hydrationRuns", "activeRuns"):
            runs = dump_diag.get(key)
            if not isinstance(runs, list):
                continue
            for run in runs:
                if isinstance(run, dict) and str(run.get("status") or "") == "running":
                    active_runs.append(run)
    counters = dump_diag.get("counters") if isinstance(dump_diag, dict) else {}
    counters = counters if isinstance(counters, dict) else {}
    top_codes = sorted(counters.items(), key=lambda item: int(item[1]), reverse=True)[:8]

    payload = {
        "name": name,
        "captured_at_ms": _now_ms(),
        "error": str(error) if error else "",
        "location": location,
        "last_event": last_event,
        "active_runs": active_runs,
        "top_codes": top_codes,
        "diag": dump_diag,
        "diag_budgets": dump_budgets,
        "state": dump_state,
        "perf_budgets": dump_perf,
        "screenshot": str(screenshot_path),
    }

    artifact_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return artifact_path


async def run_with_diag_timeout(
    name: str,
    awaitable: Awaitable[Any],
    *,
    page,
    token: str,
    artifacts_dir: Path,
    timeout_ms: int,
) -> Any:
    try:
        return await asyncio.wait_for(awaitable, timeout=max(1, timeout_ms) / 1000)
    except Exception as error:
        artifact_path = await capture_diag_failure_bundle(
            page,
            name,
            token=token,
            artifacts_dir=artifacts_dir,
            error=error if isinstance(error, Exception) else Exception(str(error)),
        )
        raise DiagnosticWaitTimeout(
            f"{name} failed; diagnostics artifact: {artifact_path}"
        ) from error
