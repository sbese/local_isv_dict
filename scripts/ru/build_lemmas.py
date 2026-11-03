#!/usr/bin/env python3
"""Builds the list of Russian lemmas the dictionary can translate: data/ru_lemmas.tsv.

Every lemma is in the form pymorphy3 gives as `normal_form` (lower case, ё as е), so a Russian
text is checked by normalizing its words the same way (see check.py). Sources of a lemma:

  dict         a single-word Russian translation of an entry, and its pymorphy normal form when
               that differs ("побеждённый" also gives "победить")
  verbal-noun  the Russian verbal noun of a derived Interslavic verbal noun, made from the Russian
               translation of its verb by suffix rules and kept only if pymorphy knows that noun
  generated    a line of supplement/ru_generated.tsv (filled by a model, see README)

Participles need no lemmas of their own: pymorphy normalizes them to the infinitive.

Also writes what the rules could not resolve, for the model to fill:
  data/ru_todo_verbal_nouns.jsonl  derived verbal nouns with no Russian noun found
  data/ru_unknown.jsonl            translations pymorphy does not know, to look through for typos
"""

import argparse
import csv
import json
import os
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import pymorphy3

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get('ISV_DICT_DATA_DIR') or ROOT / 'data').resolve()  # as in src/data.js
SUPPLEMENT = ROOT / 'supplement' / 'ru_generated.tsv'

ACCENTS = str.maketrans('', '', chr(0x301) + chr(0x300))
CYRILLIC_WORD = set('абвгдежзийклмнопрстуфхцчшщъыьэюя-')

morph = pymorphy3.MorphAnalyzer()


def norm(text):
    return text.lower().translate(ACCENTS).replace('ё', 'е').strip()


def is_word(text):
    return bool(text) and set(text) <= CYRILLIC_WORD and not text.startswith('-') and not text.endswith('-')


def looks_like_lemma(tag):
    """A parse in which the word is the dictionary form of its paradigm."""
    if tag.POS in ('INFN', 'ADVB', 'PREP', 'CONJ', 'PRCL', 'INTJ', 'PRED', 'COMP', 'GRND'):
        return True
    return 'nomn' in tag and ('sing' in tag or 'Pltm' in tag or tag.number is None)


def dict_lemmas(word):
    """The keys a single-word translation is found by."""
    keys = {word}
    for parse in morph.parse(word):
        if norm(parse.word) == word and looks_like_lemma(parse.tag):
            keys.add(norm(parse.normal_form))
    return keys


# The stem before the infinitive ending → stems before -ение: "разрешить" → "разрешение",
# "ставить" → "ставление", "освободить" → "освобождение", "посетить" → "посещение".
ALTERNATIONS = [('ст', ['щ']), ('б', ['бл']), ('в', ['вл']), ('п', ['пл']), ('м', ['мл']), ('ф', ['фл']),
                ('д', ['жд', 'ж']), ('т', ['щ', 'ч']), ('з', ['ж']), ('с', ['ш'])]


def alternated(stem):
    stems = [stem]
    for end, replacements in ALTERNATIONS:
        if stem.endswith(end):
            stems += [stem[:-len(end)] + replacement for replacement in replacements]
            break
    return stems


def verbal_noun_candidates(infinitive):
    verb = infinitive[:-2] if infinitive.endswith(('ся', 'сь')) else infinitive
    out = []
    if verb.endswith('ать'):
        out += [verb[:-3] + 'ание', verb[:-3] + 'атие', verb[:-3] + 'ение']
    if verb.endswith('ять'):
        out += [verb[:-3] + 'яние', verb[:-3] + 'ятие', verb[:-3] + 'ение']
    if verb.endswith(('ить', 'еть')):
        out += [stem + 'ение' for stem in alternated(verb[:-3])]
        out += [verb[:-3] + 'итие', verb[:-3] + 'етие']
    if verb.endswith('ыть'):
        out.append(verb[:-3] + 'ытие')
    if verb.endswith('уть'):
        out.append(verb[:-3] + 'утие')
        if verb.endswith('нуть'):
            out.append(verb[:-4] + 'новение')
    if verb.endswith('сти'):
        out += [verb[:-3] + consonant + 'ение' for consonant in ('с', 'д', 'т', 'б')]
    if verb.endswith('зти'):
        out.append(verb[:-3] + 'зение')
    if verb.endswith('чь'):
        out += [verb[:-2] + 'чение', verb[:-2] + 'жение']
    return out


def known_noun(word):
    return any(
        parse.tag.POS == 'NOUN' and 'nomn' in parse.tag and 'sing' in parse.tag and norm(parse.normal_form) == word
        for parse in morph.parse(word)
    ) and morph.word_is_known(word)


def is_infinitive(word):
    return any(parse.tag.POS == 'INFN' for parse in morph.parse(word))


