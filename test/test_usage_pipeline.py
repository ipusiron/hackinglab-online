"""README usage lifecycle tests. All HTTP requests are mocked."""
import contextlib
import copy
import datetime as dt
from http.client import IncompleteRead
import io
from pathlib import Path
import sys
import unittest
from unittest import mock
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import readme_usage as usage
import update_tools as catalog
import test_update_tools as fixtures
Response, tool, readme, NOW = fixtures.Response, fixtures.tool, fixtures.readme, fixtures.NOW


class UsageLifecycleTests(unittest.TestCase):
    setUp = fixtures.RegenerationTests.setUp
    write = fixtures.RegenerationTests.write
    install = fixtures.RegenerationTests.install
    outputs = fixtures.RegenerationTests.outputs
    data = fixtures.RegenerationTests.data
    append_repo = fixtures.RegenerationTests.append_repo

    def fetcher(self, routes):
        def request(req, *, timeout):
            self.assertEqual(req.get_method(), "GET")
            self.assertGreater(timeout, 0)
            key = req.full_url.removeprefix("https://raw.githubusercontent.com/")
            self.assertIn(key, routes, "Unexpected request: " + key)
            value = routes[key]
            if isinstance(value, int):
                raise HTTPError(req.full_url, value, "fixture", {}, None)
            if isinstance(value, Exception):
                raise value
            return Response(req.full_url, value)
        return request

    def run_catalog(self, routes, **kwargs):
        with mock.patch.object(catalog, "urlopen", side_effect=self.fetcher(routes)) as http, contextlib.redirect_stderr(io.StringIO()):
            result = catalog.regenerate(self.root, now=kwargs.pop("now", NOW), **kwargs)
        return result, [call.args[0].full_url.removeprefix("https://raw.githubusercontent.com/") for call in http.call_args_list]

    def old_headings(self):
        value = tool()
        value["readme_usage"] = {"ja": {"status": "heading", "fragment": "old-ja"}, "en": {"status": "heading", "fragment": "old-en"}}
        self.install([value])
        return value

    def test_success_replaces_stale_headings_and_ignores_yaml_override(self):
        previous = self.old_headings()
        body = readme(previous).replace("hub: true", "hub: true\nreadme_usage:\n  ja:\n    status: heading\n    fragment: forged")
        result, requests = self.run_catalog({"example/one/main/README.md": body, "example/one/main/README.en.md": "# Plain documentation\n"})
        self.assertEqual(self.data()["tools"][0]["readme_usage"], {"ja": {"status": "top"}, "en": {"status": "top"}})
        self.assertTrue(result.changed)
        self.assertEqual(len(requests), 2)

    def test_successful_heading_regeneration_is_semantically_stable(self):
        routes = {"example/one/main/README.md": readme(tool()) + "## 🛠️ 使い方\n", "example/one/main/README.en.md": "## Usage\n"}
        self.run_catalog(routes)
        before = self.outputs()
        result, _ = self.run_catalog(routes, now=NOW + dt.timedelta(hours=1))
        self.assertFalse(result.changed)
        self.assertEqual(self.outputs(), before)
        self.assertEqual(self.data()["tools"][0]["readme_usage"]["ja"]["fragment"], "\ufe0f-使い方")

    def test_english_only_both_404_are_confirmed_missing(self):
        for master in [404, "## How to use\n"]:
            with self.subTest(master=master):
                self.old_headings()
                report, requests = self.run_catalog({"example/one/main/README.md": readme(tool()), "example/one/main/README.en.md": 404, "example/one/master/README.en.md": master})
                expected = {"status": "missing"} if master == 404 else {"status": "heading", "fragment": "how-to-use"}
                self.assertEqual(self.data()["tools"][0]["readme_usage"]["en"], expected)
                self.assertEqual(len(report.usage_missing), int(master == 404))
                self.assertEqual(requests, ["example/one/main/README.md", "example/one/main/README.en.md", "example/one/master/README.en.md"])

    def test_english_transient_failure_preserves_only_valid_prior_language(self):
        for error in [503, URLError("timeout"), IncompleteRead(b"partial", 100)]:
            for prior in [{"status": "heading", "fragment": "old-en"}, None, {"status": "heading", "fragment": "https://evil.example"}]:
                with self.subTest(error=error, prior=prior):
                    old = self.old_headings()
                    if prior is None: del old["readme_usage"]["en"]
                    else: old["readme_usage"]["en"] = prior
                    self.install([old])
                    report, requests = self.run_catalog({"example/one/main/README.md": readme(tool()) + "## 使い方\n", "example/one/main/README.en.md": error})
                    current = self.data()["tools"][0]["readme_usage"]
                    self.assertEqual(current["ja"], {"status": "heading", "fragment": "使い方"})
                    self.assertEqual(current.get("en"), prior if usage.valid_entry(prior) else None)
                    self.assertEqual(len(report.usage_retained), 1)
                    self.assertEqual(len(requests), 2)

    def test_ja_failure_retains_whole_old_tool_and_never_fetches_english(self):
        for body in [503, URLError("timeout"), IncompleteRead(b"partial", 50), "invalid metadata"]:
            with self.subTest(body=body):
                self.old_headings()
                before = self.outputs()
                report, requests = self.run_catalog({"example/one/main/README.md": body})
                self.assertEqual(requests, ["example/one/main/README.md"])
                self.assertEqual(self.outputs(), before)
                self.assertFalse(report.changed)

    def test_401_at_each_language_branch_stops_all_outputs_and_later_fetches(self):
        for language in ["README.md", "README.en.md"]:
            for branch in ["main", "master"]:
                with self.subTest(language=language, branch=branch):
                    self.install([tool(), tool("day002", "two"), tool("day003", "three")])
                    before = self.outputs()
                    summary = self.root / "summary.md"
                    summary.write_text("keep\n", encoding="utf-8")
                    routes = {"example/one/main/README.md": readme(tool()) + "## 使い方\n", "example/one/main/README.en.md": "## Usage\n"}
                    if language == "README.en.md": routes["example/two/main/README.md"] = readme(tool("day002", "two"))
                    if branch == "master": routes[f"example/two/main/{language}"] = 404
                    routes[f"example/two/{branch}/{language}"] = 401
                    with mock.patch.object(catalog, "urlopen", side_effect=self.fetcher(routes)) as http, contextlib.redirect_stderr(io.StringIO()):
                        code = catalog.main(["--root", str(self.root), "--summary", str(summary)])
                    self.assertEqual(code, 2)
                    requests = [call.args[0].full_url for call in http.call_args_list]
                    self.assertTrue(requests[-1].endswith(f"/two/{branch}/{language}"))
                    self.assertEqual(len(requests), len(routes))
                    self.assertEqual(self.outputs(), before)
                    self.assertEqual(summary.read_text(encoding="utf-8"), "keep\n")

    def test_fragment_validation_and_recovery_do_not_accept_destinations(self):
        for fragment in ["-使い方", "usage-1", "\ufe0f-使い方", "x\u200dy", "e\u0301", "𐐀", "a" * 512]:
            self.assertTrue(usage.valid_entry({"status": "heading", "fragment": fragment}))
        for value in [None, [], {}, {"status": "url", "href": "https://evil.example"}, {"status": "top", "fragment": "x"},
                      *({"status": "heading", "fragment": value} for value in ["", "%E4%BD%BF", "a/b", "x?y", "#usage", "a b", "x\n", "a" * 513])]:
            self.assertFalse(usage.valid_entry(value), value)
        self.assertIsNone(usage.previous_entry({"en": {"status": "heading", "fragment": "%20"}}, "en"))

    def test_unknown_unicode_before_and_after_candidate_is_conservative_without_version_assumption(self):
        original = usage.unicodedata.category
        def category(char):
            return "Cn" if char == "\U0001faaa" else original(char)
        with mock.patch.object(usage.unicodedata, "category", side_effect=category):
            before = usage.extract_usage("## \U0001faaa\n## Usage\n", "en")
            after = usage.extract_usage("## Usage\n## \U0001faaa\n", "en")
        self.assertEqual(before["metadata"], {"status": "top"})
        self.assertEqual(after["metadata"], {"status": "heading", "fragment": "usage"})
