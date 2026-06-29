#!/usr/bin/env python3
"""
session_end.py - SessionEnd hook
Saves a snapshot and updates context_summary.md at session end
"""

import json
import sys
import os
import shutil
from datetime import datetime
from pathlib import Path


def get_project_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))


def load_decisions(context_dir: Path) -> dict:
    decisions_file = context_dir / "decisions.json"
    if not decisions_file.exists():
        return {"version": "1.0.0", "last_updated": None, "decisions": []}
    try:
        with open(decisions_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {"version": "1.0.0", "last_updated": None, "decisions": []}


def save_snapshot(context_dir: Path, decisions_data: dict) -> Path:
    """Save a snapshot of decisions.json"""
    history_dir = context_dir / "decisions_history"
    history_dir.mkdir(parents=True, exist_ok=True)

    # Timestamp-based directory name
    ts = datetime.now().strftime("%Y%m%dT%H%M%S")
    snapshot_dir = history_dir / ts
    snapshot_dir.mkdir(parents=True, exist_ok=True)

    snapshot_file = snapshot_dir / "decisions.json"
    with open(snapshot_file, "w", encoding="utf-8") as f:
        json.dump(decisions_data, f, ensure_ascii=False, indent=2)

    # Clean up old snapshots (keep the latest 30)
    snapshots = sorted(history_dir.iterdir())
    if len(snapshots) > 30:
        for old in snapshots[:-30]:
            shutil.rmtree(old, ignore_errors=True)

    return snapshot_file


def generate_summary(decisions_data: dict, session_info: dict) -> str:
    """Generate the content of context_summary.md"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    decisions = decisions_data.get("decisions", [])

    active = [d for d in decisions if d.get("status") == "active"]
    superseded = [d for d in decisions if d.get("status") == "superseded"]

    # Aggregate by category
    categories: dict[str, list] = {}
    for d in active:
        cat = d.get("category", "general")
        categories.setdefault(cat, []).append(d)

    lines = [
        "# Context Summary",
        "",
        "_This file is auto-updated by session_end.py_",
        "",
        f"## Last Updated",
        f"{now}",
        "",
        f"## Session Info",
        f"- Session ID: {session_info.get('session_id', 'unknown')}",
        f"- End reason: {session_info.get('reason', 'unknown')}",
        "",
        f"## Decision Summary",
        f"- Active: {len(active)}",
        f"- Superseded: {len(superseded)}",
        f"- Total: {len(decisions)}",
        "",
    ]

    if active:
        lines.append("## Active Decisions (By Category)")
        lines.append("")
        for cat, items in sorted(categories.items()):
            lines.append(f"### {cat}")
            for d in items[-10:]:
                v = d.get("version", "v?")
                ts = d.get("timestamp", "")[:10]
                title = d.get("title", "")
                lines.append(f"- **{v}** {title} _({ts})_")
            lines.append("")

    if superseded:
        lines.append("## Superseded Decisions (Latest 5)")
        lines.append("")
        for d in superseded[-5:]:
            v = d.get("version", "v?")
            title = d.get("title", "")
            superseded_at = d.get("superseded_at", "")[:10]
            lines.append(f"- ~~{v}~~ {title} _(superseded: {superseded_at})_")
        lines.append("")

    return "\n".join(lines)


def main():
    try:
        event_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        event_data = {}

    project_root = get_project_root()
    context_dir = project_root / ".claude" / "context"
    context_dir.mkdir(parents=True, exist_ok=True)

    decisions_data = load_decisions(context_dir)

    # Save snapshot
    snapshot_path = save_snapshot(context_dir, decisions_data)

    # Update context_summary.md
    session_info = {
        "session_id": event_data.get("session_id", "unknown"),
        "reason": event_data.get("reason", "unknown"),
    }
    summary = generate_summary(decisions_data, session_info)

    summary_file = context_dir / "context_summary.md"
    with open(summary_file, "w", encoding="utf-8") as f:
        f.write(summary)

    active_count = len([d for d in decisions_data.get("decisions", []) if d.get("status") == "active"])
    print(
        f"[Context Optimizer] Session end processing complete\n"
        f"  Snapshot: {snapshot_path}\n"
        f"  Active decisions: {active_count}",
        file=sys.stderr,
    )

    sys.exit(0)


if __name__ == "__main__":
    main()
