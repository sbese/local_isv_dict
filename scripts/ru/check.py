#!/usr/bin/env python3
"""Checks a Russian text against data/ru_lemmas.tsv: prints the words whose lemma the dictionary
has no entry for. A word counts as found when any of its pymorphy parses gives a known lemma, so
"сделанный" is found through "сделать" and "стали" through "стать" or "сталь".

Reads the text from the given files or from stdin. Exits with 1 when some words are missing.

  python scripts/ru/check.py text.txt
  echo "Мы читали книгу" | python scripts/ru/check.py --json
"""

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pymorphy3

ROOT = Path(__file__).resolve().parents[2]
ACCENTS = str.maketrans('', '', chr(0x301) + chr(0x300))
WORD = re.compile(r'[а-яё]+(?:-[а-яё]+)*', re.IGNORECASE)

# pymorphy grammemes of words that are not looked up: names, places, abbreviations
DEFAULT_SKIP = 'Name,Surn,Patr,Geox,Orgn,Trad,Abbr,Init'


def norm(text):
    return text.lower().translate(ACCENTS).replace('ё', 'е')


def load_lemmas(path):
    with open(path, encoding='utf-8') as file:
        next(file)
        return {line.split('\t', 1)[0] for line in file}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('files', nargs='*')
    parser.add_argument('--lemmas', default=str(ROOT / 'data' / 'ru_lemmas.tsv'))
    parser.add_argument('--skip', default=DEFAULT_SKIP,
                        help=f'comma-separated pymorphy grammemes or parts of speech not to check (default: {DEFAULT_SKIP})')
    parser.add_argument('--json', action='store_true', help='print the result as JSON')
    args = parser.parse_args()

    lemmas = load_lemmas(args.lemmas)
    skip = {tag for tag in args.skip.split(',') if tag}
    morph = pymorphy3.MorphAnalyzer()
    text = ''.join(Path(name).read_text(encoding='utf-8') for name in args.files) if args.files else sys.stdin.read()

    missing = defaultdict(Counter)  # most likely lemma → the words of the text it stands for
    total = 0
    for match in WORD.finditer(text):
        word = norm(match.group())
        parses = morph.parse(word)
        if any(skip & set(parse.tag.grammemes) for parse in parses[:1]):
            continue
        total += 1
        if word in lemmas or any(norm(parse.normal_form) in lemmas for parse in parses):
            continue
        missing[norm(parses[0].normal_form)][match.group()] += 1

    ordered = sorted(missing.items(), key=lambda item: (-sum(item[1].values()), item[0]))
    if args.json:
        json.dump({'words': total, 'missing': [{'lemma': lemma, 'count': sum(words.values()), 'forms': sorted(words)}
                                               for lemma, words in ordered]}, sys.stdout, ensure_ascii=False, indent=1)
        print()
    else:
        for lemma, words in ordered:
            print(f"{lemma}\t{sum(words.values())}\t{', '.join(sorted(words))}")
        print(f'{len(missing)} lemmas missing of {total} words checked', file=sys.stderr)
    sys.exit(1 if missing else 0)


if __name__ == '__main__':
    main()
