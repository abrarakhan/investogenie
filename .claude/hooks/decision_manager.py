#!/usr/bin/env python3
"""
decision_manager.py - Decision management CLI tool
Can be invoked from Claude Code via the /decision command

Usage:
  python3 decision_manager.py add "Title" --content "Details" --category architecture
  python3 decision_manager.py list
  python3 decision_manager.py list --category architecture
  python3 decision_manager.py update <id> --content "New details"
  python3 decision_manager.py supersede <id> --reason "Reason"
  python3 decision_manager.py show <id>
  python3 decision_manager.py history
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path


VALID_CATEGORIES = [
    "architecture", "tech_stack", "api", "ui_ux",
    "infrastructure", "policy", "business", "general"
]

VALID_STATUSES = ["active", "superseded", "archived"]


def get_context_dir() -> Path:
    project_root = Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))
    context_dir = project_root / ".claude" / "context"
    context_dir.mkdir(parents=True, exist_ok=True)
    return context_dir


def load_decisions(context_dir: Path) -> dict:
    decisions_file = context_dir / "decisions.json"
    if not decisions_file.exists():
        return {"version": "1.0.0", "last_updated": None, "decisions": []}
    with open(decisions_file, "r", encoding="utf-8") as f:
        return json.load(f)


def save_decisions(context_dir: Path, data: dict):
    decisions_file = context_dir / "decisions.json"
    data["last_updated"] = datetime.now().isoformat()
    with open(decisions_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Saved: {decisions_file}")


def generate_version(decisions: list) -> str:
    if not decisions:
        return "v1"
    max_v = 0
    for d in decisions:
        try:
            num = int(d.get("version", "v0").replace("v", ""))
            max_v = max(max_v, num)
        except ValueError:
            pass
    return f"v{max_v + 1}"


def cmd_add(args, context_dir: Path):
    """Add a decision"""
    data = load_decisions(context_dir)
    decisions = data.get("decisions", [])

    new_id = f"dec_{len(decisions) + 1:04d}"
    version = generate_version(decisions)
    now = datetime.now().isoformat()

    new_decision = {
        "id": new_id,
        "version": version,
        "title": args.title,
        "content": args.content or "",
        "category": args.category or "general",
        "type": "manual",
        "status": "active",
        "timestamp": now,
        "supersedes": None,
        "superseded_at": None,
        "tags": args.tags.split(",") if args.tags else [],
    }

    decisions.append(new_decision)
    data["decisions"] = decisions
    save_decisions(context_dir, data)

    print(f"\nDecision added")
    print(f"  ID      : {new_id}")
    print(f"  Version : {version}")
    print(f"  Title   : {args.title}")
    print(f"  Category: {args.category or 'general'}")
    if args.content:
        print(f"  Details : {args.content}")


def cmd_list(args, context_dir: Path):
    """List decisions"""
    data = load_decisions(context_dir)
    decisions = data.get("decisions", [])

    # Filtering
    filtered = decisions
    if args.category:
        filtered = [d for d in filtered if d.get("category") == args.category]
    if args.status:
        filtered = [d for d in filtered if d.get("status") == args.status]
    else:
        filtered = [d for d in filtered if d.get("status") == "active"]

    if not filtered:
        print("No matching decisions found")
        return

    print(f"\nDecision list ({len(filtered)} entries)\n")
    print(f"{'ID':<12} {'Ver':<6} {'Category':<15} {'Status':<12} {'Date':<12} Title")
    print("-" * 90)
    for d in filtered:
        ts = d.get("timestamp", "")[:10]
        print(
            f"{d.get('id', ''):<12} "
            f"{d.get('version', ''):<6} "
            f"{d.get('category', ''):<15} "
            f"{d.get('status', ''):<12} "
            f"{ts:<12} "
            f"{d.get('title', '')}"
        )


def cmd_show(args, context_dir: Path):
    """Show details of a specific decision"""
    data = load_decisions(context_dir)
    decisions = data.get("decisions", [])

    target = next((d for d in decisions if d.get("id") == args.id), None)
    if not target:
        print(f"Error: ID '{args.id}' not found")
        sys.exit(1)

    print(f"\nDecision details\n")
    for key, value in target.items():
        print(f"  {key:<15}: {value}")


def cmd_update(args, context_dir: Path):
    """Update an existing decision (version upgrade)"""
    data = load_decisions(context_dir)
    decisions = data.get("decisions", [])

    target = next((d for d in decisions if d.get("id") == args.id), None)
    if not target:
        print(f"Error: ID '{args.id}' not found")
        sys.exit(1)

    now = datetime.now().isoformat()
    old_version = target.get("version", "v0")

    # Mark old one as superseded
    target["status"] = "superseded"
    target["superseded_at"] = now

    # Add new version
    new_id = f"dec_{len(decisions) + 1:04d}"
    new_version = generate_version(decisions)

    new_decision = {
        "id": new_id,
        "version": new_version,
        "title": args.title or target["title"],
        "content": args.content or target.get("content", ""),
        "category": args.category or target.get("category", "general"),
        "type": target.get("type", "manual"),
        "status": "active",
        "timestamp": now,
        "supersedes": [args.id],
        "superseded_at": None,
        "tags": args.tags.split(",") if args.tags else target.get("tags", []),
    }

    decisions.append(new_decision)
    data["decisions"] = decisions
    save_decisions(context_dir, data)

    print(f"\nDecision updated")
    print(f"  {old_version} -> {new_version} ({args.id} -> {new_id})")
    print(f"  Title: {new_decision['title']}")


def cmd_supersede(args, context_dir: Path):
    """Mark a decision as superseded"""
    data = load_decisions(context_dir)
    decisions = data.get("decisions", [])

    target = next((d for d in decisions if d.get("id") == args.id), None)
    if not target:
        print(f"Error: ID '{args.id}' not found")
        sys.exit(1)

    target["status"] = "superseded"
    target["superseded_at"] = datetime.now().isoformat()
    if args.reason:
        target["supersede_reason"] = args.reason

    data["decisions"] = decisions
    save_decisions(context_dir, data)
    print(f"Marked {args.id} as superseded")


def cmd_history(args, context_dir: Path):
    """Show snapshot history"""
    history_dir = context_dir / "decisions_history"
    if not history_dir.exists():
        print("No snapshot history found")
        return

    snapshots = sorted(history_dir.iterdir(), reverse=True)
    print(f"\nSnapshot history ({len(snapshots)} entries)\n")
    for snap in snapshots:
        snap_file = snap / "decisions.json"
        count = 0
        if snap_file.exists():
            try:
                with open(snap_file) as f:
                    d = json.load(f)
                    count = len([x for x in d.get("decisions", []) if x.get("status") == "active"])
            except Exception:
                pass
        print(f"  {snap.name}  (active: {count})")


def main():
    parser = argparse.ArgumentParser(
        description="Context Optimizer - Decision Management CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command")

    # add
    p_add = subparsers.add_parser("add", help="Add a decision")
    p_add.add_argument("title", help="Decision title")
    p_add.add_argument("--content", "-c", help="Detailed description")
    p_add.add_argument("--category", "-cat", choices=VALID_CATEGORIES, help="Category")
    p_add.add_argument("--tags", "-t", help="Tags (comma-separated)")

    # list
    p_list = subparsers.add_parser("list", help="List decisions")
    p_list.add_argument("--category", "-cat", choices=VALID_CATEGORIES)
    p_list.add_argument("--status", "-s", choices=VALID_STATUSES)

    # show
    p_show = subparsers.add_parser("show", help="Show decision details")
    p_show.add_argument("id", help="Decision ID (e.g., dec_0001)")

    # update
    p_update = subparsers.add_parser("update", help="Update a decision (version upgrade)")
    p_update.add_argument("id", help="ID of the decision to update")
    p_update.add_argument("--title", help="New title")
    p_update.add_argument("--content", "-c", help="New detailed description")
    p_update.add_argument("--category", "-cat", choices=VALID_CATEGORIES)
    p_update.add_argument("--tags", "-t", help="Tags (comma-separated)")

    # supersede
    p_sup = subparsers.add_parser("supersede", help="Mark a decision as superseded")
    p_sup.add_argument("id", help="Target ID")
    p_sup.add_argument("--reason", "-r", help="Reason for superseding")

    # history
    subparsers.add_parser("history", help="Show snapshot history")

    args = parser.parse_args()
    context_dir = get_context_dir()

    if args.command == "add":
        cmd_add(args, context_dir)
    elif args.command == "list":
        cmd_list(args, context_dir)
    elif args.command == "show":
        cmd_show(args, context_dir)
    elif args.command == "update":
        cmd_update(args, context_dir)
    elif args.command == "supersede":
        cmd_supersede(args, context_dir)
    elif args.command == "history":
        cmd_history(args, context_dir)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
