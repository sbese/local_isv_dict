// The in-memory dictionary: entries plus two search maps, cached on disk between runs.
//
//   tr:  fold(translation variant)        → postings `row * 32 + language index`
//   isv: isvKey(headword or word form)    → postings `row * 4 + kind`
//
// Building the Interslavic map means generating every paradigm of the dictionary, so the maps are
// saved to `data/index.json` and rebuilt only when the sheets, the declension library or the index
// format change.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { DATA_DIR, loadSource, update } from './data.js'
import { paradigms, searchableForms } from './forms.js'
import { LANGS, fold, isvKey, lemmaVariants, splitVariants } from './text.js'

const INDEX_FILE = 'index.json'
const LIBRARY_VERSION = createRequire(import.meta.url)('@interslavic/utils/package.json').version

// The keys depend on the code that produces them, so the saved index is tied to these files:
// editing any of them rebuilds it instead of silently searching with stale keys.
const INDEX_VERSION = createHash('sha1')
    .update(['text.js', 'forms.js', 'data.js', 'dict.js']
        .map((file) => readFileSync(new URL(file, import.meta.url)))
        .join('\n'))
    .digest('hex')
    .slice(0, 12)

/** How an Interslavic key relates to its entry. */
export const KIND = { lemma: 0, reflexiveHead: 1, form: 2 }

const push = (map, key, posting) => {
    const postings = map.get(key)

    if (postings) {
        postings.push(posting)
    } else {
        map.set(key, [posting])
    }
}

/** "učiti sę" → "učiti"; `null` for anything that is not a reflexive verb headword. */
export function reflexiveHead(variant) {
    const head = variant.replace(/ s[ęe]$/, '')

    return head !== variant ? head : null
}

/** @param {import('./data.js').Entry[]} entries */
export function buildIndex(entries) {
    const tr = new Map()
    const isv = new Map()

    entries.forEach((entry, row) => {
        LANGS.forEach((lang, langIndex) => {
            const cell = entry.tr[lang]

            if (!cell) {
                return
            }

            for (const key of new Set(splitVariants(cell).variants.map(fold))) {
                if (key) {
                    push(tr, key, row * 32 + langIndex)
                }
            }
        })

        // one posting per key and entry, with the strongest kind
        const kinds = new Map()
        const note = (key, kind) => {
            if (key && (kinds.get(key) ?? Infinity) > kind) {
                kinds.set(key, kind)
            }
        }

        for (const variant of lemmaVariants(entry.isv)) {
            const head = reflexiveHead(variant)

            note(isvKey(variant), KIND.lemma)

            if (head) {
                note(isvKey(head), KIND.reflexiveHead)
            }
        }

        for (const form of searchableForms(paradigms(entry).list)) {
            note(isvKey(form), KIND.form)
        }

        for (const [key, kind] of kinds) {
            push(isv, key, row * 4 + kind)
        }
    })

    return { tr, isv }
}

/**
 * Words that occur inside multi-word translations and headwords — the fallback for a query that
 * matches nothing as a whole. Built on first use and not cached on disk.
 */
function buildPhraseIndex(entries) {
    const tr = new Map()
    const isv = new Map()

    entries.forEach((entry, row) => {
        LANGS.forEach((lang, langIndex) => {
            const cell = entry.tr[lang]

            if (!cell) {
                return
            }

            const words = new Set()

            for (const variant of splitVariants(cell).variants) {
                const tokens = phraseWords(fold(variant))

                if (tokens.length > 1) {
                    tokens.forEach((token) => words.add(token))
                }
            }

            for (const word of words) {
                push(tr, word, row * 32 + langIndex)
            }
        })

        const words = new Set()

        for (const variant of lemmaVariants(entry.isv)) {
            const tokens = isvKey(variant).split(' ')

            if (tokens.length > 1) {
                tokens.forEach((token) => words.add(token))
            }
        }

        for (const word of words) {
            push(isv, word, row)
        }
    })

    return { tr, isv }
}

/** The words of a folded translation variant; "ale/pak/tola" counts as three, a lone dash as none. */
function phraseWords(folded) {
    return folded.split(/[\s/]+/).filter((word) => /[\p{L}\p{N}]/u.test(word))
}

const serialize = (map) => [[...map.keys()], [...map.values()]]
const deserialize = ([keys, postings]) => new Map(keys.map((key, i) => [key, postings[i]]))

async function readIndex(dataDir, sha) {
    try {
        const saved = JSON.parse(await readFile(path.join(dataDir, INDEX_FILE), 'utf8'))

        if (saved.version === INDEX_VERSION && saved.library === LIBRARY_VERSION && saved.sha === sha) {
            return { tr: deserialize(saved.tr), isv: deserialize(saved.isv) }
        }
    } catch {
        // no usable cache — it will be rebuilt
    }

    return null
}

async function writeIndex(dataDir, sha, index) {
    const target = path.join(dataDir, INDEX_FILE)
    const saved = {
        version: INDEX_VERSION,
        library: LIBRARY_VERSION,
        sha,
        tr: serialize(index.tr),
        isv: serialize(index.isv),
    }

    // several processes (CLI, MCP, HTTP) may build the index at the same moment
    const temporary = `${target}.${process.pid}.tmp`

    await writeFile(temporary, JSON.stringify(saved))
    await rename(temporary, target)
}

/**
 * @typedef {object} Dict
 * @property {import('./data.js').Entry[]} entries
 * @property {Map<number, number>} rowById
 * @property {Map<string, number[]>} tr
 * @property {Map<string, number[]>} isv
 * @property {() => {tr: Map<string, number[]>, isv: Map<string, number[]>}} phrases
 * @property {object} info
 */

/** @returns {Dict} */
export function createDict(entries, index, info = {}) {
    let phraseIndex

    return {
        entries,
        rowById: new Map(entries.map((entry, row) => [entry.id, row])),
        tr: index.tr,
        isv: index.isv,
        phrases: () => (phraseIndex ??= buildPhraseIndex(entries)),
        info,
    }
}

async function load({ dataDir = DATA_DIR, log = () => {}, download = false } = {}) {
    let source = null

    if (!download) {
        try {
            source = await loadSource(dataDir)
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error
            }

            log('The dictionary has not been downloaded yet — fetching it now (one-time, ~13 MB)…')
        }
    }

    if (!source) {
        await update({ dataDir, log })
        source = await loadSource(dataDir)
    }

    const { entries, sha, meta } = source
    let index = await readIndex(dataDir, sha)

    if (!index) {
        log(`Building the search index for ${entries.length} entries…`)
        index = buildIndex(entries)
        await writeIndex(dataDir, sha, index)
        log('The search index is ready.')
    }

    return createDict(entries, index, {
        dataDir,
        downloadedAt: meta?.downloadedAt ?? null,
        source: meta?.source ?? null,
        entries: entries.length,
        library: `@interslavic/utils ${LIBRARY_VERSION}`,
    })
}

let opened = null

/**
 * Opens the dictionary once per process: downloads the sheets on the very first run, then reuses
 * the local copy and the cached index.
 * @param {{dataDir?: string, log?: (message: string) => void}} [options]
 * @returns {Promise<Dict>}
 */
export function openDict(options) {
    opened ??= load(options).catch((error) => {
        opened = null
        throw error
    })

    return opened
}

/** Downloads the sheets again and rebuilds the index. */
export function refreshDict(options) {
    opened = load({ ...options, download: true }).catch((error) => {
        opened = null
        throw error
    })

    return opened
}
