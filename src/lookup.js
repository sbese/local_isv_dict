// The two handlers behind every interface (CLI, HTTP, MCP):
//   lookup — words in any language → Interslavic dictionary entries
//   forms  — Interslavic words → all their inflected forms

import { KIND, reflexiveHead } from './dict.js'
import { matchSlots, paradigms, renderParadigm } from './forms.js'
import {
    LANGS,
    LANG_NAMES,
    MIN_LANGS,
    SCRIPTS,
    describePos,
    exactKey,
    fold,
    governedCase,
    isvKey,
    isvStd,
    lemmaVariants,
    splitVariants,
    srLatinToCyrillic,
    stripBrackets,
    toScript,
} from './text.js'

const MAX_WORDS = 100
const MAX_MATCHES = 50
const DEFAULT_LIMIT = 5
const LANG_PRESETS = ['all', 'verified', 'min']

// The `type` column of the sheet (see ITranslateResult in the web app's src/services/dictionary.ts).
const LEVELS = {
    1: 'universally intelligible',
    2: 'predominantly intelligible',
    3: 'regionally intelligible',
    4: 'Church Slavonic',
    5: 'neologism',
    9: 'doubtful',
}

// Match quality, best first. "Folded" = equal only when diacritics (and y/i in Interslavic) are ignored.
const SCORE = {
    exact: 0,
    reflexiveHead: 1,
    form: 2,
    exactUnverified: 3,
    folded: 4,
    foldedForm: 5,
    foldedUnverified: 6,
    phrase: 7,
    phraseUnverified: 8,
}

// Full entries are returned only for the best kind of match a word has; weaker kinds are merely
// listed:
//   0  the word itself: an Interslavic headword or a verified translation
//   1  plausible but uncertain: an Interslavic word form the text happens to spell ("жить" reads
//      as "žit", a form of žito), or an unverified machine translation
//   2  look-alikes that differ in diacritics
//   3  the word inside a longer expression
const tier = (score) => {
    if (score <= SCORE.reflexiveHead) {
        return 0
    }

    if (score <= SCORE.exactUnverified) {
        return 1
    }

    return score <= SCORE.foldedUnverified ? 2 : 3
}

const NOT_FOUND = {
    lookup: 'not found — pass the dictionary form (lemma): nominative singular for nouns and adjectives, '
        + 'the infinitive for verbs; or try a synonym',
    forms: 'not found among Interslavic words and their forms — find the Interslavic word with a lookup first '
        + '(or pass id:<number> from its result)',
}

/** A mistake in the request (bad option value, no words) as opposed to an internal failure. */
export class UsageError extends Error {}

export const PARAMETERS = {
    words: 'Words or short phrases to look up. `id:123` fetches the entry with that id.',
    langs: 'Which translations to show: "all" (default — every language that has one; unverified machine '
        + 'translations keep a leading "!"), "verified" (only translations checked by a human), "min" (English, '
        + 'Russian, Polish plus the language the word was found through), or a comma-separated list of codes: '
        + `${LANGS.join(' ')}.`,
    forms: 'Also return all inflected forms of every entry (default: false).',
    from: 'Search only in these languages: comma-separated codes as in `langs`, plus "isv" for Interslavic '
        + 'itself. Default: all of them. Worth setting when you know the language of the words: it removes '
        + 'look-alike words of other languages.',
    script: 'Script for Interslavic words: "latin" (standard orthography, default), "cyrillic" or '
        + '"etymological" (the dictionary\'s own extended Latin).',
    limit: `How many entries per word are returned in full (default ${DEFAULT_LIMIT}); the rest are only listed.`,
}

