"""Catalog generation failure and history tests; every HTTP request is mocked."""
import contextlib
import ctypes
import datetime as dt
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError, URLError
from http.client import BadStatusLine, IncompleteRead
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import update_tools as catalog
import init_added
import yaml

NOW = dt.datetime(2026, 11, 19, 15, 1, tzinfo=dt.timezone.utc)
DATE = "2026-01-01"
CATEGORIES = [
    {"id": "z-first", "ja": "最初", "en": "First", "aliases_ja": ["別名"]},
    {"id": "a-second", "ja": "次", "en": "Second"},
]


def tool(tid="day001", repo="one", *, visible=True, added=DATE):
    value = {
        "id": tid, "slug": repo, "title": repo.title(),
        "subtitle_ja": "", "subtitle_en": "", "description_ja": "", "description_en": "",
        "category_ja": ["最初"], "category_en": ["First"], "category_ids": ["z-first"],
        "difficulty": 2, "tags": [], "repo_url": "https://github.com/example/" + repo,
        "demo_url": "https://example.github.io/" + repo + "/", "hub": visible,
        "readme_usage": {"ja": {"status": "top"}, "en": {"status": "top"}},
    }
    if added is not None:
        value["added"] = added
    return value


def readme(value):
    value = {key: val for key, val in value.items() if key not in ("category_ids", "added", "readme_usage")}
    return "<!--\n---\n" + yaml.safe_dump(value, allow_unicode=True) + "---\n-->\n"


