import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from urllib.parse import quote
from readme_usage import extract_usage, scan_headings, allocate_slugs, visible_text


class ExtractionTests(unittest.TestCase):
    def heading(self, markdown, fragment, lang="en"):
        result = extract_usage(markdown, lang)
        self.assertEqual(result["metadata"], {"status": "heading", "fragment": fragment})
        return result

    def test_inline_code_comment_literal_does_not_change_later_duplicate(self):
        result = self.heading("## Usage`<!---->`\n## Usage", "usage")
        self.assertEqual(result["headings"][0].visible, "Usage<!---->")
        self.assertEqual(result["headings"][0].fragment, "usage----")
        self.assertEqual(result["headings"][1].fragment, "usage")

    def test_code_span_comment_openers_and_closers_are_literal(self):
        for code in ["`<!--`", "``<!-- -->``", "`-->`", "`<!---->`"]:
            with self.subTest(code=code):
                result = self.heading("## " + code + "\n## Usage", "usage")
                self.assertFalse(result["diagnostics"])
        self.assertEqual(visible_text("`<!-- -->`Usage")[0], "<!-- -->Usage")

    def test_comments_with_backticks_do_not_mask_later_comments(self):
        self.heading("<!-- ` -->\n## Usage<!-- ` -->", "usage")
        self.heading("## `<!-- literal -->` Not usage<!-- ` -->\n## Usage", "usage")

    def test_deep_link_nesting_returns_top_without_recursion_failure(self):
        label = "Usage"
        for _ in range(1100):
            label = "[" + label + "](https://x.y)"
        result = extract_usage("## " + label + "\n## Usage", "en")
        self.assertEqual(result["metadata"], {"status": "top"})
        self.assertEqual(result["reason"], "uncertain_syntax")
        self.assertIn("inline_nesting_limit", result["headings"][0].issues)
        self.assertIn("earlier_heading_slug_uncertain", result["headings"][1].issues)

    def test_saved_html_observations(self):
        for markdown, fragment in [("## 📖 Usage", "-usage"),
                                   ("## 📖 How to use it", "-how-to-use-it"),
                                   ("## 🛠️ Usage", "\ufe0f-usage")]:
            with self.subTest(markdown=markdown):
                self.heading(markdown, fragment)
        self.assertEqual(quote("\ufe0f-usage", safe=""), "%EF%B8%8F-usage")

    def test_fence_lengths_and_types_frontmatter_comment(self):
        result = self.heading('---\ntitle: Usage\n---\n<!--\n## Usage\n-->\n````md\n## Usage\n```\n<!--\n````\n~~~md\n## How to use\n~~~\n## How to use\n1. Open.', 'how-to-use')
        self.assertEqual(len(result["headings"]), 1)

    def test_comments_do_not_leak_from_fenced_code(self):
        self.heading('```\n<!--\n```\n## Usage', 'usage')

    def test_inline_comment_and_unclosed(self):
        self.heading('## <!-- decoration -->Usage', 'usage')
        self.assertEqual(extract_usage('<!--\n## Usage', 'en')["metadata"], {"status": "top"})

    def test_setext_hr_table_and_indented_code(self):
        result = self.heading('How to use\n----------\n\n---\n\n| Usage | Notes |\n| --- | --- |\n\n    ## Usage', 'how-to-use')
        self.assertEqual(len(result["headings"]), 1)

    def test_setext_multiple_paragraph_lines(self):
        heads, _, refs = scan_headings('First paragraph line\nsecond line\n---\n\n## Usage')
        allocate_slugs(heads, refs)
        self.assertEqual(heads[0].raw, 'First paragraph line\nsecond line')
        self.assertEqual(heads[0].fragment, 'first-paragraph-linesecond-line')
        self.heading('How to\nuse\n---', 'how-touse')

    def test_indented_paragraph_continuation(self):
        self.heading('How to\n    use\n---', 'how-touse')

    def test_setext_hard_break_is_conservative(self):
        for markdown in ['How to  \nuse\n---', 'How to\\\nuse\n---']:
            with self.subTest(markdown=markdown):
                result = extract_usage(markdown, 'en')
                self.assertEqual(result['metadata'], {'status': 'top'})
                self.assertEqual(result['reason'], 'uncertain_syntax')

    def test_pipe_paragraph_setext_cannot_silently_affect_duplicates(self):
        result = extract_usage('|Usage|\n---\n\n## Usage', 'en')
        self.assertEqual(result['metadata'], {'status': 'top'})
        self.assertEqual(result['reason'], 'uncertain_syntax')

    def test_observed_japanese_multiline_setext(self):
        text = '組み合わせによって0件になることもあります。\n`ext:`表記＋「公式のみ」＋「ファイル漏洩」は0件で、これは正常な動作です。\n---'
        heads, _, refs = scan_headings(text)
        allocate_slugs(heads, refs)
        self.assertEqual(len(heads), 1)
        self.assertEqual(heads[0].fragment, '組み合わせによって0件になることもありますext表記公式のみファイル漏洩は0件でこれは正常な動作です')

    def test_code_span_anchor_lookalike_is_not_html(self):
        self.heading('## Usage\n\n- `<meta name="referrer" content="no-referrer">`\n- `<a id="usage">`', 'usage')

    def test_observed_zwj_is_preserved(self):
        heads, _, refs = scan_headings('## 👨‍💻 開発者向け情報')
        allocate_slugs(heads, refs)
        self.assertEqual(heads[0].fragment, '\u200d-開発者向け情報')

    def test_invalid_reference_destination_not_accepted(self):
        result = extract_usage('## [Usage][guide]\n\n[guide]: not a valid destination', 'en')
        self.assertEqual(result['metadata'], {'status': 'top'})

    def test_atx_closing_hashes_and_escapes(self):
        result = self.heading('##Usage\n### How to use ###\n####### Usage\n\\# Usage', 'how-to-use')
        self.assertEqual(len(result["headings"]), 1)
        self.assertEqual(extract_usage('## Usage###', 'en')["metadata"], {"status": "top"})

    def test_inline_markup(self):
        for raw, visible in [('**Usage**', 'Usage'), ('_Usage_', 'Usage'), ('foo_bar', 'foo_bar'),
                             ('`Usage`', 'Usage'), ('`` `Usage` ``', '`Usage`'),
                             ('[How to use](./guide.md)', 'How to use'),
                             ('Setup &amp; operation', 'Setup & operation'),
                             ('<kbd>Usage</kbd>', 'Usage'), ('Usage\\_', 'Usage_')]:
            with self.subTest(raw=raw):
                self.assertEqual(visible_text(raw), (visible, []))
        self.heading('## **Usage**', 'usage')
        self.heading('## <kbd>Usage</kbd>', 'usage')

    def test_references_resolved_after_heading(self):
        self.heading('## [Usage][guide]\n\n[guide]: ./guide.md', 'usage')
        self.heading('## [Usage]\n\n[usage]: ./guide.md', 'usage')
        self.assertEqual(extract_usage('## [Usage][missing]', 'en')["metadata"], {"status": "top"})

    def test_link_destination_uncertainty(self):
        self.heading('## [Usage]()', 'usage')
        self.heading('## [Usage](./guide.md "Instructions")', 'usage')
        result = extract_usage('## [Usage](not a valid destination)', 'en')
        self.assertEqual(result['metadata'], {'status': 'top'})
        self.assertEqual(result['reason'], 'uncertain_syntax')

    def test_duplicate_slugs_all_headings(self):
        heads, _, refs = scan_headings('## Usage\n## Usage\n## Usage-1\n## USAGE')
        allocate_slugs(heads, refs)
        self.assertEqual([h.fragment for h in heads], ['usage', 'usage-1', 'usage-1-1', 'usage-2'])

    def test_punctuation_underscore_and_spaces_not_semantic_slug(self):
        heads, _, refs = scan_headings('## foo_bar  A:B!\n## 📖 Usage')
        allocate_slugs(heads, refs)
        self.assertEqual(heads[0].fragment, 'foo_bar--ab')
        self.assertEqual(heads[1].fragment, '-usage')

    def test_non_general_usage_names_rejected(self):
        markdown = '\n'.join('## ' + label for label in ['Usage cautions', 'Usage limits', 'Usage scenarios', 'Usage examples', 'Using Related Tools', 'Running it'])
        self.assertEqual(extract_usage(markdown, 'en')["metadata"], {"status": "top"})

    def test_general_beats_earlier_start_examples(self):
        result = self.heading('### Quick start\nStart.\n## Usage examples\nExamples.\n## Usage', 'usage')
        self.assertEqual(result["selected"].line, 5)

    def test_nested_general_heading_supported(self):
        self.heading('## Features\n### How to use\n1. Select.', 'how-to-use')

    def test_parent_start_beats_feature_subsections(self):
        self.heading('## Quick start\n### Basic usage\n1. Load.\n### Experimental usage', 'quick-start')

    def test_general_shallower_priority_then_document_order(self):
        result = self.heading('### Usage\n## How to use\n## Usage', 'how-to-use')
        self.assertEqual(result["selected"].level, 2)

    def test_mixed_and_start_families(self):
        for heading in ['Features and usage', 'Usage and fixed examples', 'Quick start', 'Getting started', 'Setup and operation']:
            with self.subTest(heading=heading):
                result = extract_usage('## ' + heading, 'en')
                self.assertEqual(result['metadata']['status'], 'heading')

    def test_japanese_semantic_and_slug_independent(self):
        self.heading('## 📖 使い方', '-使い方', 'ja')
        self.heading('## 🛠️ 使い方', '\ufe0f-使い方', 'ja')
        self.heading('## 🚀 使い方（クイックスタート）', '-使い方クイックスタート', 'ja')
        for heading in ['一般的な使い方', 'このツールならではの使い方', '使い方の例：地図画像での活用', 'インストール / 利用方法']:
            with self.subTest(heading=heading):
                self.assertEqual(extract_usage('## ' + heading, 'ja')['metadata'], {'status': 'top'})

    def test_uncertain_inline_falls_back(self):
        for prefix in ['## ![logo](./logo.svg)\n', '## ***Title***\n', '## <span id="usage">Title</span>\n']:
            with self.subTest(prefix=prefix):
                result = extract_usage(prefix + '## Usage', 'en')
                self.assertEqual(result['metadata'], {'status': 'top'})
                self.assertEqual(result['reason'], 'uncertain_syntax')

    def test_container_heading_uncertainty(self):
        for prefix in ['> ## Usage\n', '- ## Usage\n', '<h2>Usage</h2>\n\n']:
            with self.subTest(prefix=prefix):
                result = extract_usage(prefix + '## Usage', 'en')
                self.assertEqual(result['metadata'], {'status': 'top'})

    def test_list_continuation_and_custom_anchor_are_conservative(self):
        for prefix in ['- Item\n    ## Usage\n\n', '- Item\n  ## Usage\n\n', '<a id="usage"></a>\n\n']:
            with self.subTest(prefix=prefix):
                result = extract_usage(prefix + '## Usage', 'en')
                self.assertEqual(result['metadata'], {'status': 'top'})
                self.assertEqual(result['reason'], 'uncertain_syntax')

    def test_unknown_html_block_excludes_fake_heading(self):
        result = self.heading('<custom-element>\n## Not a heading\n</custom-element>\n\n## Usage', 'usage')
        self.assertEqual(len(result['headings']), 1)

    def test_uncertain_heading_without_plain_candidate_is_reported(self):
        result = extract_usage('<h2>Usage</h2>', 'en')
        self.assertEqual(result['metadata'], {'status': 'top'})
        self.assertEqual(result['reason'], 'uncertain_syntax')

    def test_html_block_content_not_mistaken_for_markdown_heading(self):
        result = self.heading('<div>\n## Not a heading\n</div>\n\n## Usage', 'usage')
        self.assertEqual(len(result['headings']), 1)

    def test_literal_script_contents_excluded(self):
        result = self.heading('<script>\n## Usage\n</script>\n\n## Usage', 'usage')
        self.assertEqual(len(result['headings']), 1)

    def test_invalid_language(self):
        with self.assertRaises(ValueError):
            extract_usage('## Usage', 'fr')

    def test_valid_no_heading_distinct_from_missing(self):
        self.assertEqual(extract_usage('An ordinary README.', 'en')['metadata'], {'status': 'top'})
        # Missing/retained states belong to a fetch lifecycle caller, not extraction.
        self.assertNotIn('missing', str(extract_usage('', 'en')['metadata']))


if __name__ == '__main__':
    unittest.main()
