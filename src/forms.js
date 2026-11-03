// Inflected forms of a dictionary entry, generated with @interslavic/utils the same way the
// dictionary web app does (sonic16x/interslavic: src/components/Modals/DetailModal/DetailModal.tsx).
//
// The library returns a differently shaped table for every part of speech, so everything is first
// turned into a flat list of cells `{slot, text}` — e.g. `sg.gen` / `present.1sg` / `pl.nom.m.anim` —
// which is then used both for the search index and for the self-describing JSON output.

import utils from '@interslavic/utils'

import { inflectionHint, isvKey, isvStd, lemmaVariants, safeParsePos, toScript } from './text.js'

const { conjugationVerb, declensionAdjective, declensionNounSimple, declensionNumeral, declensionPronoun } = utils

const CASES = ['nom', 'acc', 'gen', 'loc', 'dat', 'ins', 'voc']
const PERSONS = ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl']
const PERSONS_BY_GENDER = ['1sg', '2sg', '3sg.m', '3sg.f', '3sg.n', '1pl', '2pl', '3pl']
const PARTICIPLES = [
    ['prap', 'presentActive'],
    ['prpp', 'presentPassive'],
    ['pfap', 'pastActive'],
    ['pfpp', 'pastPassive'],
]
// Column titles the library uses for noun-like numerals and pronouns.
const COLUMN_KEYS = {
    'singular': 'sg',
    'plural': 'pl',
    'masculine': 'm',
    'feminine/neuter': 'f/n',
    'singular (m./f.)': 'sg',
    'plural (m./f.)': 'pl',
    'wordForm': '',
    'Word Form': '',
}
const INFLECTED = new Set(['noun', 'adjective', 'verb', 'numeral', 'pronoun'])

/**
 * @typedef {object} Cell
 * @property {string} slot dot-separated place in the paradigm, e.g. `sg.gen`
 * @property {string} text the form(s) as the library gives them (etymological Latin)
 * @property {boolean} index whether the forms in this cell are searchable word forms
 * @property {boolean} [alternatives] `, ` in the text separates alternative forms
 *
 * @typedef {object} Paradigm
 * @property {string} lemma
 * @property {string} kind
 * @property {string} [gender]
 * @property {string} [note]
 * @property {boolean} searchable
 * @property {Cell[]} cells
 */

function attempt(fn) {
    try {
        return fn() ?? null
    } catch {
        return null
    }
}

function collector() {
    const cells = []
    const push = (slot, text, { index = true, alternatives = false } = {}) => {
        if (typeof text === 'string' && text.trim() && text.trim() !== '-') {
            cells.push({ slot, text: text.trim(), index, ...(alternatives && { alternatives }) })
        }
    }

    return { cells, push }
}

function nounCells(table, indeclinable) {
    const { cells, push } = collector()

    if (indeclinable) {
        push('indeclinable', table.nom[0] ?? table.nom[1])

        return cells
    }

    ['sg', 'pl'].forEach((number, i) => {
        for (const kase of CASES) {
            push(`${number}.${kase}`, table[kase]?.[i])
        }
    })

    return cells
}

// In the masculine cell the library writes "<animate> / <inanimate>".
function pushMasculine(push, slot, text) {
    const parts = text.split(' / ')

    if (parts.length === 2) {
        push(`${slot}.anim`, parts[0])
        push(`${slot}.inan`, parts[1])
    } else {
        push(slot, text)
    }
}

function adjectiveCells(push, singular, plural) {
    for (const kase of CASES) {
        const row = singular?.[kase]

        if (!row) {
            continue
        }

        const genders = row.length === 3 ? ['m', 'n', 'f'] : ['m/n', 'f']

        row.forEach((text, i) => {
            if (typeof text !== 'string') {
                return
            }

            if (i === 0 && kase === 'acc') {
                pushMasculine(push, `sg.${kase}.${genders[i]}`, text)
            } else {
                push(`sg.${kase}.${genders[i]}`, text)
            }
        })
    }

    for (const kase of CASES) {
        const row = plural?.[kase]

        if (!row) {
            continue
        }

        if (row.length === 1) {
            push(`pl.${kase}`, row[0])
            continue
        }

        row.forEach((text, i) => {
            if (typeof text !== 'string') {
                return
            }

            if (i === 0) {
                pushMasculine(push, `pl.${kase}.m`, text)
            } else {
                push(`pl.${kase}.f/n`, text)
            }
        })
    }
}