class Response:
    status = 200

    def __init__(self, url, body="", status=200):
        self.url, self.body, self.status = url, body, status

    def geturl(self):
        return self.url

    def read(self):
        return self.body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class RegenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "data").mkdir()
        self.write("data/categories.json", CATEGORIES)
        self.write("data/category_groups.json", {"schema_version": 1, "groups": [{"id": "example", "ja": "例", "en": "Example", "description_ja": "説明", "description_en": "Description", "category_ids": ["z-first", "a-second"]}], "category_descriptions": [], "ignored_raw_names": []})
        self.install([tool()])

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def install(self, values):
        self.values = values
        self.write("data/tools.json", {"schema_version": 1, "generated_at": "2026-01-01T00:00:00Z", "tools": values})
        self.write("data/added.json", {value["id"]: value["added"] for value in values if "added" in value})
        (self.root / "repos.txt").write_text("\n".join(value["repo_url"] for value in values) + "\n", encoding="utf-8")

    def outputs(self):
        return {name: (self.root / name).read_bytes() for name in ("data/tools.json", "data/added.json")}

    def data(self, name="tools"):
        return json.loads((self.root / ("data/" + name + ".json")).read_text(encoding="utf-8"))

    def serve(self, values=None):
        entries = self.values if values is None else values
        lookup = {catalog.repo_key(entry["repo_url"]): readme(entry) for entry in entries}

        def request(req, *, timeout):
            self.assertGreater(timeout, 0)
            self.assertEqual(req.get_method(), "GET")
            for repo, body in lookup.items():
                if req.full_url == f"https://raw.githubusercontent.com/{repo}/main/README.md":
                    return Response(req.full_url, body)
                if req.full_url == f"https://raw.githubusercontent.com/{repo}/main/README.en.md":
                    return Response(req.full_url, "# Tool documentation\n")
            raise AssertionError("Unexpected request: " + req.full_url)
        return request

    def regenerate(self, side_effect=None, **kwargs):
        with mock.patch.object(catalog, "urlopen", side_effect=side_effect or self.serve()) as http, contextlib.redirect_stderr(io.StringIO()):
            report = catalog.regenerate(self.root, now=NOW, **kwargs)
        return report, http

    def append_repo(self, repo):
        with (self.root / "repos.txt").open("a", encoding="utf-8") as stream:
            stream.write("https://github.com/example/" + repo + "\n")

    def test_replace_failure_restores_original_pair_and_retry_succeeds(self):
        new = tool("day002", "two", added=None)
        for failed_call in (1, 2):
            with self.subTest(failed_replace=failed_call):
                self.install([tool()])
                self.append_repo("two")
                before = self.outputs()
                real_replace = catalog.os.replace
                count = 0
                def replace(source, target):
                    nonlocal count
                    count += 1
                    if count == failed_call:
                        raise PermissionError("injected replacement failure")
                    return real_replace(source, target)
                with mock.patch.object(catalog.os, "replace", side_effect=replace), self.assertRaises(PermissionError):
                    self.regenerate(self.serve([tool(), new]))
                self.assertEqual(self.outputs(), before)
                self.assertEqual(list((self.root / "data").glob(".*")), [])
                self.regenerate(self.serve([tool(), new]))
                self.assertEqual([entry["id"] for entry in self.data()["tools"]], ["day001", "day002"])
                self.assertEqual(self.data("added")["day002"], NOW.astimezone(catalog.JST).date().isoformat())

    def test_rollback_failure_preserves_original_copies_and_reports_recovery(self):
        new = tool("day002", "two", added=None)
        self.append_repo("two")
        before = self.outputs()
        real_replace = catalog.os.replace
        count = 0
        def replace(source, target):
            nonlocal count
            count += 1
            if count >= 2:
                raise PermissionError("injected write and rollback failure")
            return real_replace(source, target)
        with mock.patch.object(catalog.os, "replace", side_effect=replace), self.assertRaises(catalog.CatalogRecoveryError) as caught:
            self.regenerate(self.serve([tool(), new]))
        self.assertNotEqual(self.outputs(), before)
        recovered = {}
        for relative, original in before.items():
            target = self.root / relative
            backups = list(target.parent.glob("." + target.name + ".recovery-*"))
            self.assertEqual(len(backups), 1)
            backup = backups[0]
            self.assertEqual(backup.read_bytes(), original)
            self.assertIn(str(target), str(caught.exception))
            self.assertIn(str(backup), str(caught.exception))
            recovered[target] = backup
        # The reported materials really restore the complete previous state.
        for target, backup in recovered.items():
            target.write_bytes(backup.read_bytes())
        self.assertEqual(self.outputs(), before)
        self.regenerate(self.serve([tool(), new]))
        self.assertEqual(len(self.data()["tools"]), 2)

    @unittest.skipUnless(sys.platform == "win32", "Windows file sharing lock")
    def test_windows_added_file_lock_rolls_back_and_unlock_allows_regeneration(self):
        new = tool("day002", "two", added=None)
        self.append_repo("two")
        before = self.outputs()
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
                                      ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
        kernel.CreateFileW.restype = ctypes.c_void_p
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        # Permit reading/writing, but deny delete/replace on added.json only.
        handle = kernel.CreateFileW(str(self.root / "data/added.json"), 0x80000000, 3, None, 3, 0x80, None)
        if handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            with self.assertRaises(PermissionError):
                self.regenerate(self.serve([tool(), new]))
            self.assertEqual(self.outputs(), before)
            self.assertEqual(list((self.root / "data").glob(".*")), [])
        finally:
            kernel.CloseHandle(handle)
        self.regenerate(self.serve([tool(), new]))
        self.assertEqual(len(self.data()["tools"]), 2)
        self.assertEqual(self.data("added")["day002"], NOW.astimezone(catalog.JST).date().isoformat())

    def test_same_content_keeps_bytes_and_generation_timestamp(self):
        before = self.outputs()
        report, _ = self.regenerate()
        self.assertFalse(report.changed)
        self.assertEqual(self.outputs(), before)
        self.assertEqual(report.added, [])
        summary = report.markdown()
        counts = summary.split("<details>", 1)[0]
        self.assertIn("unchanged (generation timestamp preserved)", counts)
        for label in ("Previous metadata retained", "Repositories added to catalog",
                      "Repositories removed from repos.txt", "Unknown category names",
                      "Tools without a mapped category", "Unknown difficulty (stored as null)",
                      "Slug changes", "Usage metadata retained or unavailable", "Confirmed missing README files"):
            self.assertIn("| " + label + " | 0 |", counts)
        self.assertIn("| Demo GET checks | Not run |", counts)
        self.assertEqual(summary.count("<details>"), 10)
        self.assertEqual(summary.count("</details>"), 10)
        self.assertNotIn("<details open", summary)
        self.assertIn("<summary>Repositories added to catalog (0 rows)</summary>\n\n| Repository | Tool |", summary)
        self.assertIn("| None | — |", summary)
        self.assertIn("| Not run | — | — |", summary)

    def test_only_real_metadata_change_updates_generation_time(self):
        changed = tool()
        changed["description_ja"] = "新しい説明"
        self.regenerate(self.serve([changed]))
        self.assertEqual(self.data()["generated_at"], "2026-11-19T15:01:00Z")
        self.assertEqual(self.data()["tools"][0]["description_ja"], "新しい説明")
        self.assertEqual(self.data("added"), {"day001": DATE})

    def test_timeout_keeps_existing_but_does_not_block_a_valid_new_repo(self):
        self.append_repo("two")
        new = tool("day002", "two", added=None)
        serve = self.serve([new])

        def request(req, **kwargs):
            if "/one/" in req.full_url:
                raise TimeoutError("test timeout")
            return serve(req, **kwargs)
        report, http = self.regenerate(request)
        self.assertEqual(http.call_count, 3)
        self.assertEqual(report.retained[0][0], "example/one")
        self.assertEqual(report.added, [("example/two", "day002")])
        self.assertEqual([value["id"] for value in self.data()["tools"]], ["day001", "day002"])
        self.assertEqual(self.data("added"), {"day001": DATE, "day002": "2026-11-20"})

    def test_summary_distinguishes_added_removed_and_retained_repositories(self):
        self.install([tool(), tool("day002", "two")])
        # A repository replacement can reuse a Day ID; count repositories, not new IDs.
        replacement = tool("day002", "replacement", added=None)
        hidden = tool("day003", "hidden", visible=False, added=None)
        (self.root / "repos.txt").write_text("\n".join(value["repo_url"] for value in (tool(), replacement, hidden)) + "\n", encoding="utf-8")
        serve = self.serve([replacement, hidden])

        def request(req, **kwargs):
            if "/one/" in req.full_url:
                raise TimeoutError("offline")
            return serve(req, **kwargs)

        report, http = self.regenerate(request)
        self.assertEqual(http.call_count, 5)
        self.assertEqual(report.added, [("example/replacement", "day002"), ("example/hidden", "day003")])
        self.assertEqual(report.removed, [("example/two", "day002")])
        self.assertEqual(report.retained, [("example/one", "README read failed: TimeoutError")])
        self.assertEqual(self.data()["tools"][0], tool())
        self.assertFalse(self.data()["tools"][2]["hub"])
        self.assertEqual(self.data("added"), {"day001": DATE, "day002": DATE})
        summary = report.markdown()
        counts = summary.split("<details>", 1)[0]
        self.assertIn("Tools: **3**; visible: **2**; hidden: **1**.", counts)
        self.assertIn("| Previous metadata retained | 1 | of 3 current repositories |", counts)
        self.assertIn("| Repositories added to catalog | 2 | repositories absent from the previous catalog |", counts)
        self.assertIn("| Repositories removed from repos.txt | 1 | of 2 previous repositories |", counts)
        self.assertIn("| Slug changes | 0 | of 1 repositories present in both catalogs |", counts)
        self.assertIn("repository-language pairs; 2 English README files checked", counts)
        self.assertIn("| example/replacement | day002 |", summary)
        self.assertIn("| example/two | day002 |", summary)
        self.assertIn("| example/hidden | day003 |", summary)

    def test_read_interrupted_keeps_existing_and_adds_next_valid_repo(self):
        self.append_repo("two")
        new = tool("day002", "two", added=None)
        serve = self.serve([new])

        class InterruptedResponse(Response):
            def read(self):
                raise IncompleteRead(b"partial body", 100)

        def request(req, **kwargs):
            if "/one/" in req.full_url:
                return InterruptedResponse(req.full_url)
            return serve(req, **kwargs)

        report, http = self.regenerate(request)
        self.assertEqual(http.call_count, 3)
        self.assertEqual(report.retained, [("example/one", "README read failed: IncompleteRead")])
        self.assertEqual(self.data()["tools"][0], tool())
        self.assertEqual([entry["id"] for entry in self.data()["tools"]], ["day001", "day002"])
        self.assertEqual(self.data("added"), {"day001": DATE, "day002": "2026-11-20"})

    def test_only_404_tries_master(self):
        def request(req, **kwargs):
            if "/main/" in req.full_url:
                raise HTTPError(req.full_url, 404, "Not found", {}, None)
            return Response(req.full_url, readme(tool()))
        report, http = self.regenerate(request)
        self.assertFalse(report.changed)
        self.assertEqual(http.call_count, 4)
        self.assertIn("/master/", http.call_args.args[0].full_url)

    def test_server_error_does_not_try_another_branch(self):
        before = self.outputs()
        report, http = self.regenerate(HTTPError("https://example.com", 503, "Unavailable", {}, None))
        self.assertEqual(http.call_count, 1)
        self.assertEqual(self.outputs(), before)
        self.assertEqual(len(report.retained), 1)

    def test_both_404_keep_previous(self):
        before = self.outputs()
        report, http = self.regenerate(HTTPError("https://example.com", 404, "Not found", {}, None))
        self.assertEqual(http.call_count, 2)
        self.assertEqual(self.outputs(), before)
        self.assertEqual(len(report.retained), 1)

    def test_malformed_existing_readme_retains_valid_previous(self):
        before = self.outputs()
        for body in ("no metadata", "<!--\n---\nid: [\n---\n-->", "<!--\n---\n- a\n---\n-->"):
            with self.subTest(body=body):
                report, _ = self.regenerate(lambda req, **kwargs: Response(req.full_url, body))
                self.assertEqual(self.outputs(), before)
                self.assertEqual(len(report.retained), 1)

    def test_new_invalid_metadata_is_fatal_and_writes_nothing(self):
        self.append_repo("two")
        before = self.outputs()
        new = tool("day002", "two", added=None)
        good = self.serve()
        for body in ("bad metadata", readme({**new, "id": ""}), readme({**new, "hub": "false"})):
            def request(req, **kwargs):
                if "/two/" in req.full_url:
                    return Response(req.full_url, body)
                return good(req, **kwargs)
            with self.subTest(body=body), self.assertRaises(catalog.CatalogError):
                self.regenerate(request)
            self.assertEqual(self.outputs(), before)

    def test_new_unavailable_repo_is_fatal(self):
        self.append_repo("two")
        before = self.outputs()
        good = self.serve()

        def request(req, **kwargs):
            if "/two/" in req.full_url:
                raise URLError("offline")
            return good(req, **kwargs)
        with self.assertRaises(catalog.CatalogError):
            self.regenerate(request)
        self.assertEqual(self.outputs(), before)

    def test_main_401_stops_before_next_request_and_preserves_summary(self):
        self.append_repo("two")
        summary = self.root / "summary.md"
        summary.write_text("previous\n", encoding="utf-8")
        before = self.outputs()
        with mock.patch.object(catalog, "urlopen", side_effect=HTTPError("https://example.com", 401, "Unauthorized", {}, None)) as http:
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                result = catalog.main(["--root", str(self.root), "--summary", str(summary), "--check-demos"])
        self.assertEqual(result, 2)
        self.assertEqual(http.call_count, 1)
        self.assertEqual(self.outputs(), before)
        self.assertEqual(summary.read_text(encoding="utf-8"), "previous\n")

    def test_master_401_is_fatal_and_preserves_files(self):
        before = self.outputs()
        def request(req, **kwargs):
            raise HTTPError(req.full_url, 404 if "/main/" in req.full_url else 401, "Error", {}, None)
        with self.assertRaises(catalog.UnauthorizedError):
            self.regenerate(request)
        self.assertEqual(self.outputs(), before)

    def test_demo_get_401_stops_before_any_output(self):
        changed = {**tool(), "description_en": "changed"}
        good = self.serve([changed])
        before = self.outputs()
        def request(req, **kwargs):
            if req.full_url.startswith("https://example.github.io"):
                self.assertEqual(req.get_method(), "GET")
                raise HTTPError(req.full_url, 401, "Unauthorized", {}, None)
            return good(req, **kwargs)
        with self.assertRaises(catalog.UnauthorizedError):
            self.regenerate(request, check_demos=True)
        self.assertEqual(self.outputs(), before)

    def test_demo_404_is_reported_and_uses_get(self):
        good = self.serve()
        def request(req, **kwargs):
            if req.full_url.startswith("https://example.github.io"):
                self.assertEqual(req.get_method(), "GET")
                raise HTTPError(req.full_url, 404, "Not found", {}, None)
            return good(req, **kwargs)
        report, _ = self.regenerate(request, check_demos=True)
        self.assertEqual(report.demos[0][2], "HTTP 404")

    def test_demo_connection_protocol_error_is_reported(self):
        serve = self.serve()
        before = self.outputs()
        for failure in (BadStatusLine("incomplete status"), IncompleteRead(b"partial header", 10)):
            def request(req, **kwargs):
                if req.full_url.startswith("https://example.github.io"):
                    self.assertEqual(req.get_method(), "GET")
                    raise failure
                return serve(req, **kwargs)

            with self.subTest(failure=type(failure).__name__):
                report, _ = self.regenerate(request, check_demos=True)
                self.assertEqual(report.demos[0][2], type(failure).__name__)
                self.assertEqual(self.outputs(), before)

    def test_explicit_repo_removal_does_not_restore_old_tool_or_remove_date(self):
        self.install([tool(), tool("day002", "two")])
        (self.root / "repos.txt").write_text("https://github.com/example/one\n", encoding="utf-8")
        report, http = self.regenerate()
        self.assertEqual(http.call_count, 2)
        self.assertEqual([value["id"] for value in self.data()["tools"]], ["day001"])
        self.assertEqual(self.data("added"), {"day001": DATE, "day002": DATE})
        self.assertEqual(report.removed, [("example/two", "day002")])

    def test_explicit_hub_false_then_true_keeps_initial_date(self):
        report, _ = self.regenerate(self.serve([tool(visible=False)]))
        self.assertEqual(report.added, [])
        self.assertFalse(self.data()["tools"][0]["hub"])
        self.assertEqual(self.data("added")["day001"], DATE)
        report, _ = self.regenerate(self.serve([tool()]))
        self.assertEqual(report.added, [])
        self.assertTrue(self.data()["tools"][0]["hub"])
        self.assertEqual(self.data("added")["day001"], DATE)

    def test_never_visible_tool_gets_date_only_when_first_visible(self):
        self.install([tool(visible=False, added=None)])
        self.regenerate()
        self.assertEqual(self.data("added"), {})
        self.assertNotIn("added", self.data()["tools"][0])
        self.regenerate(self.serve([tool(added=None)]))
        self.assertEqual(self.data("added"), {"day001": "2026-11-20"})

    def test_readded_tool_reuses_retained_history(self):
        self.write("data/added.json", {"day001": DATE, "day002": "2025-12-25"})
        self.append_repo("two")
        self.regenerate(self.serve([tool(), tool("day002", "two", added=None)]))
        self.assertEqual(self.data("added")["day002"], "2025-12-25")

    def test_duplicate_candidate_id_or_slug_is_fatal(self):
        self.append_repo("two")
        before = self.outputs()
        for new in (tool("day001", "two"), {**tool("day002", "two"), "slug": "one"}):
            with self.subTest(new=new), self.assertRaises(catalog.CatalogError):
                self.regenerate(self.serve([tool(), new]))
            self.assertEqual(self.outputs(), before)

    def test_unsafe_url_never_falls_back_or_gets_fetched(self):
        before = self.outputs()
        for url in ("javascript:alert(1)", "http://example.com/", "https://user:pass@example.com/", "https://example.com/\n"):
            with self.subTest(url=url), self.assertRaises(catalog.CatalogError):
                self.regenerate(self.serve([{**tool(), "demo_url": url}]), check_demos=True)
            self.assertEqual(self.outputs(), before)

    def test_category_order_and_unknown_and_difficulty_are_reported(self):
        changed = {**tool(), "category_ja": ["最初", "別名", "未知"], "category_en": ["Second", "First"], "difficulty": "2"}
        report, _ = self.regenerate(self.serve([changed]))
        entry = self.data()["tools"][0]
        self.assertEqual(entry["category_ids"], ["z-first", "a-second"])
        self.assertIsNone(entry["difficulty"])
        self.assertEqual(report.unknown, {("ja", "未知"): {"day001"}})
        self.assertEqual(report.difficulty, ["day001"])

    def test_missing_categories_warn_but_do_not_drop_tool(self):
        changed = {**tool(), "category_ja": ["未知"], "category_en": []}
        report, _ = self.regenerate(self.serve([changed]))
        self.assertEqual(report.empty_categories, ["day001"])
        self.assertEqual(self.data()["tools"][0]["category_ids"], [])

    def test_slug_change_is_reported(self):
        report, _ = self.regenerate(self.serve([{**tool(), "slug": "renamed"}]))
        self.assertEqual(report.slug_changes, [("day001", "one", "renamed")])
        self.assertIn("| Slug changes | 1 | of 1 repositories present in both catalogs |", report.markdown())

    def test_summary_aggregates_many_warnings_and_escapes_detail_cells(self):
        values = [tool(f"day{number:03d}", f"tool-{number}", visible=number % 2 == 0)
                  for number in range(1, 41)]
        self.install(values)
        raw_name = "<details open>\\|[click](https://example.invalid/)\n`code` *bold* ~~raw~~"
        changed = [{**value, "category_ja": [raw_name, raw_name], "category_en": ["Unmapped"], "difficulty": None}
                   for value in values]
        report, http = self.regenerate(self.serve(changed))
        self.assertEqual(http.call_count, 80)
        self.assertEqual(len(self.data()["tools"]), 40)
        self.assertEqual(report.unknown, {("ja", raw_name): {value["id"] for value in values},
                                          ("en", "Unmapped"): {value["id"] for value in values}})
        summary = report.markdown()
        counts = summary.split("<details>", 1)[0]
        self.assertIn("Tools: **40**; visible: **20**; hidden: **20**.", counts)
        self.assertIn("| Unknown category names | 2 | distinct (language, name) pairs affecting 40 of 40 tools |", counts)
        self.assertIn("| Tools without a mapped category | 40 | of 40 tools |", counts)
        self.assertIn("| Unknown difficulty (stored as null) | 40 | of 40 tools |", counts)
        self.assertNotIn(raw_name, summary)
        self.assertNotIn("<details open>", summary)
        self.assertIn(r"&lt;details open&gt;\\\|\[click\](https://example.invalid/) \`code\` \*bold\* \~\~raw\~\~", summary)
        self.assertIn("<summary>Unknown category names (2 rows)</summary>", summary)
        self.assertIn("<summary>Tools without a mapped category (40 rows)</summary>", summary)
        self.assertIn(", ".join(value["id"] for value in values), summary)
        self.assertEqual(summary.count("</details>"), 10)

    def test_summary_counts_usage_failures_and_demo_results_with_explicit_units(self):
        values = [tool(f"day{number:03d}", f"tool-{number}") for number in range(1, 6)]
        values[2]["readme_usage"] = {"ja": {"status": "top"}}
        values[3]["demo_url"] = ""
        self.install(values)
        serve = self.serve()

        def request(req, **kwargs):
            if req.full_url.startswith("https://example.github.io/"):
                self.assertEqual(req.get_method(), "GET")
                if "/tool-2/" in req.full_url:
                    raise HTTPError(req.full_url, 404, "Not found", {}, None)
                if "/tool-3/" in req.full_url:
                    raise URLError("offline")
                return Response(req.full_url, status=204)
            if req.full_url.endswith("README.en.md"):
                if "/tool-2/" in req.full_url:
                    raise HTTPError(req.full_url, 404, "Not found", {}, None)
                if "/tool-1/" in req.full_url or "/tool-3/" in req.full_url:
                    raise TimeoutError("offline")
            return serve(req, **kwargs)

        report, http = self.regenerate(request, check_demos=True)
        self.assertEqual(http.call_count, 15)
        self.assertEqual(len(report.usage_retained), 2)
        self.assertEqual(report.usage_missing, [("example/tool-2", "en")])
        self.assertEqual(self.data()["tools"][0]["readme_usage"]["en"], {"status": "top"})
        self.assertNotIn("en", self.data()["tools"][2]["readme_usage"])
        counts = report.markdown().split("<details>", 1)[0]
        for row in (
            "| Usage metadata retained or unavailable | 2 | repository-language pairs; 5 English README files checked |",
            "| Confirmed missing README files | 1 | repository-language pairs; 5 English README files checked |",
            "| Demo GET checks | 4 | of 5 tools; tools without a URL are not requested |",
            "| Demo HTTP 2xx | 2 | of 4 checked demo URLs |",
            "| Demo non-2xx or read failures | 2 | of 4 checked demo URLs |",
            "| Tools without a demo URL | 1 | of 5 tools |",
        ):
            self.assertIn(row, counts)
        self.assertIn("<summary>Demo GET results (5 rows)</summary>", report.markdown())

    def test_demo_checks_without_urls_are_distinct_from_checks_not_run(self):
        self.install([{**tool(), "demo_url": ""}])
        before = self.outputs()
        report, http = self.regenerate(check_demos=True)
        self.assertEqual(http.call_count, 2)
        self.assertEqual(self.outputs(), before)
        counts = report.markdown().split("<details>", 1)[0]
        self.assertIn("| Demo GET checks | 0 | of 1 tools; tools without a URL are not requested |", counts)
        self.assertIn("| Demo HTTP 2xx | 0 | of 0 checked demo URLs |", counts)
        self.assertIn("| Tools without a demo URL | 1 | of 1 tools |", counts)
        self.assertNotIn("Not run", report.markdown())

    def test_missing_broken_future_or_changed_added_stops_before_network(self):
        path = self.root / "data/added.json"
        for text in (None, "broken", "{}", '{"day001":"2099-01-01"}', '{"day001":"2026-01-02"}', '{"day001":"2026-02-30"}'):
            if text is None:
                path.unlink(missing_ok=True)
            else:
                path.write_text(text, encoding="utf-8")
            with self.subTest(text=text), mock.patch.object(catalog, "urlopen") as http:
                with self.assertRaises(catalog.CatalogError):
                    catalog.regenerate(self.root, now=NOW)
                http.assert_not_called()
            if text is not None:
                self.assertEqual(path.read_text(encoding="utf-8"), text)

    def test_invalid_previous_metadata_or_duplicate_repos_stops_before_network(self):
        self.append_repo("one")
        before = self.outputs()
        with mock.patch.object(catalog, "urlopen") as http, self.assertRaises(catalog.CatalogError):
            catalog.regenerate(self.root, now=NOW)
        http.assert_not_called()
        self.assertEqual(self.outputs(), before)

    def test_summary_escapes_untrusted_cells(self):
        report = catalog.Report()
        report.unknown[("ja", "<script>|\nname")] = {"day001"}
        text = report.markdown()
        self.assertNotIn("<script>", text)
        self.assertIn("&lt;script&gt;\\| name", text)
        self.assertIn("does not confirm a GitHub Pages deployment", text)


