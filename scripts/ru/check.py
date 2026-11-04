#!/usr/bin/env python3
"""Checks a Russian text against data/ru_lemmas.tsv: prints the words whose lemma the dictionary
has no entry for. A word counts as found when any of its pymorphy parses gives a known lemma, so
"сделанный" is found through "сделать" and "стали" through "стать" or "сталь"; a hyphenated word
is found when all its parts are ("интернет-магазин").

Not every word that is not found is reported as missing:
- words pymorphy does not know (names, typos, rare words, foreign words) are listed apart, as
  written, since the lemma pymorphy would guess for them is unreliable ("мбитый" for "Мбит");
- skipped altogether, and listed only with --json: a capitalized word inside a sentence (a name,
  a brand), a word in capitals (an abbreviation), a word pymorphy reads as a name or a place when
  capitalized or as an abbreviation by its most likely parse (--skip sets those grammemes), a short
  indeclinable noun ("мм", "га"), the tail of "6-го", and single letters.

Reads the text from the given files or from stdin. Exits with 1 when some words are missing or
unknown.

  python scripts/ru/check.py text.txt
  echo "Мы читали книгу" | python scripts/ru/check.py --json
"""

import argparse
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import pymorphy3

ROOT = Path(__file__).resolve().parents[2]
ACCENTS = str.maketrans('', '', chr(0x301) + chr(0x300))
# hyphen, non-breaking hyphen, minus → "-", as in src/text.js; dashes are left alone: they separate words
HYPHENS = str.maketrans({chr(0x2010): '-', chr(0x2011): '-', chr(0x2212): '-'})
WORD = re.compile(r'[а-яё]+(?:-[а-яё]+)*', re.IGNORECASE)
# "6-го", "2-х", "4ре": a few letters after a number are an ending, not a word ("3-комнатная" is)
NUMBER_TAIL = 3
# a sentence ends with one of these, or at the end of a line…
SENTENCE_END = set('.!?…:;\n')
# …possibly followed by quotes, brackets, dashes and spaces (any Unicode space, see below) before
# the next one starts
BETWEEN_SENTENCES = set('«»"„“”\'()[]—–-')

DATA = Path(os.environ.get('ISV_DICT_DATA_DIR') or ROOT / 'data').resolve()  # as in src/data.js

# pymorphy grammemes of words not reported as missing: names, places, abbreviations
DEFAULT_SKIP = 'Name,Surn,Patr,Geox,Orgn,Trad,Abbr,Init'
# pymorphy also reads many common nouns as names ("роза", "лев", "орёл"), so a word counts as a name
# or a place only when written with a capital letter; any other grammeme (an abbreviation: "млн", but
# also "и", "в") only when its most likely parse has it
PROPER = {'Name', 'Surn', 'Patr', 'Geox', 'Orgn', 'Trad'}


def norm(text):
    return text.lower().translate(ACCENTS).replace('ё', 'е')


def prepare(text):
    """Before splitting into words: "мо́ре" is one word, and so are "по‑русски" with a non-breaking
    hyphen and "й" written as "и" + a combining breve. Stress marks go first, as NFC would turn
    "е" + a grave into "ѐ"."""
    text = unicodedata.normalize('NFC', text.translate(ACCENTS)).translate(HYPHENS)
    return ''.join(char for char in text if unicodedata.category(char) not in ('Cf', 'Co'))


def after_number(text, position):
    """Whether the word at `position` follows a number: "6-го", "4ре"."""
    before = text[max(0, position - 2):position]
    return before.rstrip('-')[-1:].isdigit()


def starts_sentence(text, position):
    """Whether the word at `position` is the first of its sentence."""
    i = position - 1
    while i >= 0 and (text[i] in BETWEEN_SENTENCES or (text[i].isspace() and text[i] != '\n')):
        i -= 1
    return i < 0 or text[i] in SENTENCE_END


def load_lemmas(path):
    with open(path, encoding='utf-8') as file:
        next(file)
        return {line.split('\t', 1)[0] for line in file}