function nounLikeCells(push, table) {
    table.columns.forEach((column, i) => {
        const prefix = COLUMN_KEYS[column] ?? column

        for (const kase of CASES) {
            push(prefix ? `${prefix}.${kase}` : kase, table.cases[kase]?.[i])
        }
    })
}

// "pišųćí (pišųćá, pišųćé)", "učęćí (učęćá, učęćé) sę", "dělajemý (-á, -œ), dělamý (-á, -œ)"
function parseParticiple(text) {
    if (!text) {
        return null
    }

    const genders = { m: [], f: [], n: [] }
    const pattern = /([^(),]+?) \(([^(),]+), ([^()]+)\)( sę)?(?:, |$)/g

    for (const [, masculine, feminine, neuter, reflexive = ''] of text.matchAll(pattern)) {
        const stem = masculine.trim()
        const full = (form) => (form.startsWith('-') ? stem.slice(0, -1) + form.slice(1) : form)

        genders.m.push(stem + reflexive)
        genders.f.push(full(feminine.trim()) + reflexive)
        genders.n.push(full(neuter.trim()) + reflexive)
    }

    return genders.m.length ? genders : null
}

function verbCells(table) {
    const { cells, push } = collector()
    // `byti` is the auxiliary of every compound tense, so only for it those words are its own forms
    const isByti = table.future[0].trim() === 'bųdų'
    const withoutAuxiliary = (text) => (text ?? '').replace(/^\([^)]*\)\s*/, '')

    push('infinitive', table.infinitive)
    PERSONS.forEach((person, i) => push(`present.${person}`, table.present[i], { alternatives: true }))
    PERSONS.forEach((person, i) => push(`imperfect.${person}`, table.imperfect[i]))
    PERSONS.forEach((person, i) => push(`future.${person}`, table.future[i], { index: isByti }))

    for (const tense of ['perfect', 'pluperfect', 'conditional']) {
        PERSONS_BY_GENDER.forEach((person, i) => push(`${tense}.${person}`, table[tense][i], { index: false }))
    }

    if (isByti) {
        [0, 1, 2, 5, 6, 7].forEach((source, i) => {
            push(`conditionalAuxiliary.${PERSONS[i]}`, table.conditional[source]?.split(' ')[0])
        })
    }

    table.imperative.split(', ').forEach((form, i) => push(`imperative.${['2sg', '1pl', '2pl'][i]}`, form))

    push('lParticiple.m', withoutAuxiliary(table.perfect[2]))
    push('lParticiple.f', withoutAuxiliary(table.perfect[3]))
    push('lParticiple.n', withoutAuxiliary(table.perfect[4]))
    push('lParticiple.pl', withoutAuxiliary(table.perfect[7]))

    for (const [key, name] of PARTICIPLES) {
        const genders = parseParticiple(table[key])

        if (genders) {
            for (const gender of ['m', 'f', 'n']) {
                push(`participle.${name}.${gender}`, genders[gender].join(' / '))
            }
        }
    }

    push('verbalNoun', table.gerund)

    return cells
}

function nounParadigms(tag, pos, lemma, hint) {
    if (lemma.includes(' ')) {
        return []
    }

    const genders = pos.gender === 'masculineOrFeminine' ? ['masculine', 'feminine'] : [undefined]
    const list = []

    for (const gender of genders) {
        const table = attempt(() => declensionNounSimple(lemma, tag, hint, gender))

        if (table) {
            list.push({ lemma, kind: 'noun', gender, searchable: true, cells: nounCells(table, pos.indeclinable) })
        }
    }

    // a masculine-or-feminine noun that declines the same way in both genders needs one table
    if (list.length === 2 && JSON.stringify(list[0].cells) === JSON.stringify(list[1].cells)) {
        return [{ ...list[0], gender: undefined }]
    }

    return list
}