def write_atomically(path, lines):
    """Writes a temporary file next to `path` and renames it, so a failed run leaves the old file whole."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w', encoding='utf-8') as file:
        file.writelines(lines)
    temporary.replace(path)


def export_entries():
    result = subprocess.run(['node', str(ROOT / 'scripts' / 'ru' / 'export-entries.js')],
                            capture_output=True, text=True, check=True)
    return [json.loads(line) for line in result.stdout.splitlines() if line]


def headword_variants(isv):
    """"umŕeńje, umrěńje" → {"umŕeńje", "umrěńje"}: a derived entry may gain or lose variants after an update."""
    return {variant.strip() for variant in isv.split(',') if variant.strip()}


def supplement_targets(entries):
    """The ids a `target` of the supplement stands for: a derived verbal noun is matched by any of its
    headword variants, an entry of the sheet by its id. Empty when it matches nothing."""
    noun_by_variant = {variant: entry['id'] for entry in entries
                       if entry['derived'] and entry['derived']['kind'] == 'verbal noun'
                       for variant in headword_variants(entry['isv'])}
    ids = {entry['id'] for entry in entries}

    def target_ids(target):
        kind, _, key = target.partition(':')
        if kind == 'derived':
            return {noun_by_variant[variant] for variant in headword_variants(key) if variant in noun_by_variant}
        return {int(key)} & ids if kind == 'id' and key.lstrip('-').isdigit() else set()

    return target_ids


def read_supplement():
    """`target` (id:N or derived:<isv>), `ru` (comma-separated; empty = no Russian word), `note`."""
    if not SUPPLEMENT.exists():
        return []
    with SUPPLEMENT.open(encoding='utf-8', newline='') as file:
        return list(csv.DictReader(file, delimiter='\t'))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', default=str(DATA / 'ru_lemmas.tsv'))
    args = parser.parse_args()

    entries = export_entries()
    by_id = {entry['id']: entry for entry in entries}
    lemmas = defaultdict(lambda: {'ids': set(), 'sources': set()})

    def add(lemma, entry_id, source):
        lemmas[lemma]['ids'].add(entry_id)
        lemmas[lemma]['sources'].add(source)

    unknown = []
    for entry in entries:
        if entry['removed'] or entry['derived']:
            continue
        for variant in entry['ru']:
            word = norm(variant)
            if not is_word(word):
                continue
            for lemma in dict_lemmas(word):
                add(lemma, entry['id'], 'dict')
            if not morph.word_is_known(word):
                unknown.append({'id': entry['id'], 'isv': entry['isv'], 'pos': entry['pos'], 'en': entry['en'],
                                'ru': variant, 'all_ru': entry['ru']})

    supplement = read_supplement()
    target_ids = supplement_targets(entries)
    supplied = {entry_id for row in supplement for entry_id in target_ids(row['target'])}

    todo_nouns = []
    for entry in entries:
        if not entry['derived'] or entry['derived']['kind'] != 'verbal noun':
            continue
        verbs = [by_id[source['id']] for source in entry['derived']['from'] if source['id'] in by_id]
        infinitives = {norm(variant) for verb in verbs for variant in verb['ru']}
        infinitives = {word for word in infinitives if is_word(word) and is_infinitive(word)}
        nouns = {candidate for word in infinitives for candidate in verbal_noun_candidates(word) if known_noun(candidate)}
        for noun in nouns:
            add(noun, entry['id'], 'verbal-noun')
        if not nouns and entry['id'] not in supplied:
            todo_nouns.append({'target': f"derived:{entry['isv']}", 'isv': entry['isv'],
                               'verbs': [{'id': verb['id'], 'isv': verb['isv'], 'pos': verb['pos'],
                                          'ru': verb['ru'], 'en': verb['en']} for verb in verbs]})

    stale = []
    doubtful = []  # generated words pymorphy does not know
    for row in supplement:
        ids = target_ids(row['target'])
        if not ids:
            stale.append(row['target'])
        for entry_id, variant in ((entry_id, variant) for entry_id in ids
                                  for variant in filter(None, (piece.strip() for piece in row['ru'].split(',')))):
            word = norm(variant)
            if not is_word(word):
                continue  # a phrase, see the README
            if not morph.word_is_known(word):
                doubtful.append(f"{row['target']} {variant}")
            for lemma in dict_lemmas(word):
                add(lemma, entry_id, 'generated')

    if stale:
        # the list would lack their words, so the previous one is kept
        print(f'Supplement lines matching no entry: {len(stale)}: {", ".join(stale[:10])}', file=sys.stderr)
        print(f'Fix their `target` (see the README); {args.out} is left as it was.', file=sys.stderr)
        sys.exit(1)

    unknown = [item for item in unknown if item['id'] not in supplied]

    out = Path(args.out)
    write_atomically(out, ['lemma\tids\tsources\n'] + [
        f"{lemma}\t{','.join(map(str, sorted(info['ids'])))}\t{','.join(sorted(info['sources']))}\n"
        for lemma, info in sorted(lemmas.items())])
    for name, items in (('ru_todo_verbal_nouns.jsonl', todo_nouns), ('ru_unknown.jsonl', unknown)):
        write_atomically(DATA / name, [json.dumps(item, ensure_ascii=False) + '\n' for item in items])

    counts = defaultdict(int)
    for info in lemmas.values():
        for source in info['sources']:
            counts[source] += 1
    print(f"{len(lemmas)} lemmas → {out}", file=sys.stderr)
    print('  by source: ' + ', '.join(f'{source} {count}' for source, count in sorted(counts.items())), file=sys.stderr)
    print(f'  verbal nouns left for the model: {len(todo_nouns)} (data/ru_todo_verbal_nouns.jsonl)', file=sys.stderr)
    print(f'  translations pymorphy does not know: {len(unknown)} (data/ru_unknown.jsonl)', file=sys.stderr)
    if doubtful:
        print(f'  generated words pymorphy does not know: {len(doubtful)}: {", ".join(doubtful[:10])}', file=sys.stderr)


if __name__ == '__main__':
    main()
