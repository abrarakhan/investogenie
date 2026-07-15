#!/usr/bin/env python3
"""Extract text from an Indian CAS PDF.

The password is accepted only for this process invocation. The PDF contents and
password are not persisted by this script.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pypdf import PdfReader


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract text from CAS PDF")
    parser.add_argument("pdf")
    parser.add_argument("--password", default="")
    args = parser.parse_args()

    path = Path(args.pdf)
    if not path.exists():
        print("PDF file not found", file=sys.stderr)
        return 2

    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            if not args.password:
                print("PDF is encrypted; password required", file=sys.stderr)
                return 3
            result = reader.decrypt(args.password)
            if result == 0:
                print("PDF password did not unlock the file", file=sys.stderr)
                return 4
        pages = []
        for index, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            pages.append(f"\n--- PAGE {index} ---\n{text}")
        output = "\n".join(pages).strip()
        if not output:
            print("No text could be extracted from PDF", file=sys.stderr)
            return 5
        print(output)
        return 0
    except Exception as exc:
        print(f"PDF extraction failed: {exc}", file=sys.stderr)
        return 6


if __name__ == "__main__":
    raise SystemExit(main())
