#!/usr/bin/env python3
"""Regenerate the catalog without dropping a repository after a failed read.

Only repos.txt decides which repositories are included. An unavailable or
malformed existing README keeps its last valid metadata; a new one must be
valid. All reads and checks finish before either catalog file is written.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import html
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass, field
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import yaml
from category_groups import MetadataError, validate_categories, validate_groups

ROOT = Path(__file__).resolve().parents[1]
JST = dt.timezone(dt.timedelta(hours=9))
ID_RE = re.compile(r"day[0-9]{3,}\Z")
SLUG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*\Z")


class CatalogError(Exception):
    """A failure that must leave the catalog unchanged."""


class UnauthorizedError(CatalogError):
    """HTTP 401: do not retry, use another branch, or make another request."""


class ReadmeError(Exception):
    """An unavailable or malformed README, eligible for previous-value recovery."""


def safe_https(value: str) -> bool:
    if not isinstance(value, str) or not value or re.search(r"[\s\\\x00-\x1f\x7f]", value):
        return False
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == "https" and bool(parsed.hostname)
                and parsed.username is None and parsed.password is None
                and parsed.port in (None, 443))
    except ValueError:
        return False


class HTTPSRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not safe_https(newurl):
            raise CatalogError("Refusing a redirect to a non-HTTPS or unsafe URL")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def urlopen(request, *, timeout):
    # Kept as a small boundary so tests never need the network.
    return build_opener(HTTPSRedirectHandler()).open(request, timeout=timeout)


def repo_key(url: str) -> str:
    if not isinstance(url, str):
        raise CatalogError("Repository URL must be a string")
    match = re.fullmatch(
        r"(?:https://github\.com/|git@github\.com:)([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?",
        url.strip(),
    )
    if not match or match[2] in (".", ".."):
        raise CatalogError("Invalid GitHub repository URL: " + url)
    return (match[1] + "/" + match[2]).lower()


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise CatalogError(f"Cannot read {path.name}: {exc}") from exc


def read_repos(path: Path) -> list[str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise CatalogError("Cannot read repos.txt") from exc
    repos = [repo_key(line.strip()) for line in lines if line.strip() and not line.lstrip().startswith("#")]
    if not repos or len(repos) != len(set(repos)):
        raise CatalogError("repos.txt must contain unique repositories and must not be empty")
    return repos


def load_categories(path: Path) -> dict:
    try:
        return validate_categories(read_json(path))[1]
    except MetadataError as exc:
        raise CatalogError(str(exc)) from exc

def fetch_readme(repo: str, timeout: float) -> str:
    for branch in ("main", "master"):
        request = Request(f"https://raw.githubusercontent.com/{repo}/{branch}/README.md", method="GET")
        try:
            with urlopen(request, timeout=timeout) as response:
                if not safe_https(response.geturl()):
                    raise CatalogError("Unsafe README response URL: " + repo)
                return response.read().decode("utf-8", errors="strict")
        except HTTPError as exc:
            if exc.code == 401:
                raise UnauthorizedError("HTTP 401 reading README: " + repo) from exc
            if exc.code == 404:
                continue
            raise ReadmeError(f"README HTTP {exc.code}") from exc
        except (URLError, OSError, UnicodeError, HTTPException) as exc:
            raise ReadmeError("README read failed: " + type(exc).__name__) from exc
    raise ReadmeError("README not found on main or master")


def extract_yaml_from_readme(text: str) -> dict:
    comment = re.search(r"<!--(.*?)-->", text, re.DOTALL)
    matter = re.search(r"(?:^|\n)\s*---\s*\n(.*?)\n\s*---(?:\s*\n|\s*$)", comment[1], re.DOTALL) if comment else None
    if not matter:
        raise ReadmeError("README has no YAML frontmatter in its first HTML comment")
    try:
        data = yaml.safe_load(matter[1])
    except yaml.YAMLError as exc:
        raise ReadmeError("Malformed YAML frontmatter") from exc
    if not isinstance(data, dict):
        raise ReadmeError("YAML frontmatter must be a mapping")
    return data


def normalized_entry(metadata: dict, repo: str, maps: dict) -> dict:
    if not isinstance(metadata, dict):
        raise ReadmeError("Metadata must be an object")
    tid, slug = metadata.get("id"), metadata.get("slug")
    if not isinstance(tid, str) or not ID_RE.fullmatch(tid) or int(tid[3:]) == 0:
        raise ReadmeError("Missing or invalid tool id")
    if not isinstance(slug, str) or not SLUG_RE.fullmatch(slug):
        raise ReadmeError("Missing or invalid tool slug")
    hub = metadata.get("hub", True)
    if not isinstance(hub, bool):
        raise ReadmeError("hub must be a YAML boolean")
    entry = {"id": tid, "slug": slug}
    for key in ("title", "subtitle_ja", "subtitle_en", "description_ja", "description_en"):
        value = metadata.get(key, "")
        if not isinstance(value, str) or (key == "title" and not value.strip()):
            raise ReadmeError("Missing or invalid " + key)
        entry[key] = value
    for key in ("category_ja", "category_en", "tags"):
        value = metadata.get(key, [])
        if value is None:
            value = []
        if not isinstance(value, list) or any(not isinstance(x, str) or not x for x in value):
            raise ReadmeError("Invalid " + key)
        entry[key] = list(value)
    ids = []
    for lang in ("ja", "en"):
        for name in entry["category_" + lang]:
            cid = maps[lang].get(name)
            if cid and cid not in ids:
                ids.append(cid)
    entry["category_ids"] = ids
    difficulty = metadata.get("difficulty")
    # A missing or invalid level is unknown, never silently level one.
    entry["difficulty"] = difficulty if type(difficulty) is int and 1 <= difficulty <= 5 else None
    entry["repo_url"] = metadata.get("repo_url") or "https://github.com/" + repo
    entry["demo_url"] = metadata.get("demo_url", "")
    if not safe_https(entry["repo_url"]) or repo_key(entry["repo_url"]) != repo:
        raise CatalogError("Unsafe or mismatched repository URL: " + tid)
    if entry["demo_url"] != "" and not safe_https(entry["demo_url"]):
        raise CatalogError("Unsafe demo URL: " + tid)
    entry["hub"] = hub
    return entry


def validate_unique(entries: list[dict]) -> None:
    for key in ("id", "slug"):
        values = [tool[key] for tool in entries]
        if len(values) != len(set(values)):
            raise CatalogError("Duplicate tool " + key)


def load_previous(path: Path, maps: dict) -> tuple[dict, dict]:
    data = read_json(path)
    if not isinstance(data, dict) or data.get("schema_version") != 1 or not isinstance(data.get("tools"), list):
        raise CatalogError("Invalid previous catalog")
    previous = {}
    valid = []
    for tool in data["tools"]:
        if not isinstance(tool, dict):
            raise CatalogError("Invalid previous tool entry")
        key = repo_key(tool.get("repo_url"))
        if key in previous:
            raise CatalogError("Duplicate repository in previous catalog: " + key)
        try:
            valid.append(normalized_entry(tool, key, maps))
        except ReadmeError as exc:
            raise CatalogError("Invalid previous metadata: " + key) from exc
        previous[key] = tool
    validate_unique(valid)
    return data, previous


def load_added(path: Path, today: dt.date, previous: dict) -> dict:
    added = read_json(path)
    if not isinstance(added, dict):
        raise CatalogError("added.json must be an id-to-date object; initialize it explicitly from Git history")
    for tid, value in added.items():
        if not ID_RE.fullmatch(tid) or not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise CatalogError("Invalid id or date in added.json")
        try:
            date = dt.date.fromisoformat(value)
        except ValueError as exc:
            raise CatalogError("Invalid date in added.json: " + tid) from exc
        if date > today:
            raise CatalogError("Future date in added.json: " + tid)
    for tool in previous.values():
        tid = tool["id"]
        if tool.get("hub") is not False and tid not in added:
            raise CatalogError("Missing historical added date: " + tid + "; do not replace history with today's date")
        if "added" in tool and added.get(tid) != tool["added"]:
            raise CatalogError("Historical added date changed: " + tid)
    return added


@dataclass
class Report:
    retained: list = field(default_factory=list)
    removed: list = field(default_factory=list)
    unknown: dict = field(default_factory=dict)
    empty_categories: list = field(default_factory=list)
    difficulty: list = field(default_factory=list)
    slug_changes: list = field(default_factory=list)
    demos: list = field(default_factory=list)
    total: int = 0
    visible: int = 0
    changed: bool = False

    def collect(self, entry: dict, maps: dict, ignored=None) -> None:
        tid = entry["id"]
        for lang in ("ja", "en"):
            for name in entry["category_" + lang]:
                if name not in maps[lang] and name not in (ignored or {}).get(lang, set()):
                    self.unknown.setdefault((lang, name), set()).add(tid)
        if not entry["category_ids"]:
            self.empty_categories.append(tid)
        if entry["difficulty"] is None:
            self.difficulty.append(tid)

    def markdown(self) -> str:
        def cell(value):
            return html.escape(str(value), quote=False).replace("|", "\\|").replace("\r", " ").replace("\n", " ")

        def table(title, headers, rows):
            lines = ["", "### " + title, "", "| " + " | ".join(headers) + " |",
                     "| " + " | ".join("---" for _ in headers) + " |"]
            lines += ["| " + " | ".join(cell(v) for v in row) + " |" for row in rows]
            if not rows:
                lines.append("| None |" + " — |" * (len(headers) - 1))
            return lines

        lines = ["## Catalog regeneration", "", f"Tools: **{self.total}**; visible: **{self.visible}**; hidden: **{self.total-self.visible}**.",
                 "", "Repository data: " + ("updated." if self.changed else "unchanged (generation timestamp preserved)."),
                 "", "This result does not confirm a GitHub Pages deployment."]
        lines += table("Previous metadata retained", ["Repository", "Reason"], self.retained)
        lines += table("Repositories removed from repos.txt", ["Repository", "Tool"], self.removed)
        lines += table("Unknown category names", ["Language", "Name", "Tools"],
                       [(lang, name, ", ".join(sorted(ids))) for (lang, name), ids in sorted(self.unknown.items())])
        lines += table("Tools without a mapped category", ["Tool"], [(tid,) for tid in self.empty_categories])
        lines += table("Unknown difficulty (stored as null)", ["Tool"], [(tid,) for tid in self.difficulty])
        lines += table("Slug changes (saved progress uses the slug)", ["Tool", "Previous", "Current"], self.slug_changes)
        lines += table("Demo GET results", ["Tool", "URL", "Result"], self.demos)
        return "\n".join(lines) + "\n"


def check_demo(tool: dict, timeout: float) -> str:
    url = tool["demo_url"]
    if not url:
        return "No demo"
    try:
        with urlopen(Request(url, method="GET"), timeout=timeout) as response:
            if not safe_https(response.geturl()):
                raise CatalogError("Unsafe demo redirect: " + tool["id"])
            # GET, not HEAD; status and headers suffice and the body is not stored.
            return "HTTP " + str(response.status)
    except HTTPError as exc:
        if exc.code == 401:
            raise UnauthorizedError("HTTP 401 checking demo: " + tool["id"]) from exc
        return "HTTP " + str(exc.code)
    except (URLError, OSError, HTTPException) as exc:
        return type(exc).__name__


def json_text(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def write_files(contents: dict[Path, str]) -> None:
    # Stage every output before replacing any destination. Network and validation
    # failures never reach this function. Both data files are committed together.
    temporary = []
    try:
        for path, content in contents.items():
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=path.parent,
                                             prefix="." + path.name + ".", delete=False) as stream:
                temporary.append((Path(stream.name), path))
                stream.write(content)
        for source, target in temporary:
            os.replace(source, target)
    finally:
        for source, _ in temporary:
            source.unlink(missing_ok=True)


def regenerate(root: Path, *, timeout: float = 20, check_demos: bool = False,
               now: dt.datetime | None = None) -> Report:
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        raise CatalogError("Regeneration time must include a timezone")
    today = now.astimezone(JST).date()
    repos = read_repos(root / "repos.txt")
    maps = load_categories(root / "data/categories.json")
    try:
        ignored = validate_groups(read_json(root / "data/category_groups.json"), read_json(root / "data/categories.json"))
    except MetadataError as exc:
        raise CatalogError(str(exc)) from exc
    tools_path, added_path = root / "data/tools.json", root / "data/added.json"
    old_data, previous = load_previous(tools_path, maps)
    added = load_added(added_path, today, previous)
    next_added = dict(added)
    report = Report()
    report.removed = [(repo, tool["id"]) for repo, tool in previous.items() if repo not in set(repos)]
    candidates = []
    for repo in repos:
        print("Reading " + repo, file=sys.stderr)
        old = previous.get(repo)
        try:
            metadata = extract_yaml_from_readme(fetch_readme(repo, timeout))
            entry = normalized_entry(metadata, repo, maps)
        except ReadmeError as exc:
            if old is None:
                raise CatalogError("New repository has no valid metadata: " + repo + ": " + str(exc)) from exc
            entry = normalized_entry(old, repo, maps)
            report.retained.append((repo, str(exc)))
            print("WARNING: retaining " + repo + ": " + str(exc), file=sys.stderr)
        if old and old["id"] != entry["id"]:
            raise CatalogError("Tool id changed for an existing repository: " + repo)
        if old and old["slug"] != entry["slug"]:
            report.slug_changes.append((entry["id"], old["slug"], entry["slug"]))
        tid = entry["id"]
        if entry["hub"] and tid not in next_added:
            next_added[tid] = today.isoformat()
        if tid in next_added:
            entry["added"] = next_added[tid]
        report.collect(entry, maps, ignored)
        candidates.append(entry)
    validate_unique(candidates)
    candidates.sort(key=lambda tool: tool["id"])
    if check_demos:
        for tool in candidates:
            report.demos.append((tool["id"], tool["demo_url"], check_demo(tool, timeout)))
    report.total = len(candidates)
    report.visible = sum(tool["hub"] for tool in candidates)
    next_data = copy.deepcopy(old_data)
    next_data["tools"] = candidates
    # Object key order, formatting and generated_at alone are not content changes.
    report.changed = next_data != old_data or next_added != added
    outputs = {}
    if next_data != old_data:
        next_data["generated_at"] = now.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        outputs[tools_path] = json_text(next_data)
    if next_added != added:
        outputs[added_path] = json_text(dict(sorted(next_added.items())))
    write_files(outputs)
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--timeout", type=float, default=20)
    parser.add_argument("--check-demos", action="store_true", help="Check demo URLs with GET before writing")
    parser.add_argument("--summary", type=Path, default=os.environ.get("GITHUB_STEP_SUMMARY"))
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    try:
        report = regenerate(args.root, timeout=args.timeout, check_demos=args.check_demos)
    except UnauthorizedError as exc:
        print("ERROR: " + str(exc) + "; stopped without writing any output", file=sys.stderr)
        return 2
    except (CatalogError, OSError) as exc:
        print("ERROR: " + str(exc), file=sys.stderr)
        return 1
    summary = report.markdown()
    print(summary)
    if args.summary:
        try:
            with args.summary.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(summary)
        except OSError as exc:
            print("ERROR: cannot write summary: " + str(exc), file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
