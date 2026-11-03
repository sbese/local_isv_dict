#!/usr/bin/env python3
"""Tests of the Russian lemma scripts: .venv/bin/python -m unittest scripts/ru/test_ru.py"""

import json
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

    def test_plural_word_gives_pymorphy_singular(self):
        self.assertIn('деньга', dict_lemmas('деньги'))  # what pymorphy gives for "денег"

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
    def check(self, *texts, lemmas=('дом', 'кот', 'море', 'вера', 'магазин', 'интернет', 'очень', 'и', 'в')):
        """The missing lemmas, the unknown words and the skipped words of the texts."""
        with tempfile.TemporaryDirectory() as directory:
            lemma_file = Path(directory, 'lemmas.tsv')
            lemma_file.write_text('lemma\tids\tsources\n' + ''.join(f'{lemma}\t1\tdict\n' for lemma in lemmas),
                                  encoding='utf-8')
            files = []
            for i, text in enumerate(texts):
                files.append(Path(directory, f'{i}.txt'))
                files[-1].write_text(text, encoding='utf-8')
            result = subprocess.run([sys.executable, str(CHECK), '--json', '--lemmas', str(lemma_file), *map(str, files)],
                                    capture_output=True, text=True)
            report = json.loads(result.stdout)
            return [item['lemma'] for item in report['missing']], [item['word'] for item in report['unknown']], report['skipped']

    def test_files_are_not_glued(self):
        self.assertEqual(self.check('кот', 'дом')[0], [])

    def test_stressed_word_is_one_word(self):
        self.assertEqual(self.check(f'мо{STRESS}ре')[0], [])

    def test_unicode_hyphens_and_combining_letters(self):
        lemmas = ('по-русски', 'из-за', 'мой', 'все')
        self.assertEqual(self.check(f'по{chr(0x2011)}русски из{chr(0x2212)}за', lemmas=lemmas)[0], [])
        self.assertEqual(self.check(f'мои{chr(0x306)} вс{chr(0x435)}{chr(0x300)}', lemmas=lemmas)[0], [])

    def test_names_are_skipped_only_when_capitalized(self):
        self.assertEqual(self.check('Роза и Вера'), ([], [], ['Роза']))  # "вера" is in the list
        self.assertEqual(self.check('роза')[0], ['роза'])
        self.assertEqual(self.check('вера')[0], [])

    def test_abbreviations_are_skipped_by_the_most_likely_parse(self):
        self.assertEqual(self.check('5 млн')[2], ['млн'])
        self.assertEqual(self.check('кот и дом'), ([], [], []))  # "и" is also an abbreviation to pymorphy

    def test_hyphenated_word_is_found_by_its_parts(self):
        self.assertEqual(self.check('интернет-магазин, очень-очень'), ([], [], []))
        self.assertEqual(self.check('интернет-банк')[1], ['интернет-банк'])  # pymorphy does not know it

    def test_capitals_units_letters_and_number_tails_are_skipped(self):
        self.assertEqual(self.check('ЕГРН 6-го 2-х 4ре'), ([], [], ['ЕГРН', 'го', 'ре', 'х']))
        self.assertEqual(self.check('5 мм, 3 га, б, ж, й'), ([], [], ['б', 'га', 'ж', 'й', 'мм']))
        self.assertEqual(self.check('тур')[0], ['тур'])  # three letters: a word, not a unit

    def test_capitalized_word_inside_a_sentence_is_a_name(self):
        missing, unknown, skipped = self.check('Кот живёт в городе Хаттлстоун. Форекс — обман! «Демоница» (фильм)')
        self.assertEqual(missing, ['город', 'жить', 'обман', 'фильм'])
        self.assertEqual(unknown, ['демоница', 'форекс'])  # at the start of a sentence: not a name for sure
        self.assertEqual(skipped, ['Хаттлстоун'])

    def test_unknown_word_is_listed_as_written(self):
        missing, unknown, skipped = self.check('Хаттлстоун далеко. Мбит мало, й')
        self.assertEqual((missing, unknown, skipped), (['далеко', 'мало'], ['мбит', 'хаттлстоун'], ['й']))


if __name__ == '__main__':
    unittest.main()