class Checker:
    def __init__(self, lemmas, skip=DEFAULT_SKIP):
        self.lemmas = lemmas
        self.skip = {tag for tag in skip.split(',') if tag}
        self.morph = pymorphy3.MorphAnalyzer()

    def found(self, word):
        return word in self.lemmas or any(norm(parse.normal_form) in self.lemmas for parse in self.morph.parse(word))

    def classify(self, text):
        """Yields (word as written, outcome, key) for every word of the text: the outcome is
        "found", "missing" (key: the lemma), "unknown" (key: the word) or "skipped" (key: why)."""
        text = prepare(text)
        for match in WORD.finditer(text):
            raw = match.group()
            word = norm(raw)
            if self.found(word) or ('-' in word and all(self.found(part) for part in word.split('-'))):
                yield raw, 'found', word
                continue
            if len(word) <= NUMBER_TAIL and after_number(text, match.start()):
                yield raw, 'skipped', 'after a number'
                continue
            if len(raw) > 1 and raw.isupper():
                yield raw, 'skipped', 'in capitals'
                continue
            capitalized = raw[0].isupper()
            if capitalized and not starts_sentence(text, match.start()):
                yield raw, 'skipped', 'capitalized inside a sentence'
                continue
            # the one-letter words ("а", "и", "в", "я") are all in the dictionary; what is left is a
            # fragment ("й", "х") or a particle pymorphy does not normalize ("б", "ж")
            if len(word) == 1:
                yield raw, 'skipped', 'a single letter'
                continue
            # the grammemes pymorphy guesses for a word it does not know are not to be trusted
            # ("интернет-банк" is an abbreviation to it), so such a word is listed as it is
            if not self.morph.word_is_known(word):
                yield raw, 'unknown', word
                continue
            parses = self.morph.parse(word)
            if any(tag in parse.tag.grammemes and (capitalized if tag in PROPER else parse is parses[0])
                   for parse in parses for tag in self.skip):
                yield raw, 'skipped', 'a name or an abbreviation to pymorphy'
                continue
            # "мм", "га", "кг": a two-letter indeclinable noun is a unit ("руб", "тыс" are
            # abbreviations to pymorphy already)
            if len(word) == 2 and any('Fixd' in parse.tag for parse in parses):
                yield raw, 'skipped', 'a unit'
                continue
            yield raw, 'missing', norm(parses[0].normal_form)

    def check(self, text):
        """Counts of the text's words: `found`, `missing` and `unknown` (key → forms as written →
        count) and `skipped` (word as written → count)."""
        report = {'found': 0, 'missing': defaultdict(Counter), 'unknown': defaultdict(Counter), 'skipped': Counter()}
        for raw, outcome, key in self.classify(text):
            if outcome == 'found':
                report['found'] += 1
            elif outcome == 'skipped':
                report['skipped'][raw] += 1
            else:
                report[outcome][key][raw] += 1
        return report


def ordered(counted):
    """Lemmas or words by their count, the most frequent first."""
    return sorted(counted.items(), key=lambda item: (-sum(item[1].values()), item[0]))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('files', nargs='*')
    parser.add_argument('--lemmas', default=str(DATA / 'ru_lemmas.tsv'))
    parser.add_argument('--skip', default=DEFAULT_SKIP,
                        help=f'comma-separated pymorphy grammemes or parts of speech not to check (default: {DEFAULT_SKIP})')
    parser.add_argument('--json', action='store_true', help='print the result as JSON')
    args = parser.parse_args()

    checker = Checker(load_lemmas(args.lemmas), args.skip)
    text = '\n'.join(Path(name).read_text(encoding='utf-8') for name in args.files) if args.files else sys.stdin.read()
    report = checker.check(text)
    missing, unknown = ordered(report['missing']), ordered(report['unknown'])
    total = report['found'] + sum(sum(forms.values()) for forms in [*report['missing'].values(), *report['unknown'].values()])

    if args.json:
        as_list = lambda items, name: [{name: key, 'count': sum(forms.values()), 'forms': sorted(forms)} for key, forms in items]
        json.dump({'words': total, 'missing': as_list(missing, 'lemma'), 'unknown': as_list(unknown, 'word'),
                   'skipped': sorted(report['skipped'])}, sys.stdout, ensure_ascii=False, indent=1)
        print()
    else:
        for lemma, forms in missing:
            print(f"{lemma}\t{sum(forms.values())}\t{', '.join(sorted(forms))}")
        if unknown:
            print('\nunknown to pymorphy (names, typos, rare words), as written:')
            for word, forms in unknown:
                print(f"{word}\t{sum(forms.values())}\t{', '.join(sorted(forms))}")
        print(f'{len(missing)} lemmas missing and {len(unknown)} words unknown of {total} words checked', file=sys.stderr)
    sys.exit(1 if missing or unknown else 0)


if __name__ == '__main__':
    main()
