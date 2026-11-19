"""A bounded Markdown heading extractor, not a complete GFM renderer.

The four steps deliberately do not share normalized strings. Unsupported
heading syntax makes the result conservative; callers receive diagnostics.
There is no network, filesystem or third-party dependency in this module.
"""
from dataclasses import dataclass, field
import html
import re
import string
import unicodedata


@dataclass
class Heading:
    line: int
    level: int
    raw: str
    syntax: str
    visible: str = ""
    fragment: str | None = None
    issues: list[str] = field(default_factory=list)
    semantic: str | None = None


ATX = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$")
SETEXT = re.compile(r"^ {0,3}(=+|-+)[ \t]*$")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
LIST = re.compile(r"^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+")
HTML_BLOCK = re.compile(r"^ {0,3}</?(?:address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|/?>)", re.I)
REF = re.compile(r"^ {0,3}\[([^\]\n]+)\]:[ \t]*(.*)$")


def _reference_key(value):
    return re.sub(r"\s+", " ", value.strip()).casefold()


def _without_code_spans(value):
    parts, index = [], 0
    while index < len(value):
        if value[index] != "`":
            parts.append(value[index]); index += 1; continue
        run = len(value[index:]) - len(value[index:].lstrip("`"))
        closing = re.search(r"(?<!`)`{" + str(run) + r"}(?!`)", value[index + run:])
        if closing:
            index += run + closing.end()
        else:
            parts.append("`" * run); index += run
    return "".join(parts)


def _comment_start(value):
    """Find an HTML comment opener outside matched inline code spans.

    Resume after each actual comment so backticks inside comments never hide
    a later opener. Preserve the original code bytes for visible-text parsing.
    """
    index = 0
    while index < len(value):
        if value[index] == "\\" and index + 1 < len(value) and value[index + 1] in string.punctuation:
            index += 2
            continue
        if value[index] == "`":
            run = len(value[index:]) - len(value[index:].lstrip("`"))
            closing = re.search(r"(?<!`)`{" + str(run) + r"}(?!`)", value[index + run:])
            index += run + closing.end() if closing else run
            continue
        if value.startswith("<!--", index):
            return index
        index += 1
    return -1