// `derivedKind` of a participle: it has no comparison and no adverb, and an active one no short
// form either ("pisan" is a word, "pišųć" is not)
function adjectiveParadigms(tag, lemma, derivedKind = '') {
    const table = attempt(() => declensionAdjective(lemma, '', tag))

    if (!table) {
        return []
    }

    const { cells, push } = collector()
    const { positive = [], comparative = [], superlative = [] } = table.comparison ?? {}

    adjectiveCells(push, table.singular, table.plural)

    if (derivedKind.endsWith('participle')) {
        if (derivedKind.includes('passive')) {
            push('short', table.short)
        }

        return [{ lemma, kind: 'adjective', searchable: true, cells }]
    }

    push('short', table.short)
    push('adverb', positive[1], { alternatives: true })
    push('comparative.adj', comparative[0], { alternatives: true })
    push('comparative.adv', comparative[1], { alternatives: true })
    push('superlative.adj', superlative[0], { alternatives: true })
    push('superlative.adv', superlative[1], { alternatives: true })

    return [{ lemma, kind: 'adjective', searchable: true, cells }]
}

function verbParadigms(tag, lemma, hint) {
    const table = attempt(() => conjugationVerb(lemma, hint, tag))

    // for something that is not an infinitive the library returns strings with "ERROR" inside
    if (!table || JSON.stringify(table).includes('ERROR')) {
        return []
    }

    const words = lemma.replace(/^ne /, '').split(' ')
    const isPhrase = words.length > 2 || (words.length === 2 && !/^s[ęe]$/.test(words[1]))
    const paradigm = { lemma, kind: 'verb', searchable: !isPhrase, cells: verbCells(table) }

    if (isPhrase) {
        // the library conjugates the first word and silently drops the rest
        paradigm.note = `phrase: only the verb "${words[0]}" is conjugated, the other words stay as they are`
    }

    return [paradigm]
}

function numeralOrPronounParadigms(pos, lemma) {
    const decline = pos.name === 'numeral' ? declensionNumeral : declensionPronoun
    const table = attempt(() => decline(lemma, pos.type))

    if (!table) {
        return []
    }

    const { cells, push } = collector()

    if (table.type === 'noun') {
        nounLikeCells(push, table)
    } else {
        adjectiveCells(push, table.casesSingular, table.casesPlural)
    }

    return [{ lemma, kind: pos.name, searchable: true, cells }]
}

// "djabȯl, djavȯl (djabla, djavla)": one hint per headword variant. Otherwise every variant gets
// the whole addition ("žrti, žrěti (žre)").
function hintsFor(addition, count) {
    const hint = inflectionHint(addition)
    const parts = hint.replace(/[()]/g, '').split(',').map((part) => part.trim())

    if (count > 1 && parts.length === count && !hint.includes(';')) {
        return parts.map((part) => `(${part})`)
    }

    return Array(count).fill(hint)
}

/**
 * All paradigms of an entry: one per headword variant (two for a masculine-or-feminine noun).
 * @returns {{list: Paradigm[], note?: string}}
 */
export function paradigms(entry) {
    const pos = safeParsePos(entry.pos)

    if (!pos) {
        return { list: [], note: 'unknown part of speech' }
    }

    if (!INFLECTED.has(pos.name)) {
        return { list: [], note: `${pos.name}: not inflected` }
    }

    const variants = lemmaVariants(entry.isv)
    const hints = hintsFor(entry.addition, variants.length)
    const list = []
    const seen = new Set()

    variants.forEach((lemma, i) => {
        let built

        switch (pos.name) {
            case 'noun':
                built = nounParadigms(entry.pos, pos, lemma, hints[i])
                break
            case 'adjective':
                built = adjectiveParadigms(entry.pos, lemma, entry.derived?.kind)
                break
            case 'verb':
                built = verbParadigms(entry.pos, lemma, hints[i])
                break
            default:
                built = numeralOrPronounParadigms(pos, lemma)
        }

        for (const paradigm of built) {
            // "je, jest" are two headwords with one and the same table
            const signature = JSON.stringify([paradigm.gender, paradigm.cells])

            if (paradigm.cells.length && !seen.has(signature)) {
                seen.add(signature)
                list.push(paradigm)
            }
        }
    })

    if (!list.length) {
        const isPhrase = variants.every((variant) => variant.includes(' '))

        return { list, note: isPhrase ? 'multi-word expression: forms are not generated' : 'forms are not available for this word' }
    }

    return { list }
}