export const LOOKUP_DESCRIPTION = `Look up words in the Interslavic (Medžuslovjansky) dictionary.

Takes words or short phrases in ANY language — English, Russian, Polish, Czech, Serbian and so on, or Interslavic itself; the language is not specified — and returns every dictionary entry each word may correspond to: the Interslavic word, its part of speech and grammar notes, how widely it is understood, and its translations into other languages. Compare the translations to pick the entry with the meaning you need.

Pass dictionary forms (lemmas): nominative singular for nouns and adjectives, the infinitive for verbs. Inflected forms are recognised only for Interslavic words; an inflected form in another language is simply not found. The same spelling often exists in several languages with different meanings, so when you know the language of your words, name it in "from".

Reading the result:
- queries[].matches — all entries found for that word, best first. "via" tells how each one matched: a language code ("ru"); "!" after the code = found through an unverified machine translation; "~" = matched only when diacritics are ignored; "isv" = the Interslavic headword itself; "isv form: sg.gen" = an inflected Interslavic form; "ru phrase" = the word only occurs inside a longer expression in that language.
- entries — the full entries, each listed once: up to "limit" per word, and only for the best kind of match that word has. Every other match is listed with its part of speech and English meaning and can be fetched by passing "id:<number>" as a word.
- An entry with a negative id and a "derived" field is not in the dictionary: it is a word built from another entry (the verbal noun of a verb) so that its forms can be found. It has no translations; its meaning follows from the entry it was built from.
- In "translations" a leading "!" marks an unverified machine translation. "level" is how widely the word is understood, "intelligibility" lists languages (+ understood, ~ partly, - not), "governs" is the case the word requires.

To keep the answer small use "langs" (for example "min"), and leave "forms" off: get the forms afterwards, only for the entries you chose.`

export const FORMS_DESCRIPTION = `Return all inflected forms of Interslavic (Medžuslovjansky) words: declension of nouns, adjectives, pronouns and numerals in every case, singular and plural; conjugation of verbs — present, imperfect, future, perfect, pluperfect, conditional, imperative, participles and the verbal noun.

Pass Interslavic words in Latin or Cyrillic — the dictionary form or any inflected form — or "id:<number>" taken from a lookup result (the most precise way). When several dictionary entries are spelled the same, all of them are returned with their part of speech and English meaning. Verbal nouns the dictionary has no entry for ("zakrytje" from "zakryti") come as entries with a negative id and a "derived" field naming the verb, and decline like any other noun.

Reading the forms: the keys describe themselves — "sg.gen" is genitive singular, "present.1sg" first person singular, "pl.nom.m.anim" nominative plural masculine animate, "m/n" a form shared by masculine and neuter. " / " separates alternative forms; "(x)" after a pronoun form is its short form; a leading "(n)" is added after prepositions; "pisal(a)" means the feminine adds -a; an auxiliary in brackets, "(je)", may be left out.`

// "en, ru", ["en", "ru"] and ["en,ru"] are the same list
function toList(value) {
    return (Array.isArray(value) ? value : [value ?? ''])
        .flatMap((item) => String(item ?? '').split(/[,\s]+/))
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
}

function parseLangs(value) {
    const items = toList(value)

    if (!items.length) {
        return { preset: 'all' }
    }

    if (items.length === 1 && LANG_PRESETS.includes(items[0])) {
        return { preset: items[0] }
    }

    const unknown = items.filter((item) => !LANGS.includes(item))

    if (unknown.length) {
        throw new UsageError(`Unknown value in "langs": ${unknown.join(', ')}. Use all, verified, min or codes: ${LANGS.join(', ')}`)
    }

    return { list: LANGS.filter((lang) => items.includes(lang)) }
}

function parseFrom(value) {
    const items = toList(value)

    if (!items.length || items.includes('all')) {
        return null
    }

    const unknown = items.filter((item) => item !== 'isv' && !LANGS.includes(item))

    if (unknown.length) {
        throw new UsageError(`Unknown language in "from": ${unknown.join(', ')}. Use isv or: ${LANGS.join(', ')}`)
    }

    return new Set(items)
}

function parseBoolean(name, value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback
    }

    if (typeof value === 'boolean') {
        return value
    }

    const text = String(value).toLowerCase()

    if (['true', '1', 'yes', 'on'].includes(text)) {
        return true
    }

    if (['false', '0', 'no', 'off'].includes(text)) {
        return false
    }

    throw new UsageError(`"${name}" must be true or false`)
}

function parseInteger(name, value, fallback, min, max) {
    if (value === undefined || value === null || value === '') {
        return fallback
    }

    const number = typeof value === 'boolean' ? NaN : Number(value)

    if (!Number.isInteger(number) || number < min || number > max) {
        throw new UsageError(`"${name}" must be a whole number from ${min} to ${max}`)
    }

    return number
}

/** Accepts option values as they arrive from any interface (typed or as strings). */
export function normalizeOptions(raw) {
    const options = raw ?? {}
    const script = String(options.script || 'latin').toLowerCase()

    if (!SCRIPTS.includes(script)) {
        throw new UsageError(`"script" must be one of: ${SCRIPTS.join(', ')}`)
    }

    return {
        langs: parseLangs(options.langs),
        forms: parseBoolean('forms', options.forms, false),
        from: parseFrom(options.from),
        script,
        limit: parseInteger('limit', options.limit, DEFAULT_LIMIT, 1, MAX_MATCHES),
        maxChars: parseInteger('maxChars', options.maxChars, 0, 0, 10_000_000),
    }
}