def scan_headings(markdown):
    """Recognize top-level ATX/setext; retain unsupported-container warnings.

    Frontmatter, comments, indented code and matching-length fences are not
    headings. HTML block boundaries follow a deliberately limited subset.
    Multiple paragraph lines form one setext heading.
    """
    lines = markdown.lstrip("\ufeff").splitlines()
    headings, diagnostics, references, paragraph = [], [], set(), []
    start = 0
    if lines and lines[0].strip() == "---":
        closing = next((i for i in range(1, len(lines)) if lines[i].strip() in ("---", "...")), None)
        if closing is None:
            return [], [{"line": 1, "kind": "unclosed_frontmatter", "blocking": True}], set()
        start = closing + 1
    fence = None
    comment = False
    raw_block = None
    html_block = False
    list_indent = None
    pipe_line = None
    for index in range(start, len(lines)):
        line, number = lines[index], index + 1
        if fence:
            if re.fullmatch(r" {0,3}" + re.escape(fence[0]) + "{" + str(fence[1]) + r",}[ \t]*", line):
                fence = None
            continue
        if raw_block:
            if re.search(r"</" + raw_block + r"\s*>", line, re.I):
                raw_block = None
            continue
        if html_block:
            if not line.strip():
                html_block = False
            elif re.search(r"<h[1-6](?:\s|>)", line, re.I):
                diagnostics.append({"line": number, "kind": "raw_html_heading", "blocking": True})
            continue
        # Comments are stateful, but comment-looking bytes inside code never get here.
        rendered = ""
        rest = line
        while rest:
            if comment:
                end = rest.find("-->")
                if end < 0:
                    rest = ""
                else:
                    comment = False
                    rest = rest[end + 3:]
            else:
                begin = _comment_start(rest)
                if begin < 0:
                    rendered += rest
                    rest = ""
                else:
                    rendered += rest[:begin]
                    rest = rest[begin + 4:]
                    comment = True
        line = rendered
        if not line.strip():
            paragraph.clear()
            pipe_line = None
            continue
        match = FENCE.match(line)
        if match and not (match[1][0] == "`" and "`" in match[2]):
            fence = (match[1][0], len(match[1]))
            paragraph.clear()
            continue
        if line.startswith("    ") or line.startswith("\t"):
            if list_indent is not None and ATX.match(line.lstrip()):
                diagnostics.append({"line": number, "kind": "nested_container_heading", "blocking": True})
            if paragraph:
                paragraph.append((number, line.strip(), line.endswith("  ") or line.endswith("\\")))
            continue
        if re.search(r"<(?:[A-Za-z][^>]*\sid|a\b[^>]*\sname)\s*=", _without_code_spans(line), re.I):
            diagnostics.append({"line": number, "kind": "custom_html_anchor", "blocking": True})
        match = re.match(r"^ {0,3}<(script|style|pre|textarea)(?:\s|>)", line, re.I)
        if match:
            if not re.search(r"</" + match[1] + r"\s*>", line, re.I):
                raw_block = match[1]
            paragraph.clear()
            continue
        if HTML_BLOCK.match(line) or re.fullmatch(r" {0,3}</?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*)?/?>[ \t]*", line):
            if re.search(r"<h[1-6](?:\s|>)", line, re.I):
                diagnostics.append({"line": number, "kind": "raw_html_heading", "blocking": True})
            html_block = True
            paragraph.clear()
            continue
        # Do not guess how nested container indentation changes block parsing.
        nested = re.sub(r"^ {0,3}(?:>[ \t]*|(?:[-+*]|\d{1,9}[.)])[ \t]+)", "", line)
        if nested != line:
            match = LIST.match(line)
            if match:
                list_indent = len(match[0])
            if ATX.match(nested) or SETEXT.match(nested):
                diagnostics.append({"line": number, "kind": "nested_container_heading", "blocking": True})
            paragraph.clear()
            continue
        if list_indent is not None:
            indentation = len(line) - len(line.lstrip(" "))
            if indentation < list_indent:
                list_indent = None
            elif ATX.match(line):
                diagnostics.append({"line": number, "kind": "nested_container_heading", "blocking": True})
        match = ATX.match(line)
        if match:
            raw = (match[2] or "").strip()
            raw = re.sub(r"[ \t]+#+[ \t]*$", "", raw)
            headings.append(Heading(number, len(match[1]), raw, "atx"))
            paragraph.clear()
            continue
        match = SETEXT.match(line)
        if match:
            if paragraph:
                headings.append(Heading(paragraph[0][0], 1 if match[1][0] == "=" else 2,
                                        "\n".join(p[1] for p in paragraph), "setext"))
                if any(p[2] for p in paragraph):
                    diagnostics.append({"line": paragraph[0][0], "kind": "setext_hard_break", "blocking": True})
            elif pipe_line is not None:
                diagnostics.append({"line": pipe_line, "kind": "ambiguous_pipe_setext", "blocking": True})
            paragraph.clear()
            pipe_line = None
            continue
        match = REF.match(line)
        if match and match[2] and _simple_destination(match[2]):
            references.add(_reference_key(match[1]))
            paragraph.clear()
            continue
        if re.fullmatch(r" {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})", line) or "|" in line:
            paragraph.clear()
            pipe_line = number if "|" in line else None
            continue
        pipe_line = None
        paragraph.append((number, line.strip(), line.endswith("  ") or line.endswith("\\")))
    if comment:
        diagnostics.append({"line": len(lines), "kind": "unclosed_comment", "blocking": True})
    return headings, diagnostics, references


def _closing(text, pos, left, right):
    depth, index = 1, pos + 1
    while index < len(text):
        if text[index] == "\\":
            index += 2
            continue
        if text[index] == left:
            depth += 1
        elif text[index] == right:
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return None


def _simple_destination(value):
    """An explicit subset: empty, unspaced or angle destination + optional title.

    Nested parentheses in a destination are accepted only when balanced by the
    surrounding scanner. Ambiguous whitespace/quotes never create a link.
    """
    value = value.strip()
    if not value:
        return True
    if re.search(r"[\x00-\x1f]", value):
        return False
    destination = r"(?:<[^<>\n]*>|(?:\\.|[^\s<>\\])+)"
    title = r'''(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\))'''
    return bool(re.fullmatch(destination + r"(?:[ \t]+" + title + ")?", value))