// What is derived from a verb: the cell of its table that gives the lemma, the part of speech of
// the new entry and the part of its id that keeps entries of different kinds apart.
const DERIVED_KINDS = [
    { kind: 'verbal noun', slot: 'verbalNoun', pos: 'n.', idBase: 0 },
    { kind: 'present active participle', slot: 'participle.presentActive.m', pos: 'adj.', idBase: 1e6 },
    { kind: 'present passive participle', slot: 'participle.presentPassive.m', pos: 'adj.', idBase: 2e6 },
    { kind: 'past active participle', slot: 'participle.pastActive.m', pos: 'adj.', idBase: 3e6 },
    { kind: 'past passive participle', slot: 'participle.pastPassive.m', pos: 'adj.', idBase: 4e6 },
]

/**
 * Entries the dictionary does not have but the declension library implies: the verbal noun and the
 * participles of every verb ("zakryti" → "zakryťje", "zakryty", "zakryvši"), unless the dictionary
 * already has that word as a noun or an adjective. Homonymous verbs and "učiti" / "učiti sę" share
 * their derived words, so one entry may come from several verbs.
 *
 * A derived entry has a negative id (its first verb's id, plus a million times the place of its
 * kind in DERIVED_KINDS), no translations of its own and `derived: {kind, from: [{id, isv}]}`;
 * otherwise it is an ordinary entry.
 * @param {import('./data.js').Entry[]} entries
 * @returns {import('./data.js').Entry[]}
 */
export function derivedEntries(entries) {
    const existing = new Set()

    for (const entry of entries) {
        if (['noun', 'adjective'].includes(safeParsePos(entry.pos)?.name)) {
            lemmaVariants(entry.isv).forEach((variant) => existing.add(isvStd(variant)))
        }
    }

    // a group of verbs and the words of one kind derived from them; groups that share a word are
    // merged, so that "ogluhnuti, oglušeti" and "oglušiti" give one entry "ogluhnutje, oglušenje"
    const groupOf = new Map() // kind + isvStd of a word → its group

    for (const entry of entries) {
        if (entry.removed || safeParsePos(entry.pos)?.name !== 'verb') {
            continue
        }

        // "iměti pravdų": the library builds the forms of "iměti" alone
        const tables = paradigms(entry).list.filter((paradigm) => paradigm.searchable)

        for (const derived of DERIVED_KINDS) {
            // "vladati, vlåděti" has two verbal nouns, written as headword variants the way the sheet
            // does; "dělajemy / dělamy" are two participles of one verb
            const variants = new Map()

            for (const paradigm of tables) {
                const text = paradigm.cells.find((cell) => cell.slot === derived.slot)?.text ?? ''

                for (const form of text.split(' / ')) {
                    // a reflexive participle "učęći sę" declines without its "sę"
                    const lemma = toScript(form.replace(/ s[ęe]$/, ''), 'etymological')

                    if (lemma && !lemma.includes(' ') && !existing.has(isvStd(lemma))) {
                        variants.set(`${derived.kind}:${isvStd(lemma)}`, lemma)
                    }
                }
            }

            if (!variants.size) {
                continue
            }

            const [group, ...others] = new Set([...variants.keys()].map((key) => groupOf.get(key)).filter(Boolean))
            const target = group ?? { derived, variants: new Map(), verbs: [] }

            for (const other of others) {
                other.variants.forEach((lemma, key) => target.variants.set(key, lemma))
                target.verbs.push(...other.verbs)
            }

            variants.forEach((lemma, key) => target.variants.set(key, lemma))

            if (!target.verbs.some((verb) => verb.id === entry.id)) {
                target.verbs.push({ id: entry.id, isv: entry.isv })
            }

            target.variants.forEach((lemma, key) => groupOf.set(key, target))
        }
    }

    return [...new Set(groupOf.values())].map(({ derived, variants, verbs }) => {
        const from = verbs.sort((a, b) => a.id - b.id)

        return {
            id: -(derived.idBase + from[0].id),
            isv: [...variants.values()].join(', '),
            removed: false,
            addition: '',
            pos: derived.pos,
            type: '',
            frequency: null,
            intelligibility: '',
            tr: {},
            derived: { kind: derived.kind, from },
        }
    }).sort((a, b) => b.id - a.id)
}