/** `"собака, дом"` or `["собака", "дом; pes"]` → `["собака", "дом", "pes"]`. */
export function splitWords(words) {
    const list = Array.isArray(words) ? words : [words ?? '']

    if (list.some((item) => typeof item !== 'string' && typeof item !== 'number')) {
        throw new UsageError('"words" must be a string or a list of strings')
    }

    const items = list
        .flatMap((item) => String(item).split(/[,;\n]+/))
        .map((item) => item.normalize('NFC').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    const unique = [...new Set(items)]

    if (!unique.length) {
        throw new UsageError('No words given')
    }

    if (unique.length > MAX_WORDS) {
        throw new UsageError(`Too many words: ${unique.length}; the limit is ${MAX_WORDS} per request`)
    }

    return unique
}

// Order of the `type` column for ranking, as in the web app: unknown and neologisms count as 2,
// Church Slavonic as regional.
function typeRank(type) {
    const rank = Number.parseInt(type, 10)

    if (Number.isNaN(rank) || rank === 5) {
        return 2
    }

    return rank === 4 ? 3 : rank
}

// Which of several equally exact matches is more likely the one meant, when the language of the
// word is unknown: the entry that more languages agree on ("час" is časina in four of them), the
// more common word ("знать" is rather znati than šljahta) and the more widely understood one.
// A language weighs as much as 3500 points of the sheet's frequency score, which goes up to 11000.
const relevance = (match, entry) => match.agree + (entry.frequency ?? 0) / 3500 - (typeRank(entry.type) - 1) / 2

/**
 * Everything one query matches, best first.
 * @returns {{row: number, score: number, headword: boolean, agree: number, via: string[], langs: Set<string>}[]}
 */
function findMatches(dict, rawQuery, { from, isvOnly }) {
    const byId = /^id:\s*(-?\d+)$/i.exec(rawQuery)

    if (byId) {
        const row = dict.rowById.get(Number(byId[1]))
        const match = { row, score: SCORE.exact, headword: false, agree: 0, via: ['id'], langs: new Set() }

        return row === undefined ? [] : [match]
    }

    // Remarks in brackets are not part of the indexed words, so "podhoditi (k)" — the way the
    // headword is displayed — is looked up as "podhoditi".
    const query = stripBrackets(rawQuery) || rawQuery

    // "-", "???" — nothing to look up
    if (!/[\p{L}\p{N}]/u.test(query)) {
        return []
    }

    const hits = new Map()
    const hit = (row, score, tag, lang) => {
        let match = hits.get(row)

        if (!match) {
            match = { row, score, headword: false, agree: 0, via: [], langs: new Set() }
            hits.set(row, match)
        }

        match.score = Math.min(match.score, score)

        if (match.via.includes(tag)) {
            return
        }

        match.via.push(tag)

        if (lang) {
            match.langs.add(lang)
            match.agree += score === SCORE.exact ? 1 : 0
        } else if (score === SCORE.exact) {
            match.headword = true
        }
    }
    const allowed = (lang) => !from || from.has(lang)
    const searchIsv = allowed('isv')
    const searchTranslations = !isvOnly

    if (searchIsv) {
        const std = isvStd(query)

        for (const posting of dict.isv.get(isvKey(query)) ?? []) {
            const row = posting >> 2
            const kind = posting & 3
            const entry = dict.entries[row]
            const reflexive = kind === KIND.reflexiveHead ? ' (verb without sę)' : ''

            if (kind !== KIND.form) {
                const variants = lemmaVariants(entry.isv)
                const candidates = reflexive ? variants.map(reflexiveHead).filter(Boolean) : variants

                if (candidates.some((candidate) => isvStd(candidate) === std)) {
                    hit(row, reflexive ? SCORE.reflexiveHead : SCORE.exact, `isv${reflexive}`)
                    continue
                }
            }

            // Not the headword as typed. The key ignores diacritics and y/i, so "dobri" lands on
            // "dobry": it may be exactly one of its forms (nominative plural) or just a look-alike.
            const { slots, exact } = matchSlots(paradigms(entry).list, query)

            if (exact) {
                hit(row, SCORE.form, `isv form: ${slots.join(', ')}`)
            } else if (kind === KIND.form) {
                hit(row, SCORE.foldedForm, `isv~ form${slots.length ? `: ${slots.join(', ')}` : ''}`)
            } else {
                hit(row, SCORE.folded, `isv~${reflexive}`)
            }
        }
    }

    const translationHits = (text, onlyLang) => {
        const exactText = exactKey(text)

        for (const posting of dict.tr.get(fold(text)) ?? []) {
            const row = posting >> 5
            const lang = LANGS[posting & 31]

            if (!allowed(lang) || (onlyLang && lang !== onlyLang)) {
                continue
            }

            const { variants, unverified } = splitVariants(dict.entries[row].tr[lang])
            const exact = variants.some((variant) => exactKey(variant) === exactText)
            const score = exact
                ? (unverified ? SCORE.exactUnverified : SCORE.exact)
                : (unverified ? SCORE.foldedUnverified : SCORE.folded)

            hit(row, score, `${lang}${unverified ? '!' : ''}${exact ? '' : '~'}`, lang)
        }
    }

    if (searchTranslations) {
        translationHits(query)

        // Serbian is stored in Cyrillic but is just as often typed in Latin
        for (const serbian of srLatinToCyrillic(query)) {
            translationHits(serbian, 'sr')
        }
    }

    // nothing matched as a whole: look for the word inside multi-word translations and headwords
    if (!hits.size && searchTranslations) {
        const phrases = dict.phrases()
        const key = fold(query)

        if (searchIsv) {
            for (const row of phrases.isv.get(isvKey(query)) ?? []) {
                hit(row, SCORE.phrase, 'isv phrase')
            }
        }

        for (const posting of phrases.tr.get(key) ?? []) {
            const row = posting >> 5
            const lang = LANGS[posting & 31]

            if (!allowed(lang)) {
                continue
            }

            const unverified = dict.entries[row].tr[lang].startsWith('!')

            hit(row, unverified ? SCORE.phraseUnverified : SCORE.phrase, `${lang}${unverified ? '!' : ''} phrase`, lang)
        }
    }

    // Equally good matches: the Interslavic headword itself first, then by relevance.
    return [...hits.values()].sort((a, b) => {
        const entryA = dict.entries[a.row]
        const entryB = dict.entries[b.row]

        return a.score - b.score
            || Number(b.headword) - Number(a.headword)
            || relevance(b, entryB) - relevance(a, entryA)
            || entryA.id - entryB.id
    })
}

function pickTranslations(entry, langs, matchedLangs) {
    let codes

    if (langs.list) {
        codes = langs.list
    } else if (langs.preset === 'min') {
        codes = LANGS.filter((lang) => MIN_LANGS.includes(lang) || matchedLangs.has(lang))
    } else {
        codes = LANGS
    }

    const translations = {}

    for (const lang of codes) {
        const cell = entry.tr[lang]

        if (cell && !(langs.preset === 'verified' && cell.startsWith('!'))) {
            translations[lang] = cell
        }
    }

    return translations
}

// "verbal noun of zakryti (id 20310)": a derived entry has no meaning of its own but its source's
function renderDerived(entry, script) {
    const sources = entry.derived.from.map((source) => `${toScript(source.isv, script)} (id ${source.id})`)

    return `${entry.derived.kind} of ${sources.join(', ')}; not a dictionary entry, built from the verb`
}

function renderEntry(entry, options, handler, matchedLangs) {
    const rendered = { id: entry.id, isv: toScript(entry.isv, options.script) }
    const posInfo = describePos(entry.pos)
    const governs = governedCase(entry.addition)

    if (entry.addition) {
        rendered.addition = toScript(entry.addition, options.script)
    }

    if (entry.pos) {
        rendered.pos = entry.pos
    }

    if (posInfo) {
        rendered.posInfo = posInfo
    }

    if (governs) {
        rendered.governs = governs
    }

    if (entry.derived) {
        rendered.derived = renderDerived(entry, options.script)
    }

    if (handler === 'forms') {
        if (entry.tr.en) {
            rendered.en = entry.tr.en
        }
    } else {
        if (LEVELS[entry.type]) {
            rendered.level = `${entry.type} ${LEVELS[entry.type]}`
        }

        if (entry.intelligibility) {
            rendered.intelligibility = entry.intelligibility
        }

        if (entry.frequency !== null) {
            rendered.frequency = entry.frequency
        }

        if (entry.removed) {
            rendered.status = 'suggested for removal from the dictionary'
        }

        if (!entry.derived) {
            rendered.translations = pickTranslations(entry, options.langs, matchedLangs)
        }
    }

    if (options.forms) {
        const { list, note } = paradigms(entry)

        if (list.length) {
            rendered.forms = list.map((paradigm) => renderParadigm(paradigm, options.script))
        }

        if (note) {
            rendered.formsNote = note
        }
    }

    return rendered
}

function run(dict, words, options, handler) {
    const queries = splitWords(words)
    const isvOnly = handler === 'forms'
    const included = new Map() // row → {rank, langs} of the entries returned in full
    const brief = new Map() // id → what a match says about itself when its entry is not in the answer
    const result = { queries: [], entries: [] }

    for (const query of queries) {
        const matches = findMatches(dict, query, { from: options.from, isvOnly })
        const listed = matches.slice(0, MAX_MATCHES)
        const bestTier = matches.length ? tier(matches[0].score) : 0
        const item = { query, matches: [] }

        listed.forEach((match, position) => {
            const entry = dict.entries[match.row]

            item.matches.push({ id: entry.id, isv: toScript(entry.isv, options.script), via: match.via })
            brief.set(entry.id, {
                pos: entry.pos,
                ...(entry.tr.en && { en: entry.tr.en }),
                ...(entry.derived && { derived: renderDerived(entry, options.script) }),
            })

            if (position < options.limit && tier(match.score) === bestTier) {
                const info = included.get(match.row) ?? { rank: position, langs: new Set() }

                info.rank = Math.min(info.rank, position)
                match.langs.forEach((lang) => info.langs.add(lang))
                included.set(match.row, info)
            }
        })

        if (matches.length > listed.length) {
            item.more = matches.length - listed.length
        }

        if (!matches.length) {
            item.note = NOT_FOUND[handler]
        }

        result.queries.push(item)
    }

    // identical paradigms (homonyms such as the two entries "byti") are printed once
    const formsOwner = new Map()

    for (const [row, info] of included) {
        const rendered = renderEntry(dict.entries[row], options, handler, info.langs)

        if (rendered.forms) {
            const signature = JSON.stringify(rendered.forms)

            if (formsOwner.has(signature)) {
                rendered.forms = { sameAs: formsOwner.get(signature) }
            } else {
                formsOwner.set(signature, rendered.id)
            }
        }

        result.entries.push(rendered)
    }

    // a match without a full entry still says what it is
    const full = new Set(result.entries.map((entry) => entry.id))

    for (const item of result.queries) {
        for (const match of item.matches) {
            if (!full.has(match.id)) {
                Object.assign(match, brief.get(match.id))
            }
        }
    }

    if (options.maxChars) {
        const ranks = new Map([...included].map(([row, info]) => [dict.entries[row].id, info.rank]))

        fitToSize(result, options.maxChars, ranks, brief)
    }

    return result
}

/**
 * Shrinks the result towards `maxChars` of JSON, the least useful parts first:
 * match lists down to ten per word → forms, then entries, of everything but each word's best
 * match → lists down to three → forms, then entries, of the best matches → lists down to one.
 * It stops as soon as the result fits, and never makes it longer.
 *
 * @param {{queries: object[], entries: object[], note?: string}} result changed in place
 * @param {number} maxChars
 * @param {Map<number, number>} ranks entry id → its best position among the matches of a word
 * @param {Map<number, object>} [brief] entry id → the fields its matches get when the entry is left out
 */
export function fitToSize(result, maxChars, ranks, brief = new Map()) {
    const size = () => JSON.stringify(result).length
    const original = JSON.stringify(result)

    if (original.length <= maxChars) {
        return
    }

    // least important first: a word's fifth match before its second, later words before earlier
    const position = new Map(result.entries.map((entry, index) => [entry.id, index]))
    const lowestFirst = [...result.entries].sort(
        (a, b) => ranks.get(b.id) - ranks.get(a.id) || position.get(b.id) - position.get(a.id),
    )
    const isBest = (entry) => ranks.get(entry.id) === 0
    const matchesOf = (id) => result.queries.flatMap((item) => item.matches.filter((match) => match.id === id))
    const withoutForms = new Set()
    const dropped = []
    let listsCut = false
    // the note is part of the answer, so it is kept up to date while measuring
    const updateNote = () => {
        const notes = []

        if (withoutForms.size) {
            notes.push(`forms left out for id ${[...withoutForms].join(', ')}`)
        }

        if (dropped.length) {
            notes.push(`entries left out for id ${dropped.join(', ')}`)
        }

        if (listsCut) {
            notes.push('long match lists cut ("more" is the number of matches not shown)')
        }

        result.note = `The answer was shortened to fit the size limit: ${notes.join('; ')}. `
            + 'Ask for what you need separately as id:<number>, or pass fewer words per request.'
    }
    const stripForms = (entry) => {
        if (!entry.forms) {
            return
        }

        if (!entry.forms.sameAs) {
            // entries that point here with `sameAs` keep the table: the first of them takes it over
            const [heir, ...others] = result.entries.filter((other) => other.forms?.sameAs === entry.id)

            if (heir) {
                heir.forms = entry.forms
                others.forEach((other) => {
                    other.forms = { sameAs: heir.id }
                })
            }
        }

        delete entry.forms
        withoutForms.add(entry.id)
        updateNote()
    }
    const remove = (entry) => {
        const index = result.entries.indexOf(entry)

        // cutting the lists may already have taken it out
        if (index < 0) {
            return
        }

        stripForms(entry)
        result.entries.splice(index, 1)
        withoutForms.delete(entry.id)
        dropped.push(entry.id)
        matchesOf(entry.id).forEach((match) => Object.assign(match, brief.get(entry.id)))
        updateNote()
    }
    // Leaving an entry out puts its part of speech and meaning into every match that points to it.
    // For a short entry matched by many words that costs more than it saves.
    const drop = (entry) => {
        const cost = matchesOf(entry.id).length * JSON.stringify(brief.get(entry.id) ?? {}).length

        if (JSON.stringify(entry).length > cost) {
            remove(entry)
        }
    }
    const cutLists = (count) => {
        const long = result.queries.filter((item) => item.matches.length > count)

        if (!long.length) {
            return
        }

        for (const item of long) {
            item.more = (item.more ?? 0) + item.matches.length - count
            item.matches.length = count
        }

        listsCut = true

        // an entry that no list mentions any more has nothing to hang on
        const listed = new Set(result.queries.flatMap((item) => item.matches.map((match) => match.id)))

        result.entries.filter((entry) => !listed.has(entry.id)).forEach(remove)
        updateNote()
    }
    const others = lowestFirst.filter((entry) => !isBest(entry))
    const best = lowestFirst.filter(isBest)
    const steps = [
        () => cutLists(10),
        ...others.map((entry) => () => stripForms(entry)),
        ...others.map((entry) => () => drop(entry)),
        () => cutLists(3),
        ...best.map((entry) => () => stripForms(entry)),
        ...best.map((entry) => () => drop(entry)),
        () => cutLists(1),
    ]

    for (const step of steps) {
        if (size() <= maxChars) {
            return
        }

        step()
    }

    // Nothing made it fit. What was cut may weigh less than the note about it — then the
    // untouched answer is the shorter one.
    if (size() > Math.max(maxChars, original.length)) {
        const { queries, entries } = JSON.parse(original)

        Object.assign(result, { queries, entries })
        delete result.note
    }
}

/**
 * Words in any language → Interslavic dictionary entries.
 * @param {import('./dict.js').Dict} dict
 * @param {string|string[]} words
 * @param {object} [options] see `PARAMETERS`
 */
export function lookup(dict, words, options) {
    return run(dict, words, normalizeOptions(options), 'lookup')
}

/**
 * Interslavic words (headwords, inflected forms or `id:N`) → all their inflected forms.
 * @param {import('./dict.js').Dict} dict
 * @param {string|string[]} words
 * @param {{script?: string, limit?: number, maxChars?: number}} [options]
 */
export function forms(dict, words, options) {
    const { script, limit, maxChars } = normalizeOptions({
        script: options?.script,
        limit: options?.limit,
        maxChars: options?.maxChars,
    })

    return run(dict, words, { script, limit, maxChars, forms: true, from: null, langs: { list: [] } }, 'forms')
}

/** What the `info` command and endpoint report. */
export function describeDict(dict) {
    const verified = {}

    for (const lang of LANGS) {
        const cells = dict.entries.filter((entry) => entry.tr[lang])
        const checked = cells.filter((entry) => !entry.tr[lang].startsWith('!'))

        verified[lang] = `${LANG_NAMES[lang]}: ${cells.length} translations, ${checked.length} verified`
    }

    return { ...dict.info, languages: verified }
}