class FirstSeenTests(unittest.TestCase):
    def history(self):
        return {
            "aaa": {"generated_at": "2026-10-15T15:38:40Z", "tools": [tool(), tool("day114", "hidden", visible=False, added=None)]},
            "bbb": {"generated_at": "2026-10-15T15:56:34Z", "tools": [tool("day114", "hidden", added=None)]},
            "ccc": {"generated_at": "2026-10-31T17:00:03Z", "tools": [tool(), tool("day114", "hidden", added=None), tool("day127", "new", added=None)]},
        }

    def git_stub(self, history=None, shallow=False):
        history = self.history() if history is None else history
        def git(root, *args):
            if args == ("rev-parse", "--is-shallow-repository"):
                return "true\n" if shallow else "false\n"
            if args[:2] == ("rev-parse", "--verify"):
                return "ccc\n"
            if args[0] == "log":
                self.assertIn("--first-parent", args)
                self.assertIn("--reverse", args)
                return "\n".join(sha + "\t2026-11-01T00:00:00+00:00" for sha in history)
            if args[0] == "show":
                return json.dumps(history[args[1].split(":")[0]])
            raise AssertionError(args)
        return git

    def test_first_visible_jst_day_and_reappearance_preserves_date(self):
        with mock.patch.object(init_added, "git", side_effect=self.git_stub()):
            added = init_added.first_seen(Path("unused"), today=dt.date(2026, 11, 20))
        self.assertEqual(added, {"day001": "2026-10-16", "day114": "2026-10-16", "day127": "2026-11-01"})

    def test_shallow_history_is_rejected(self):
        with mock.patch.object(init_added, "git", side_effect=self.git_stub(shallow=True)), self.assertRaises(catalog.CatalogError):
            init_added.first_seen(Path("unused"))

    def test_future_history_and_naive_timestamp_are_rejected(self):
        for stamp in ("2099-01-01T00:00:00Z", "2026-01-01T00:00:00"):
            history = self.history()
            history["aaa"]["generated_at"] = stamp
            with mock.patch.object(init_added, "git", side_effect=self.git_stub(history)), self.assertRaises(catalog.CatalogError):
                init_added.first_seen(Path("unused"))

    def test_initializer_never_overwrites_existing_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data").mkdir()
            (root / "data/added.json").write_text("existing history", encoding="utf-8")
            with mock.patch.object(init_added, "first_seen") as first, contextlib.redirect_stderr(io.StringIO()):
                result = init_added.main(["--root", tmp])
            self.assertEqual(result, 1)
            first.assert_not_called()
            self.assertEqual((root / "data/added.json").read_text(encoding="utf-8"), "existing history")


if __name__ == "__main__":
    unittest.main()
