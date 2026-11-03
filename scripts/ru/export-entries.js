#!/usr/bin/env node
// Prints every entry of the dictionary, derived ones included, as JSON lines with its Russian
// variants split the way lookup splits them; build_lemmas.py reads this.

import { openDict } from '../../src/dict.js'
import { splitVariants } from '../../src/text.js'

const dict = await openDict({ log: (message) => console.error(message) })

for (const entry of dict.entries) {
    const { variants, unverified } = splitVariants(entry.tr.ru)

    process.stdout.write(`${JSON.stringify({
        id: entry.id,
        isv: entry.isv,
        pos: entry.pos,
        removed: entry.removed,
        ru: variants,
        unverified,
        en: entry.tr.en ?? '',
        derived: entry.derived ?? null,
    })}\n`)
}
