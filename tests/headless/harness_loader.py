#!/usr/bin/env python3
"""Helpers to load content-script runtime into headless harness pages."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable


def read_content_script_order(repo_root: Path) -> list[str]:
    manifest_path = repo_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    content_scripts = manifest.get("content_scripts")
    if not isinstance(content_scripts, list) or not content_scripts:
        return []
    first = content_scripts[0] if isinstance(content_scripts[0], dict) else {}
    scripts = first.get("js")
    if not isinstance(scripts, list):
        return []
    return [str(entry) for entry in scripts if isinstance(entry, str)]


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
