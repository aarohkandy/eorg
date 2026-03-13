#!/usr/bin/env python3
"""Helpers to load content-script runtime into headless harness pages."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

LEGACY_HEADLESS_RUNTIME = ["inboxsdk.js", "ai.js", "triage.js", "compose.js", "content.js"]


def _read_scripts_from_manifest(manifest_path: Path) -> list[str]:
    if not manifest_path.is_file():
        return []
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    content_scripts = manifest.get("content_scripts")
    if not isinstance(content_scripts, list) or not content_scripts:
        return []
    first = content_scripts[0] if isinstance(content_scripts[0], dict) else {}
    scripts = first.get("js")
    if not isinstance(scripts, list):
        return []
    return [str(entry) for entry in scripts if isinstance(entry, str)]


def read_content_script_order(repo_root: Path) -> list[str]:
    manifest_path = repo_root / "tests" / "headless" / "runtime-manifest.json"
    runtime_scripts = _read_scripts_from_manifest(manifest_path)
    if runtime_scripts:
        return runtime_scripts

    root_scripts = _read_scripts_from_manifest(repo_root / "manifest.json")
    if "content.js" in root_scripts:
        return root_scripts

    # Production manifest now points to apps/extension runtime; harnesses still validate
    # the legacy RV stack directly.
    return LEGACY_HEADLESS_RUNTIME


async def inject_content_runtime(
    page,
    repo_root: Path,
    *,
    skip_files: Iterable[str] | None = None,
) -> None:
    skip = set(skip_files or [])
    script_order = read_content_script_order(repo_root)
    for relative in script_order:
        if relative in skip:
            continue
        script_path = repo_root / relative
        if not script_path.is_file():
            raise FileNotFoundError(f"Missing content script from manifest: {script_path}")
        await page.add_script_tag(content=script_path.read_text(encoding="utf-8"))
