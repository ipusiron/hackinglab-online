"""Shared metadata rejection matrix and generator pre-fetch protection."""
import copy
import json
import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from category_groups import validate_categories, validate_groups, MetadataError
import update_tools
import test_update_tools as fixtures

ROOT = pathlib.Path(__file__).resolve().parents[1]


class CategoryMetadataTests(unittest.TestCase):
    def test_shared_valid_and_rejection_cases(self):
        fixture = json.loads((ROOT / 'test/fixtures/category_metadata.json').read_text(encoding='utf-8'))
        for case in fixture:
            with self.subTest(case=case['name']):
                if case['valid']:
                    validate_categories(case['categories'])
                    validate_groups(case['groups'], case['categories'])
                else:
                    with self.assertRaises(MetadataError):
                        validate_groups(case['groups'], case['categories'])

    def test_published_metadata_and_exact_ignored_names(self):
        categories = json.loads((ROOT / 'data/categories.json').read_text(encoding='utf-8'))
        groups = json.loads((ROOT / 'data/category_groups.json').read_text(encoding='utf-8'))
        ignored = validate_groups(groups, categories)
        self.assertEqual((len(groups['groups']), len(groups['category_descriptions'])), (7, 21))
        self.assertEqual({lang: len(names) for lang, names in ignored.items()}, {'ja': 18, 'en': 18})
        report = update_tools.Report()
        tool = {'id': 'day001', 'category_ids': ['visualization'], 'difficulty': 1,
                'category_ja': ['シミュレーター', 'Simulator'],
                'category_en': ['Simulator', 'simulator', 'Simulator ', 'Network', 'Classic Cryptography', 'Lock Picking', 'Prepper']}
        report.collect(tool, validate_categories(categories)[1], ignored)
        self.assertEqual(set(report.unknown), {('ja', 'Simulator'), ('en', 'simulator'), ('en', 'Simulator '),
                                             ('en', 'Network'), ('en', 'Classic Cryptography'), ('en', 'Lock Picking'), ('en', 'Prepper')})


class MetadataBeforeFetchTests(unittest.TestCase):
    setUp = fixtures.RegenerationTests.setUp
    write = fixtures.RegenerationTests.write
    install = fixtures.RegenerationTests.install
    outputs = fixtures.RegenerationTests.outputs
    def test_invalid_group_or_alias_stops_before_fetch_and_write(self):
        before = self.outputs()
        categories = json.loads((self.root / 'data/categories.json').read_text(encoding='utf-8'))
        groups = json.loads((self.root / 'data/category_groups.json').read_text(encoding='utf-8'))
        bad_cases = []
        bad = copy.deepcopy(groups); bad['schema_version'] = 2; bad_cases.append(('data/category_groups.json', bad))
        bad = copy.deepcopy(groups); bad['groups'][0]['category_ids'].append('missing'); bad_cases.append(('data/category_groups.json', bad))
        bad = copy.deepcopy(groups); bad['ignored_raw_names'] = [{'lang': 'en', 'name': 'First'}]; bad_cases.append(('data/category_groups.json', bad))
        bad = copy.deepcopy(categories); bad[0]['aliases_en'] = ['First']; bad_cases.append(('data/categories.json', bad))
        bad = copy.deepcopy(categories); bad[0]['aliases_en'] = [' untrimmed']; bad_cases.append(('data/categories.json', bad))
        for name, value in bad_cases:
            with self.subTest(name=name, value=value):
                self.write('data/categories.json', categories)
                self.write('data/category_groups.json', groups)
                self.write(name, value)
                with mock.patch.object(update_tools, 'fetch_readme') as fetch:
                    with self.assertRaises(update_tools.CatalogError):
                        update_tools.regenerate(self.root)
                    fetch.assert_not_called()
                self.assertEqual(self.outputs(), before)