/**
 * The single forms written in a cell: "mene (mę)" → mene, mę; "(n)jego (go)" → jego, njego, go;
 * "slova / slovesa" → slova, slovesa.
 */
export function expandForms(text) {
    const forms = []

    for (const alternative of text.split(/ \/ |, |\//)) {
        const trimmed = alternative.trim()

        if (!trimmed || trimmed.startsWith('-')) {
            continue
        }

        const withShortForm = /^(.*\S)\s+\(([^()]+)\)$/.exec(trimmed)

        for (const part of withShortForm ? [withShortForm[1], withShortForm[2]] : [trimmed]) {
            if (part.startsWith('(n)')) {
                forms.push(part.slice(3), `n${part.slice(3)}`)
            } else {
                forms.push(part.replace(/[()]/g, ''))
            }
        }
    }

    return forms
}

// "učų sę" is also findable as "učų", "ne ljubjų" as "ljubjų"
function withBareForm(form) {
    const bare = form.replace(/^ne /, '').replace(/ s[ęe]$/, '')

    return bare && bare !== form ? [form, bare] : [form]
}

function* searchableCells(list) {
    for (const paradigm of list) {
        if (!paradigm.searchable) {
            continue
        }

        for (const cell of paradigm.cells) {
            if (!cell.index) {
                continue
            }

            for (const expanded of expandForms(cell.text)) {
                // analytic "bolje slovjansky" is not a word form of "slovjansky"
                if (expanded.includes(' ') && !paradigm.lemma.includes(' ')) {
                    continue
                }

                for (const form of withBareForm(expanded)) {
                    yield { slot: cell.slot, form: toScript(form, 'etymological') }
                }
            }
        }
    }
}

/** Every searchable word form of the paradigms (etymological Latin), for the index. */
export function searchableForms(list) {
    const forms = new Set()

    for (const { form } of searchableCells(list)) {
        forms.add(form)
    }

    return forms
}

/**
 * Which paradigm slots the query is a form of: `psa` → `sg.acc`, `sg.gen`.
 *
 * `exact` tells whether it matched as typed. Only then are look-alikes left out: `slugy` is the
 * genitive singular of `sluga` and not its nominative plural `slugi`. Without an exact match the
 * slots of the forms that differ in diacritics or `y`/`i` are returned.
 */
export function matchSlots(list, query) {
    const key = isvKey(query)
    const std = isvStd(query)
    const exactSlots = new Set()
    const looseSlots = new Set()

    for (const { slot, form } of searchableCells(list)) {
        if (isvKey(form) === key) {
            (isvStd(form) === std ? exactSlots : looseSlots).add(slot)
        }
    }

    return exactSlots.size ? { slots: [...exactSlots], exact: true } : { slots: [...looseSlots], exact: false }
}

function setPath(target, path, value) {
    let node = target

    path.slice(0, -1).forEach((key) => {
        if (typeof node[key] !== 'object' || node[key] === null) {
            node[key] = {}
        }

        node = node[key]
    })
    node[path.at(-1)] = value
}

/** A paradigm as nested, self-describing JSON in the requested script. */
export function renderParadigm(paradigm, script = 'latin') {
    const rendered = { lemma: toScript(paradigm.lemma, script) }

    if (paradigm.gender) {
        rendered.gender = paradigm.gender
    }

    if (paradigm.note) {
        rendered.note = paradigm.note
    }

    for (const cell of paradigm.cells) {
        const text = toScript(cell.text, script)

        setPath(rendered, cell.slot.split('.'), cell.alternatives ? text.replace(/, /g, ' / ') : text)
    }

    return rendered
}
