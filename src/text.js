// Language list, search-key normalisation and script conversion.
//
// The normalisation rules follow the Interslavic dictionary web app
// (https://github.com/sonic16x/interslavic, MIT): `searchPrepare` in src/services/dictionary.ts,
// src/utils/filterLatin, filterNiqqud, srGajevicaToVukovica, removeBrackets.

import utils from '@interslavic/utils'

const { transliterate, parsePos } = utils

/** Translation columns of the sheet, in output order. */
export const LANGS = [
    'en', 'ru', 'be', 'uk', 'pl', 'cs', 'sk', 'sl', 'hr', 'sr', 'mk', 'bg',
    'cu', 'de', 'nl', 'eo', 'csb', 'dsb', 'hsb', 'ia', 'es', 'pt', 'fr', 'it', 'he', 'da',
]

/** The `langs: "min"` preset (the language a match came through is always added). */
export const MIN_LANGS = ['en', 'ru', 'pl']

export const LANG_NAMES = {
    isv: 'Interslavic', en: 'English', ru: 'Russian', be: 'Belarusian', uk: 'Ukrainian', pl: 'Polish',
    cs: 'Czech', sk: 'Slovak', sl: 'Slovene', hr: 'Croatian', sr: 'Serbian', mk: 'Macedonian',
    bg: 'Bulgarian', cu: 'Old Church Slavonic', de: 'German', nl: 'Dutch', eo: 'Esperanto',
    csb: 'Kashubian', dsb: 'Lower Sorbian', hsb: 'Upper Sorbian', ia: 'Interlingua', es: 'Spanish',
    pt: 'Portuguese', fr: 'French', it: 'Italian', he: 'Hebrew', da: 'Danish',
}

export const SCRIPTS = ['latin', 'cyrillic', 'etymological']

const FOLD_MAP = { 'ł': 'l', 'đ': 'd', 'ß': 'ss', 'ё': 'е', 'ʼ': "'", '’': "'" }