MAX_INLINE_DEPTH = 32


def visible_text(raw, references=frozenset(), _depth=0):
    """Convert a small, explicit inline subset; preserve literal underscores.

    Images, custom attributes, complex delimiter runs and unknown HTML are
    diagnostic boundaries, not silently stripped into plausible fragments.
    """
    if _depth >= MAX_INLINE_DEPTH:
        return "", ["inline_nesting_limit"]
    output, issues = [], []
    # Preserve soft-break newlines for slug allocation. GitHub's observed
    # multiline setext anchor removes that newline, rather than adding '-'.
    text, index = raw, 0
    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text) and text[index + 1] in string.punctuation:
            output.append(text[index + 1]); index += 2; continue
        if char == "`":
            run = len(text[index:]) - len(text[index:].lstrip("`"))
            closing = re.search(r"(?<!`)`{" + str(run) + r"}(?!`)", text[index + run:])
            if closing:
                end = index + run + closing.start()
                content = text[index + run:end].replace("\n", " ")
                if content.startswith(" ") and content.endswith(" ") and content.strip(" "):
                    content = content[1:-1]
                output.append(content); index = end + run; continue
            output.append("`" * run); index += run; continue
        if text.startswith("![", index):
            issues.append("image_inline"); output.append(text[index:]); break
        if char == "[":
            end = _closing(text, index, "[", "]")
            if end is not None:
                label = text[index + 1:end]
                following = end + 1
                if following < len(text) and text[following] == "(":
                    dest_end = _closing(text, following, "(", ")")
                    destination = text[following + 1:dest_end] if dest_end is not None else ""
                    if dest_end is not None and _simple_destination(destination):
                        label_text, nested_issues = visible_text(label, references, _depth + 1)
                        output.append(label_text); issues.extend(nested_issues)
                        index = dest_end + 1; continue
                    issues.append("ambiguous_link_destination")
                elif following < len(text) and text[following] == "[":
                    ref_end = text.find("]", following + 1)
                    reference = text[following + 1:ref_end] or label
                    if ref_end >= 0 and _reference_key(reference) in references:
                        label_text, nested_issues = visible_text(label, references, _depth + 1)
                        output.append(label_text); issues.extend(nested_issues)
                        index = ref_end + 1; continue
                elif _reference_key(label) in references:
                    label_text, nested_issues = visible_text(label, references, _depth + 1)
                    output.append(label_text); issues.extend(nested_issues)
                    index = end + 1; continue
        if char == "<":
            tag = re.match(r"</?([A-Za-z][A-Za-z0-9]*)\s*>", text[index:])
            if tag and tag[1].lower() in {"em", "strong", "b", "i", "s", "del", "code", "kbd", "sub", "sup"}:
                index += len(tag[0]); continue
            autolink = re.match(r"<(?:https?://[^<>\s]+|[^<>\s@]+@[^<>\s@]+)>", text[index:])
            if autolink:
                output.append(autolink[0][1:-1]); index += len(autolink[0]); continue
            if re.match(r"</?[A-Za-z!][^>]*>", text[index:]):
                issues.append("unsupported_html_inline")
        if char == "&":
            entity = re.match(r"&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]+);", text[index:])
            if entity:
                output.append(html.unescape(entity[0])); index += len(entity[0]); continue
        if char in "*_~":
            run = len(text[index:]) - len(text[index:].lstrip(char))
            intraword = char == "_" and index > 0 and text[index - 1].isalnum() and index + run < len(text) and text[index + run].isalnum()
            if run >= 3:
                issues.append("complex_emphasis_run")
            if run <= 2 and not intraword and (char != "~" or run == 2):
                delimiter = char * run
                end = text.find(delimiter, index + run)
                if end > index + run and not text[index + run].isspace() and not text[end - 1].isspace():
                    content, nested_issues = visible_text(text[index + run:end], references, _depth + 1)
                    output.append(content); issues.extend(nested_issues); index = end + run; continue
            output.append(char * run); index += run; continue
        output.append(char); index += 1
    return "".join(output), sorted(set(issues))


