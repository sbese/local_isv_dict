#!/usr/bin/env python3
"""Tests of the Russian lemma scripts: .venv/bin/python -m unittest scripts/ru/test_ru.py"""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from build_lemmas import dict_lemmas, supplement_targets, verbal_noun_candidates  # noqa: E402

CHECK = Path(__file__).parent / 'check.py'
STRESS = chr(0x301)


def entry(id, isv, kind=None):
    return {'id': id, 'isv': isv, 'derived': {'kind': kind, 'from': []} if kind else None}


class BuildTest(unittest.TestCase):
    def test_verbal_noun_candidates(self):
        self.assertIn('закрытие', verbal_noun_candidates('закрыть'))
        self.assertIn('освобождение', verbal_noun_candidates('освободить'))
        self.assertIn('обсуждение', verbal_noun_candidates('обсуждать'))
        self.assertIn('исчезновение', verbal_noun_candidates('исчезнуть'))
        self.assertIn('ведение', verbal_noun_candidates('вести'))

    def test_participle_gives_its_verb(self):
        self.assertEqual(dict_lemmas('побежденный'), {'побежденный', 'победить'})
        self.assertEqual(dict_lemmas('стекло'), {'стекло'})  # not "стечь": that parse is not a lemma

    def test_supplement_matches_any_headword_variant(self):
        targets = supplement_targets([entry(-5, 'umŕeńje, umrěńje, umirańje', 'verbal noun'),
                                      entry(-1000005, 'umŕeńje', 'present active participle'),
                                      entry(7, 'smŕť')])
        self.assertEqual(targets('derived:umŕeńje, umrěńje'), {-5})
        self.assertEqual(targets('derived:umrěńje'), {-5})
        self.assertEqual(targets('id:7'), {7})
        self.assertEqual(targets('derived:gone'), set())
        self.assertEqual(targets('id:8'), set())


class CheckTest(unittest.TestCase):
    def check(self, *texts, lemmas=('дом', 'кот', 'море', 'вера')):
        with tempfile.TemporaryDirectory() as directory:
            lemma_file = Path(directory, 'lemmas.tsv')
            lemma_file.write_text('lemma\tids\tsources\n' + ''.join(f'{lemma}\t1\tdict\n' for lemma in lemmas),
                                  encoding='utf-8')
            files = []
            for i, text in enumerate(texts):
                files.append(Path(directory, f'{i}.txt'))
                files[-1].write_text(text, encoding='utf-8')
            result = subprocess.run([sys.executable, str(CHECK), '--lemmas', str(lemma_file), *map(str, files)],
                                    capture_output=True, text=True)
            return [line.split('\t')[0] for line in result.stdout.splitlines()]

    def test_files_are_not_glued(self):
        self.assertEqual(self.check('кот', 'дом'), [])

    def test_stressed_word_is_one_word(self):
        self.assertEqual(self.check(f'мо{STRESS}ре'), [])

    def test_unicode_hyphens_and_combining_letters(self):
        lemmas = ('по-русски', 'из-за', 'мой', 'все')
        self.assertEqual(self.check(f'по{chr(0x2011)}русски из{chr(0x2212)}за', lemmas=lemmas), [])
        self.assertEqual(self.check(f'мои{chr(0x306)} вс{chr(0x435)}{chr(0x300)}', lemmas=lemmas), [])

    def test_names_are_skipped_only_when_capitalized(self):
        self.assertEqual(self.check('Роза и Вера'), ['и'])
        self.assertEqual(self.check('роза'), ['роза'])
        self.assertEqual(self.check('вера'), [])

    def test_abbreviations_are_skipped_by_the_most_likely_parse(self):
        self.assertEqual(self.check('5 млн'), [])
        self.assertEqual(self.check('кот и дом'), ['и'])  # "и" is also an abbreviation to pymorphy


if __name__ == '__main__':
    unittest.main()