// "Dobro jutro!" and "dobro jutro", "U.S.A." and "USA" are the same thing to look up; "|" marks
// morpheme boundaries in some Upper Sorbian translations.
const PUNCTUATION = /[!?.,…¡¿"«»„“”:;()[\]|]/g

/**
 * Unicode clean-up shared by every key: composed letters, no invisible characters (the sheet and
 * pasted text contain zero-width spaces and soft hyphens), one kind of dash.
 */
function tidy(text) {
    return text
        .normalize('NFC')
        .replace(/\p{Cc}/gu, ' ')
        .replace(/[\p{Cf}\p{Co}]/gu, '')
        .replace(/[\p{Pd}−]/gu, '-')
}

/**
 * Search key for a translation in any of the 26 languages: lower-case, Latin letters lose their
 * diacritics, `ё` → `е`, stress marks, niqqud and punctuation are dropped. Cyrillic `й`, `ї`, `ў`
 * stay intact.
 */
export function fold(text) {
    return tidy(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/([a-z])\p{Mn}+/gu, '$1')
        .normalize('NFC')
        .replace(/[łđßёʼ’]/g, (c) => FOLD_MAP[c])
        .replace(/\p{Mn}/gu, '')
        .replace(PUNCTUATION, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Comparison key for "typed exactly like this": only case, `ё`/`е`, apostrophe variants and
 * punctuation are ignored — diacritics are not.
 */
export function exactKey(text) {
    return tidy(text)
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[ʼ’]/g, "'")
        .replace(PUNCTUATION, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Interslavic text in any script or flavour → lower-case standard Latin without punctuation.
 *
 * Dictionary text and Latin input are taken letter for letter. Only Cyrillic input goes through
 * the library's forgiving mode: on Latin text that mode would also turn "ch" into "h", "sz" into
 * "š", drop "q" and foreign diacritics — and "chien" or "père" would pass for Interslavic words.
 */
export function isvStd(text) {
    const prepared = tidy(text).toLowerCase().replace(/\//g, ' ').replace(PUNCTUATION, '')
    const letterForLetter = !/\p{Script=Cyrillic}/u.test(prepared)

    return transliterate(prepared, 'isv-Latn', letterForLetter).replace(/\s+/g, ' ').trim()
}

/** Loose Interslavic search key: standard Latin without diacritics, `y` → `i`. */
export function isvKey(text) {
    return isvStd(text)
        .normalize('NFD')
        .replace(/\p{Mn}/gu, '')
        .replace(/ł/g, 'l')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/y/g, 'i')
        .replace(/\s+/g, ' ')
        .trim()
}

// Helper letters the declension library puts into generated forms (pisatì, pišųćí, pišemœ, dělaĵ).
const MARKERS = { 'ì': 'i', 'í': 'i', 'á': 'a', 'é': 'e', 'ó': 'o', 'œ': 'o', 'ý': 'y', 'ĵ': 'j' }

/** Dictionary / library text (etymological Latin) → the requested script. */
export function toScript(text, script = 'latin') {
    if (!text) {
        return text
    }

    switch (script) {
        case 'cyrillic':
            return transliterate(text, 'isv-Cyrl', true)
        case 'etymological':
            return text.normalize('NFC').replace(/[ìíáéóœýĵ]/g, (c) => MARKERS[c])
        default:
            return transliterate(text, 'isv-Latn', true)
    }
}

/** Removes `(...)` and `[...]` remarks, including nested ones. */
export function stripBrackets(text) {
    let result = text
    let previous

    do {
        previous = result
        result = result.replace(/\s*\([^()]*\)/g, '').replace(/\s*\[[^[\]]*\]/g, '')
    } while (result !== previous)

    return result.replace(/\s+/g, ' ').trim()
}

const pieces = (text, separator) => text.split(separator).map((piece) => piece.trim()).filter(Boolean)

/**
 * Splits a translation cell into its variants. `,` separates synonyms; when the cell contains `;`,
 * that is the separator instead (for translations with a comma inside). A leading `!` marks an
 * unverified (machine) translation.
 *
 * Editors do not follow the `;` rule strictly ("tradicionalan, uobičajen; uvriježen") and write
 * alternatives as "ale/pak/tola", so the comma- and slash-separated parts count as variants too.
 */
export function splitVariants(cell) {
    let text = tidy(cell ?? '').trim()
    const unverified = text.startsWith('!')

    if (unverified) {
        text = text.slice(1)
    }

    text = stripBrackets(text)

    const hasSemicolons = text.includes(';')
    const variants = new Set()

    for (const variant of pieces(text, hasSemicolons ? ';' : ',')) {
        variants.add(variant)

        if (hasSemicolons && variant.includes(',')) {
            pieces(variant, ',').forEach((piece) => variants.add(piece))
        }

        if (variant.includes('/') && !/\s/.test(variant)) {
            pieces(variant, '/').forEach((piece) => variants.add(piece))
        }
    }

    return { variants: [...variants], unverified }
}

/** Comma-separated variants of an Interslavic headword, without remarks. */
export function lemmaVariants(isv) {
    return pieces(stripBrackets(isv), ',')
}

const SR_DIGRAPHS = [['dž', 'џ'], ['lj', 'љ'], ['nj', 'њ']]
const SR_LETTERS = [
    ['a', 'а'], ['b', 'б'], ['c', 'ц'], ['č', 'ч'], ['ć', 'ћ'], ['d', 'д'], ['đ', 'ђ'], ['e', 'е'],
    ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'ј'], ['k', 'к'], ['l', 'л'], ['m', 'м'],
    ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['š', 'ш'], ['t', 'т'], ['u', 'у'],
    ['v', 'в'], ['z', 'з'], ['ž', 'ж'],
]
const replaceAll = (text, table) => table.reduce((result, [latin, cyrillic]) => result.replaceAll(latin, cyrillic), text)

/**
 * Serbian Latin (gajevica) → Cyrillic, lower-case. "nj" is usually њ but sometimes н + ј
 * (injekcija → инјекција), so every reading is returned; none when the text has no Latin letters.
 */
export function srLatinToCyrillic(text) {
    const source = tidy(text).toLowerCase()

    if (!/[a-zžčćšđ]/.test(source)) {
        return []
    }

    return [...new Set([replaceAll(replaceAll(source, SR_DIGRAPHS), SR_LETTERS), replaceAll(source, SR_LETTERS)])]
}

export function safeParsePos(tag) {
    try {
        return parsePos(tag)
    } catch {
        return null
    }
}

/** `m.anim.` → `noun, masculine, animate`. */
export function describePos(tag) {
    const pos = safeParsePos(tag)

    if (!pos) {
        return ''
    }

    const parts = [pos.name]

    switch (pos.name) {
        case 'noun':
            parts.push(pos.gender === 'masculineOrFeminine' ? 'masculine or feminine' : pos.gender)
            if (pos.masculine) {
                parts.push(pos.animate ? 'animate' : 'inanimate')
            }
            if (pos.indeclinable) {
                parts.push('indeclinable')
            }
            if (pos.plural) {
                parts.push('plural only')
            }
            if (pos.singular) {
                parts.push('singular only')
            }
            break
        case 'adjective':
            if (/\bcomp\b/.test(tag)) {
                parts.push('comparative degree')
            } else if (/\bsup\b/.test(tag)) {
                parts.push('superlative degree')
            }
            break
        case 'verb':
            if (pos.auxiliary) {
                parts.push('auxiliary')
            }
            if (pos.transitive) {
                parts.push('transitive')
            }
            if (pos.intransitive) {
                parts.push('intransitive')
            }
            if (pos.reflexive) {
                parts.push('reflexive')
            }
            if (pos.imperfective && pos.perfective) {
                parts.push('imperfective / perfective')
            } else if (pos.imperfective) {
                parts.push('imperfective')
            } else if (pos.perfective) {
                parts.push('perfective')
            }
            break
        case 'numeral':
        case 'pronoun':
            // a bare `num.` is reported as "cardinal" by the parser although nothing says so
            if (pos[pos.type]) {
                parts.push(pos.type)
            }
            break
    }

    return parts.join(', ')
}

const CASE_NAMES = ['', 'nominative', 'genitive', 'dative', 'accusative', 'instrumental', 'locative', 'vocative']

/** `(izběži) (+2)` → `genitive`: the case this word governs. */
export function governedCase(addition) {
    const match = /\(\+(\d)\)/.exec(addition ?? '')

    return (match && CASE_NAMES[Number(match[1])]) || null
}

/** The addition without the `(+N)` case marker — what the declension library expects. */
export function inflectionHint(addition) {
    return (addition ?? '').replace(/\(\+\d\)/g, '').replace(/\s+/g, ' ').trim()
}
