#!/usr/bin/env python3
"""Initialize added.json once, from the first visible entries on main's history.

Dates describe first inclusion as a visible catalog entry, not the time a Pages
deployment was observed. Existing added.json is never overwritten.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

from update_tools import CatalogError, ID_RE, JST, ROOT, json_text


def git(root: Path, *args: str) -> str:
    try:
        return subprocess.check_output(["git", "-C", str(root), *args], text=True,
                                       encoding="utf-8", stderr=subprocess.PIPE, timeout=30)
    except (subprocess.SubprocessError, OSError) as exc:
        raise CatalogError("Cannot read the requested Git history") from exc


def first_seen(root: Path, ref: str = "HEAD", *, today: dt.date | None = None) -> dict:
    today = today or dt.datetime.now(JST).date()
    if git(root, "rev-parse", "--is-shallow-repository").strip() != "false":
        raise CatalogError("Full Git history is required; refusing to guess initial dates")
    # Resolve first so a supplied ref cannot be interpreted as a later option.
    commit = git(root, "rev-parse", "--verify", "--end-of-options", ref + "^{commit}").strip()
    lines = git(root, "log", "--first-parent", "--reverse", "--format=%H%x09%cI", commit,
                "--", "data/tools.json").splitlines()
    added = {}
    latest = None
    for line in lines:
        sha, committed_at = line.split("\t")
        try:
            snapshot = json.loads(git(root, "show", sha + ":data/tools.json"))
            if not isinstance(snapshot, dict) or not isinstance(snapshot.get("tools"), list):
                raise ValueError("Invalid catalog shape")
            stamp = snapshot.get("generated_at") or committed_at
            when = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            if when.tzinfo is None or when.astimezone(JST).date() > today:
                raise ValueError("Invalid or future generation timestamp")
            date = when.astimezone(JST).date().isoformat()
            for tool in snapshot["tools"]:
                tid = tool["id"]
                if not isinstance(tid, str) or not ID_RE.fullmatch(tid):
                    raise ValueError("Invalid historical id")
                if tool.get("hub") is not False:
                    added.setdefault(tid, date)
            latest = snapshot
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise CatalogError("Invalid catalog history at " + sha[:12]) from exc
    if latest is None or not added:
        raise CatalogError("No visible catalog history was found")
    current = json.loads(git(root, "show", commit + ":data/tools.json"))
    missing = [tool["id"] for tool in current["tools"] if tool.get("hub") is not False and tool["id"] not in added]
    if missing:
        raise CatalogError("Missing first-seen evidence: " + ", ".join(missing))
    return dict(sorted(added.items()))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--ref", default="HEAD", help="Mainline commit whose full first-parent history is used")
    args = parser.parse_args(argv)
    target = args.root / "data/added.json"
    try:
        if target.exists():
            raise CatalogError("added.json already exists; refusing to overwrite its history")
        added = first_seen(args.root, args.ref)
        with target.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(json_text(added))
    except (CatalogError, OSError) as exc:
        print("ERROR: " + str(exc), file=sys.stderr)
        return 1
    print(f"Initialized {len(added)} first-seen dates from {args.ref}; tools.json was not changed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
