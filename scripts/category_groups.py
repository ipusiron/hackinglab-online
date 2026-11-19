"""Strict category and field metadata validation, without I/O or dependencies."""
import re


class MetadataError(ValueError):
    pass


# Match JavaScript String.trim rather than Python-only whitespace such as U+0085.
TRIM_CHARS = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def text(value):
    return isinstance(value, str) and bool(value) and value == value.strip(TRIM_CHARS)


def keys(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= value.keys() or not value.keys() <= set(required) | set(optional):
        raise MetadataError("Invalid metadata properties")


def valid_id(value):
    return isinstance(value, str) and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value)


def validate_categories(categories):
    if not isinstance(categories, list) or not categories:
        raise MetadataError("Invalid categories")
    ids, maps = set(), {"ja": {}, "en": {}}
    for category in categories:
        keys(category, ("id", "ja", "en"), ("aliases_ja", "aliases_en"))
        cid = category["id"]
        if not valid_id(cid) or cid in ids:
            raise MetadataError("Invalid category id")
        ids.add(cid)
        for lang in ("ja", "en"):
            aliases = category.get("aliases_" + lang, [])
            if not isinstance(aliases, list):
                raise MetadataError("Invalid aliases")
            for name in [category[lang], *aliases]:
                if not text(name) or name in maps[lang]:
                    raise MetadataError("Invalid or duplicate category label")
                maps[lang][name] = cid
    return ids, maps


def validate_groups(data, categories):
    ids, maps = validate_categories(categories)
    keys(data, ("schema_version", "groups", "category_descriptions", "ignored_raw_names"))
    if isinstance(data["schema_version"], bool) or not isinstance(data["schema_version"], (int, float)) or data["schema_version"] != 1 or not isinstance(data["groups"], list) or not data["groups"] or not isinstance(data["category_descriptions"], list) or not isinstance(data["ignored_raw_names"], list):
        raise MetadataError("Invalid field metadata")
    group_ids, members, descriptions = set(), set(), set()
    ignored = {"ja": set(), "en": set()}
    for group in data["groups"]:
        keys(group, ("id", "ja", "en", "description_ja", "description_en", "category_ids"))
        gid = group["id"]
        if not valid_id(gid) or gid in group_ids or not all(text(group[k]) for k in ("ja", "en", "description_ja", "description_en")) or not isinstance(group["category_ids"], list) or not group["category_ids"]:
            raise MetadataError("Invalid field")
        group_ids.add(gid)
        for cid in group["category_ids"]:
            if not isinstance(cid, str) or cid not in ids or cid in members:
                raise MetadataError("Unknown or repeated field category")
            members.add(cid)
    for description in data["category_descriptions"]:
        keys(description, ("category_id", "ja", "en"))
        cid = description["category_id"]
        if not isinstance(cid, str) or cid not in ids or cid in descriptions or not all(text(description[k]) for k in ("ja", "en")):
            raise MetadataError("Invalid category description")
        descriptions.add(cid)
    for pair in data["ignored_raw_names"]:
        keys(pair, ("lang", "name"))
        lang, name = pair["lang"], pair["name"]
        if lang not in ("ja", "en") or not text(name) or name in ignored[lang] or name in maps[lang]:
            raise MetadataError("Invalid ignored category name")
        ignored[lang].add(name)
    return ignored
