// A dictionary built from the 31-row excerpt of the real sheets in test/fixture — no network, no cache.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSheets } from '../src/data.js'
import { buildIndex, createDict } from '../src/dict.js'
import { derivedEntries } from '../src/forms.js'

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture')

export const readFixture = (name) => readFileSync(path.join(FIXTURE_DIR, name), 'utf8')

let dict

export function fixtureDict() {
    if (!dict) {
        const sheet = parseSheets(readFixture('words.tsv'), readFixture('words_add_lang.tsv'))
        const entries = [...sheet, ...derivedEntries(sheet)]

        dict = createDict(entries, buildIndex(entries), { entries: sheet.length })
    }

    return dict
}
