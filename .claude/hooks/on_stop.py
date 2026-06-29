#!/usr/bin/env python3
"""
on_stop.py - Stop hook
Detects decisions from Claude's response upon completion and saves them to decisions.json
"""

import json
import sys
import os
import re
from datetime import datetime
from pathlib import Path


# Decision-indicating patterns in Japanese and English
DECISION_PATTERNS = [
    # Japanese patterns
    (r"(.{5,80})(?:に決め|と決め|を決め|で決め)", "decision"),
    (r"(.{5,80})(?:を採用|に採用|で採用)", "adoption"),
    (r"(.{5,80})(?:方針で進め|方針にし|方針とし)", "policy"),
    (r"(.{5,80})(?:を使用する|を使う|を利用する)(?:ことにし|こととし|に決め)", "tech_choice"),
    (r"(.{5,80})(?:アーキテクチャ|設計|構成)(?:とし|にし|で進め)", "architecture"),
    (r"(?:結論として|まとめると|方針として)[：:]\s*(.{5,100})", "conclusion"),
    (r"(?:〜|→)\s*(.{5,80})(?:で実装|で開発|を実装|を採用)", "implementation"),
    # English patterns
    (r"(?:decided? to|will use|going with|adopted?)\s+(.{5,80})", "decision_en"),
    (r"(?:the approach is|our strategy is|we'll)\s+(.{5,80})", "strategy_en"),
]

# Category estimation keywords
CATEGORY_KEYWORDS = {
    "architecture": ["アーキテクチャ", "設計", "構成", "architecture", "design", "structure"],
    "tech_stack": ["フレームワーク", "ライブラリ", "言語", "DB", "データベース", "framework", "library"],
    "api": ["API", "エンドポイント", "インターフェース", "endpoint", "interface"],
    "ui_ux": ["UI", "UX", "デザイン", "画面", "コンポーネント", "design", "component"],
    "infrastructure": ["AWS", "GCP", "Azure", "インフラ", "サーバー", "Kubernetes", "Docker"],
    "policy": ["方針", "ルール", "規約", "制約", "policy", "rule", "constraint"],
    "business": ["要件", "仕様", "ビジネス", "requirement", "specification"],
}


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


def save_decisions(context_dir: Path, data: dict):
    decisions_file = context_dir / "decisions.json"
    data["last_updated"] = datetime.now().isoformat()
    with open(decisions_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def estimate_category(text: str) -> str:
    """Estimate the category from the text"""
    text_lower = text.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(kw.lower() in text_lower for kw in keywords):
            return category
    return "general"


def generate_version(decisions: list) -> str:
    """Generate the next version number"""
    if not decisions:
        return "v1"
    # Find the maximum version number
    max_v = 0
    for d in decisions:
        v = d.get("version", "v0")
        try:
            num = int(v.replace("v", ""))
            max_v = max(max_v, num)
        except ValueError:
            pass
    return f"v{max_v + 1}"


def detect_decisions(text: str) -> list:
    """Detect decisions from the text"""
    found = []
    seen_titles = set()

    for pattern, decision_type in DECISION_PATTERNS:
        for match in re.finditer(pattern, text, re.MULTILINE | re.IGNORECASE):
            title = match.group(1).strip() if match.lastindex else match.group(0).strip()
            # Deduplication check (by first 20 characters)
            key = title[:20]
            if key in seen_titles:
                continue
            seen_titles.add(key)

            # Skip if too short or too long
            if len(title) < 5 or len(title) > 100:
                continue

            found.append({
                "title": title,
                "type": decision_type,
                "category": estimate_category(title),
            })

    return found


def find_superseded(decisions: list, new_title: str) -> list:
    """Find existing decisions in the same category that would be superseded"""
    superseded_ids = []
    new_words = set(new_title.lower().split())

    for d in decisions:
        if d.get("status") != "active":
            continue
        existing_words = set(d.get("title", "").lower().split())
        # Consider it a related decision if word overlap is 50% or more
        if len(new_words) > 0 and len(existing_words) > 0:
            overlap = len(new_words & existing_words) / min(len(new_words), len(existing_words))
            if overlap >= 0.5:
                superseded_ids.append(d["id"])

    return superseded_ids


def parse_transcript_for_decisions(event_data: dict) -> list:
    """Extract decision text from event data (transcript, etc.)"""
    # In Stop hook, the assistant's last response may be available
    # Read from transcript path if available
    texts = []

    # If transcript_path exists in event_data
    transcript_path = event_data.get("transcript_path")
    if transcript_path and Path(transcript_path).exists():
        try:
            with open(transcript_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        # Only target assistant messages
                        if entry.get("role") == "assistant":
                            content = entry.get("content", "")
                            if isinstance(content, list):
                                for block in content:
                                    if isinstance(block, dict) and block.get("type") == "text":
                                        texts.append(block.get("text", ""))
                            elif isinstance(content, str):
                                texts.append(content)
                    except (json.JSONDecodeError, KeyError):
                        pass
        except IOError:
            pass

    return texts


def main():
    try:
        event_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        event_data = {}

    # stop_hook_active check (prevent infinite loop)
    if event_data.get("stop_hook_active"):
        sys.exit(0)

    project_root = get_project_root()
    context_dir = project_root / ".claude" / "context"
    context_dir.mkdir(parents=True, exist_ok=True)

    # Collect decision text from transcript
    texts = parse_transcript_for_decisions(event_data)

    if not texts:
        # Do nothing if transcript is unavailable
        sys.exit(0)

    # Detect decisions
    all_detected = []
    for text in texts:
        detected = detect_decisions(text)
        all_detected.extend(detected)

    if not all_detected:
        sys.exit(0)

    # Update decisions.json
    decisions_data = load_decisions(context_dir)
    decisions = decisions_data.get("decisions", [])
    now = datetime.now().isoformat()
    new_count = 0

    for detected in all_detected:
        title = detected["title"]

        # Mark duplicate existing entries as superseded
        superseded_ids = find_superseded(decisions, title)
        for sid in superseded_ids:
            for d in decisions:
                if d.get("id") == sid:
                    d["status"] = "superseded"
                    d["superseded_at"] = now

        # Add new decision
        new_id = f"dec_{len(decisions) + 1:04d}"
        new_version = generate_version(decisions)
        decisions.append({
            "id": new_id,
            "version": new_version,
            "title": title,
            "content": "",          # Details can be filled in manually or extracted separately
            "category": detected["category"],
            "type": detected["type"],
            "status": "active",
            "timestamp": now,
            "supersedes": superseded_ids if superseded_ids else None,
            "superseded_at": None,
            "tags": [],
        })
        new_count += 1

    decisions_data["decisions"] = decisions
    save_decisions(context_dir, decisions_data)

    # Log output to stderr (viewable in Ctrl+O verbose mode)
    print(
        f"[Context Optimizer] Recorded {new_count} decision(s) "
        f"(total: {len([d for d in decisions if d.get('status') == 'active'])} active)",
        file=sys.stderr,
    )

    sys.exit(0)


if __name__ == "__main__":
    main()