def slug_base(visible):
    """Bounded GitHub-like rule: preserve leading '-', '_' and Unicode marks.

    Observed anchors cover emoji, VS16 and ZWJ. This is not GitHub's complete
    Unicode exclusion table. Unsupported controls/format/space are flagged.
    """
    result, issues = [], []
    for char in visible.lower():
        category = unicodedata.category(char)
        if char == "\n":
            continue
        if char == " ":
            result.append("-")
        elif char in "-_\u200d" or category[0] in "LNM":
            result.append(char)
        elif category[0] not in "PS":
            issues.append("unsupported_slug_codepoint_U+%04X" % ord(char))
    return "".join(result), sorted(set(issues))


def allocate_slugs(headings, references=frozenset()):
    used = set()
    uncertain_prior = False
    for heading in headings:
        heading.visible, heading.issues = visible_text(heading.raw, references)
        base, issues = slug_base(heading.visible)
        heading.issues.extend(issues)
        if uncertain_prior:
            heading.issues.append("earlier_heading_slug_uncertain")
        if heading.issues:
            uncertain_prior = True
            continue
        suffix, fragment = 0, base
        while fragment in used:
            suffix += 1
            fragment = f"{base}-{suffix}"
        used.add(fragment)
        heading.fragment = fragment
    return headings


GENERAL = {"en": {"usage", "how to use", "how to use it", "how to use the tool"},
           "ja": {"使い方", "本ツールの使い方", "使用方法", "利用方法"}}
MIXED = {"en": {"features and usage", "usage and fixed examples"},
         "ja": {"機能と使い方", "使い方と固定教材例"}}
START = {"en": {"quick start", "getting started", "setup and operation"},
         "ja": {"クイックスタート", "使い方（クイックスタート）", "セットアップと運用"}}


def semantic_key(visible):
    # Strip decorative leading symbols only here, never in slug input.
    text = visible.strip()
    while text and unicodedata.category(text[0])[0] not in "LN":
        text = text[1:].lstrip()
    return re.sub(r"\s+", " ", text).casefold()


def choose_usage(headings, language, diagnostics):
    if language not in GENERAL:
        raise ValueError("Unsupported language")
    candidates = []
    for heading in headings:
        key = semantic_key(heading.visible)
        for priority, (name, family) in enumerate((("general", GENERAL), ("mixed", MIXED), ("start", START))):
            if key in family[language]:
                heading.semantic = name
                candidates.append((priority, heading.level, heading.line, heading))
                break
    if not candidates:
        uncertain = any(d.get("blocking") for d in diagnostics) or any(h.issues for h in headings)
        return {"status": "top"}, "uncertain_syntax" if uncertain else "no_accepted_heading", None
    selected = min(candidates, key=lambda row: row[:3])[3]
    # Any unparsed block heading can change semantic priority or duplicate IDs.
    if any(d.get("blocking") for d in diagnostics) or selected.issues or not selected.fragment:
        return {"status": "top"}, "uncertain_syntax", selected
    return {"status": "heading", "fragment": selected.fragment}, selected.semantic, selected


def extract_usage(markdown, language):
    headings, diagnostics, references = scan_headings(markdown)
    allocate_slugs(headings, references)
    metadata, reason, chosen = choose_usage(headings, language, diagnostics)
    return {"metadata": metadata, "reason": reason, "selected": chosen,
            "headings": headings, "diagnostics": diagnostics}


MAX_FRAGMENT_LENGTH = 512


def valid_fragment(value):
    """Accept bounded raw slugs, never URLs or already escaped fragments."""
    return (isinstance(value, str) and 0 < len(value) <= MAX_FRAGMENT_LENGTH
            and all(char in "-_\u200d" or unicodedata.category(char)[0] in "LMN" for char in value))


def valid_entry(value):
    if not isinstance(value, dict):
        return False
    if value.get("status") == "heading":
        return set(value) == {"status", "fragment"} and valid_fragment(value["fragment"])
    return value.get("status") in ("top", "missing") and set(value) == {"status"}


def previous_entry(value, language):
    """Recover one valid language without trusting a malformed sibling."""
    entry = value.get(language) if isinstance(value, dict) else None
    return dict(entry) if valid_entry(entry) else None
