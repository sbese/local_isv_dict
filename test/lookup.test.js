import assert from 'node:assert/strict'
import { test } from 'node:test'

import { UsageError, fitToSize, forms, lookup, normalizeOptions, splitWords } from '../src/lookup.js'
import { fixtureDict } from './helpers.js'

const dict = fixtureDict()
const ids = (list) => list.map((item) => item.id)
const one = (words, options) => lookup(dict, words, options).queries[0]

test('splitWords accepts a string or a list and removes duplicates', () => {
    assert.deepEqual(splitWords('собака, дом;pes\n kot'), ['собака', 'дом', 'pes', 'kot'])
    assert.deepEqual(splitWords(['železna dråga', 'pes, kot', 'pes']), ['železna dråga', 'pes', 'kot'])
    assert.throws(() => splitWords(' , '), UsageError)
    assert.throws(() => splitWords(undefined), UsageError)
    assert.throws(() => splitWords([null]), UsageError)
    assert.throws(() => splitWords([{ word: 'pes' }]), UsageError)
})

test('normalizeOptions takes typed values and strings alike, and rejects nonsense', () => {
    assert.deepEqual(normalizeOptions(), { langs: { preset: 'all' }, forms: false, from: null, script: 'latin', limit: 5, maxChars: 0 })
    assert.deepEqual(normalizeOptions({ langs: 'min' }).langs, { preset: 'min' })
    assert.deepEqual(normalizeOptions({ langs: 'ru, en' }).langs, { list: ['en', 'ru'] })
    assert.deepEqual(normalizeOptions({ langs: ['pl', 'cs'] }).langs, { list: ['pl', 'cs'] })
    assert.equal(normalizeOptions({ forms: 'true' }).forms, true)
    assert.equal(normalizeOptions({ forms: '0' }).forms, false)
    assert.deepEqual([...normalizeOptions({ from: 'ru,isv' }).from], ['ru', 'isv'])
    assert.equal(normalizeOptions({ limit: '3' }).limit, 3)
    assert.throws(() => normalizeOptions({ langs: 'klingon' }), UsageError)
    assert.throws(() => normalizeOptions({ from: 'xx' }), UsageError)
    assert.throws(() => normalizeOptions({ script: 'runes' }), UsageError)
    assert.throws(() => normalizeOptions({ limit: 0 }), UsageError)
    assert.throws(() => normalizeOptions({ limit: true }), UsageError)
    assert.throws(() => normalizeOptions({ forms: 'maybe' }), UsageError)
    // empty values and a missing options object mean "the default"
    assert.deepEqual(normalizeOptions(null), normalizeOptions())
    assert.deepEqual(normalizeOptions({ script: '', langs: '', from: '', limit: '', forms: '' }), normalizeOptions())
    assert.deepEqual(normalizeOptions({ langs: ['en,ru'] }).langs, { list: ['en', 'ru'] })
})

test('a word is found through its translation; the entry carries info and all translations, no forms', () => {
    const result = lookup(dict, 'dog')
    const [pes] = result.entries

    assert.deepEqual(result.queries, [{ query: 'dog', matches: [{ id: 2345, isv: 'pes', via: ['en'] }] }])
    assert.equal(pes.isv, 'pes')
    assert.equal(pes.pos, 'm.anim.')
    assert.equal(pes.posInfo, 'noun, masculine, animate')
    assert.equal(pes.level, '1 universally intelligible')
    assert.match(pes.intelligibility, /ru\+/)
    assert.equal(typeof pes.frequency, 'number')
    assert.equal(pes.translations.ru, 'собака, пёс')
    assert.equal(pes.translations.fr, '!chien')
    assert.equal('forms' in pes, false)
})

test('langs chooses the translations: verified, min, or a list', () => {
    const verified = lookup(dict, 'dog', { langs: 'verified' }).entries[0].translations

    assert.equal(Object.values(verified).some((cell) => cell.startsWith('!')), false)
    assert.equal('es' in verified, true)
    assert.equal('fr' in verified, false)

    assert.deepEqual(Object.keys(lookup(dict, 'dog', { langs: 'min' }).entries[0].translations), ['en', 'ru', 'pl'])
    assert.deepEqual(Object.keys(lookup(dict, 'dog', { langs: 'cs,en' }).entries[0].translations), ['en', 'cs'])
})

test('"min" adds the languages the word was found through', () => {
    const { entries } = lookup(dict, 'час', { langs: 'min' })
    const keys = (id) => Object.keys(entries.find((entry) => entry.id === id).translations)

    assert.deepEqual(keys(4270), ['en', 'ru', 'be', 'uk', 'pl'])
    assert.deepEqual(keys(1278), ['en', 'ru', 'pl', 'sr', 'mk', 'bg'])
})

test('the same spelling in different languages leads to different entries, each attributed', () => {
    const cas = one('час')

    assert.deepEqual(cas.matches, [
        { id: 4270, isv: 'čas', via: ['isv', 'be', 'uk'] },
        { id: 1278, isv: 'časina', via: ['ru', 'sr', 'mk', 'bg'] },
    ])
    assert.deepEqual(one('час', { from: 'ru' }).matches, [{ id: 1278, isv: 'časina', via: ['ru'] }])
    assert.deepEqual(one('час', { from: 'isv' }).matches, [{ id: 4270, isv: 'čas', via: ['isv'] }])
    assert.deepEqual(ids(one('собака').matches), [2345, 36054])
})

test('ё/е and case do not matter, Serbian may be typed in Latin', () => {
    assert.deepEqual(one('ПЕС', { from: 'ru' }).matches[0].via, ['ru'])
    assert.deepEqual(one('bez', { from: 'sr' }).matches, [{ id: 1434, isv: 'bez', via: ['sr'] }])
})

test('a variant inside a semicolon-separated cell is found', () => {
    assert.deepEqual(one('хаця').matches, [{ id: 35331, isv: 'ačekoli', via: ['be'] }])
    assert.deepEqual(ids(one('although').matches), [35331])
})

test('matches that differ only in diacritics are marked with ~ and merely listed', () => {
    const result = lookup(dict, 'laska')

    assert.deepEqual(result.queries[0].matches, [
        { id: 32148, isv: 'laska', via: ['isv', 'pl~'] },
        { id: 23333, isv: 'milost', via: ['pl~'], pos: 'f.', en: 'grace, favour, favor' },
    ])
    assert.deepEqual(ids(result.entries), [32148])

    // typed with the Polish letter, the word is an exact match for both entries in Polish,
    // and only a look-alike of the Interslavic "laska"
    const polish = lookup(dict, 'łaska')

    assert.deepEqual(polish.queries[0].matches, [
        { id: 23333, isv: 'milost', via: ['pl'] },
        { id: 32148, isv: 'laska', via: ['isv~', 'pl'] },
    ])
    assert.deepEqual(ids(polish.entries), [23333, 32148])
})

test('y and i are different letters when typed exactly', () => {
    const byti = lookup(dict, 'byti', { from: 'isv' })

    assert.deepEqual(byti.queries[0].matches.map((match) => `${match.id} ${match.via}`), ['593 isv', '24896 isv', '4049 isv~'])
    assert.deepEqual(ids(byti.entries), [593, 24896])
    assert.deepEqual(ids(lookup(dict, 'biti', { from: 'isv' }).entries), [4049])
})

test('an inflected Interslavic form leads to its headword and names the slots', () => {
    assert.deepEqual(one('psa').matches, [{ id: 2345, isv: 'pes', via: ['isv form: sg.acc, sg.gen'] }])
    assert.deepEqual(one('пса').matches, [{ id: 2345, isv: 'pes', via: ['isv form: sg.acc, sg.gen'] }])
    assert.deepEqual(one('pišemo').matches[0], { id: 141, isv: 'pisati', via: ['isv form: present.1pl, participle.presentPassive.n'] })
})

test('a form that differs from its headword only in y/i is still reported as that form', () => {
    // "dobri" and "dobry" share a search key; "dobri" is the nominative plural, typed exactly
    assert.deepEqual(one('dobri', { from: 'isv' }).matches, [{ id: 1144, isv: 'dobry', via: ['isv form: pl.nom.m.anim'] }])
    assert.deepEqual(ids(forms(dict, 'dobri').entries), [1144])
})

test('remarks in brackets are ignored in a query, as they are in the dictionary', () => {
    assert.deepEqual(ids(one('uho [@]').matches), [36054])
    assert.deepEqual(ids(one('собака (символ)', { from: 'ru' }).matches), [2345, 36054])
})

test('a verb without "sę" also finds the reflexive verb', () => {
    const [plain, reflexive] = one('učiti').matches

    assert.equal(plain.id, 1526)
    assert.equal(plain.via[0], 'isv')
    assert.deepEqual(reflexive, { id: 1531, isv: 'učiti se', via: ['isv (verb without sę)'] })
})

test('a word that only occurs inside a longer expression is still found', () => {
    assert.deepEqual(one('железная').matches, [{ id: 394, isv: 'želěznica', via: ['ru phrase'] }])
    assert.equal(one('bomba').matches[0].via[0], 'isv phrase')
})

test('nothing found: an empty list and the hint about dictionary forms', () => {
    const result = lookup(dict, 'xyzzy, -, ???')

    for (const query of result.queries) {
        assert.deepEqual(query.matches, [])
        assert.match(query.note, /dictionary form \(lemma\)/)
    }

    assert.deepEqual(result.entries, [])
})

test('id:N fetches an entry directly', () => {
    const result = lookup(dict, 'id:141', { langs: 'en' })

    assert.deepEqual(result.queries[0].matches, [{ id: 141, isv: 'pisati', via: ['id'] }])
    assert.equal(result.entries[0].addition, '(piše)')
    assert.deepEqual(lookup(dict, 'ID: 141').queries[0].matches, [{ id: 141, isv: 'pisati', via: ['id'] }])
    assert.deepEqual(lookup(dict, 'id:999999').queries[0].matches, [])
    // without the colon it is an ordinary word
    assert.deepEqual(lookup(dict, 'id141').queries[0].matches, [])
})

test('several words: one list of matches per word, every entry printed once', () => {
    const result = lookup(dict, ['собака', 'dog, пёс'], { langs: 'min' })

    assert.deepEqual(result.queries.map((query) => query.query), ['собака', 'dog', 'пёс'])
    assert.deepEqual(ids(result.entries), [2345, 36054])
})

test('limit: the rest of the matches are listed with part of speech and meaning', () => {
    const result = lookup(dict, 'собака', { limit: 1 })

    assert.deepEqual(ids(result.entries), [2345])
    assert.deepEqual(result.queries[0].matches[1], { id: 36054, isv: 'uho, uško [@]', via: ['ru'], pos: 'n.', en: 'at sign [@]' })
})

test('extra information: governed case, removal mark, script', () => {
    const bez = lookup(dict, 'bez').entries[0]

    assert.equal(bez.addition, '(+2)')
    assert.equal(bez.governs, 'genitive')
    assert.equal(lookup(dict, 'črnica').entries[0].status, 'suggested for removal from the dictionary')

    const cyrillic = lookup(dict, 'pes', { script: 'cyrillic' })

    assert.equal(cyrillic.queries[0].matches[0].isv, 'пес')
    assert.equal(cyrillic.entries[0].isv, 'пес')
    assert.equal(lookup(dict, 'pes', { script: 'etymological' }).entries[0].isv, 'pės')
})

test('forms: true attaches the paradigms; identical ones are printed once', () => {
    const result = lookup(dict, 'byti, atomna bomba', { forms: true, from: 'isv' })
    const [first, second, bomba] = result.entries

    assert.equal(first.forms[0].present['1sg'], 'jesm')
    assert.deepEqual(second.forms, { sameAs: 593 })
    assert.equal('forms' in bomba, false)
    assert.equal(bomba.formsNote, 'multi-word expression: forms are not generated')
})

test('forms handler: headword, inflected form, id', () => {
    const result = forms(dict, 'psa, učiti, id:141')

    assert.deepEqual(result.queries[0].matches, [{ id: 2345, isv: 'pes', via: ['isv form: sg.acc, sg.gen'] }])
    assert.deepEqual(ids(result.queries[1].matches), [1526, 1531])
    assert.deepEqual(ids(result.entries), [2345, 1526, 1531, 141])

    const [pes] = result.entries

    assert.deepEqual(Object.keys(pes), ['id', 'isv', 'pos', 'posInfo', 'en', 'forms'])
    assert.equal(pes.en, 'dog')
    assert.equal(pes.forms[0].sg.gen, 'psa')
    assert.equal(pes.forms[0].pl.acc, 'psov')
    assert.equal(result.entries[3].forms[0].verbalNoun, 'pisanje')
})

test('a verbal noun the dictionary lacks is a derived entry that declines and names its verb', () => {
    const result = forms(dict, 'pisanjem, učenje')
    const [pisanje, ucenje] = result.entries

    assert.deepEqual(result.queries[0].matches[0], { id: -141, isv: 'pisanje', via: ['isv form: sg.ins'] })
    assert.deepEqual(Object.keys(pisanje), ['id', 'isv', 'pos', 'posInfo', 'derived', 'forms'])
    assert.equal(pisanje.derived, 'verbal noun of pisati (id 141); not a dictionary entry, built from the verb')
    assert.equal(pisanje.forms[0].pl.gen, 'pisanij')
    assert.match(ucenje.derived, /of učiti \(id 1526\), učiti se \(id 1531\)/)

    // lookup: the derived noun has no translations, the verb it comes from is listed next to it
    const found = lookup(dict, 'pisanje', { from: 'isv' })

    assert.deepEqual(ids(found.queries[0].matches).slice(0, 2), [-141, 141])
    assert.equal('translations' in found.entries[0], false)
    assert.equal(found.entries[0].derived, pisanje.derived)
    assert.deepEqual(ids(lookup(dict, 'id:-141').entries), [-141])
})

test('forms handler looks only at Interslavic and says so when nothing is found', () => {
    const result = forms(dict, 'собака, dog')

    assert.deepEqual(result.entries, [])
    assert.match(result.queries[0].note, /find the Interslavic word with a lookup first/)
    assert.match(result.queries[1].note, /find the Interslavic word with a lookup first/)
})

test('forms handler: script, homonyms, look-alikes', () => {
    assert.equal(forms(dict, 'пес', { script: 'cyrillic' }).entries[0].forms[0].sg.gen, 'пса')

    const jesm = forms(dict, 'jesm')

    assert.deepEqual(jesm.queries[0].matches.map((match) => match.via[0]), ['isv form: present.1sg', 'isv form: present.1sg'])
    assert.deepEqual(jesm.entries[1].forms, { sameAs: 593 })

    // "pisal" is a form of pisati; pišati differs in a diacritic and is only listed
    const pisal = forms(dict, 'pisal')

    assert.deepEqual(ids(pisal.entries), [141])
    assert.equal(pisal.queries[0].matches[1].via[0], 'isv~ form: lParticiple.m')
})

test('maxChars: second-best matches are cut before the best ones; the match lists stay', () => {
    const words = 'pisati, byti, učiti, dobry'
    const full = lookup(dict, words, { forms: true, from: 'isv' })
    const fullSize = JSON.stringify(full).length

    assert.equal(full.note, undefined)
    assert.deepEqual(ids(full.entries), [141, 593, 24896, 1526, 1531, 1144])

    // a little too long: the second match of "učiti" loses its forms
    const trimmed = lookup(dict, words, { forms: true, from: 'isv', maxChars: fullSize - 500 })

    assert.ok(JSON.stringify(trimmed).length <= fullSize - 500)
    assert.match(trimmed.note, /forms left out for id 1531\./)
    assert.equal(trimmed.entries.length, full.entries.length)
    assert.ok(trimmed.entries.filter((entry) => entry.id !== 1531).every((entry) => entry.forms))

    // much too long: only the best match of every word is left, with its forms where they fit
    const half = lookup(dict, words, { forms: true, from: 'isv', maxChars: Math.round(fullSize * 0.6) })

    assert.ok(JSON.stringify(half).length <= fullSize * 0.6)
    assert.deepEqual(ids(half.entries), [141, 593, 1526, 1144])
    assert.ok(half.entries[0].forms, 'the best match of the first word keeps its forms')
    assert.deepEqual(half.queries[1].matches[1], { id: 24896, isv: 'byti', via: ['isv'], pos: 'v.intr. ipf.', en: 'exist, be there, be available' })

    const tiny = lookup(dict, words, { forms: true, from: 'isv', maxChars: 1500 })

    assert.ok(JSON.stringify(tiny).length <= 1500)
    assert.match(tiny.note, /entries left out for id/)
    assert.deepEqual(tiny.entries, [])
    assert.equal(tiny.queries.length, 4)
    assert.deepEqual(tiny.queries[3].matches[0], { id: 1144, isv: 'dobry', via: ['isv'], pos: 'adj.', en: 'good' })
})

test('fitToSize: a table shared through sameAs passes to the entry that stays', () => {
    const table = [{ lemma: 'byti', present: 'x'.repeat(300) }]
    const result = {
        queries: [
            { query: 'q', matches: [{ id: 2, isv: 'b', via: ['isv'] }, { id: 1, isv: 'a', via: ['isv'] }] },
            { query: 'r', matches: [{ id: 3, isv: 'c', via: ['isv'] }] },
        ],
        entries: [
            { id: 1, isv: 'a', translations: { en: 'y'.repeat(500) }, forms: table },
            { id: 2, isv: 'b', forms: { sameAs: 1 } },
            { id: 3, isv: 'c', forms: { sameAs: 1 } },
        ],
    }
    const maxChars = JSON.stringify(result).length - 200

    // entry 1 is the second match of "q", entries 2 and 3 are best matches
    fitToSize(result, maxChars, new Map([[1, 1], [2, 0], [3, 0]]), new Map([[1, { pos: 'f.', en: 'y' }]]))

    assert.deepEqual(result.entries, [{ id: 2, isv: 'b', forms: table }, { id: 3, isv: 'c', forms: { sameAs: 2 } }])
    assert.deepEqual(result.queries[0].matches[1], { id: 1, isv: 'a', via: ['isv'], pos: 'f.', en: 'y' })
    assert.match(result.note, /entries left out for id 1\./)
    assert.ok(JSON.stringify(result).length <= maxChars)
})

test('fitToSize leaves a result that fits untouched', () => {
    const result = { queries: [], entries: [{ id: 1, isv: 'a', forms: [{ lemma: 'a' }] }] }

    fitToSize(result, 1000, new Map([[1, 0]]))
    assert.deepEqual(result, { queries: [], entries: [{ id: 1, isv: 'a', forms: [{ lemma: 'a' }] }] })
})

test('maxChars never makes an answer longer', () => {
    // nine forms of one short entry: leaving the entry out would add its meaning to nine matches
    const words = ['psa', 'psu', 'psom', 'pse', 'psi', 'psov', 'psah', 'psam', 'psami']
    const full = lookup(dict, words, { langs: 'en' })
    const size = JSON.stringify(full).length

    assert.deepEqual(lookup(dict, words, { langs: 'en', maxChars: size - 1 }), full)

    // when what can be cut weighs less than the note about it, the answer is left as it was
    const result = {
        queries: [{ query: 'q', matches: [{ id: 1, isv: 'a', via: ['en'] }] }],
        entries: [{ id: 1, isv: 'a', forms: [{ lemma: 'a', sg: 'a' }] }],
    }
    const before = structuredClone(result)

    fitToSize(result, JSON.stringify(result).length - 1, new Map([[1, 0]]), new Map([[1, { pos: 'm.' }]]))
    assert.deepEqual(result, before)
})

test('maxChars: very long match lists are cut and say how much is missing', () => {
    const matches = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, isv: `word${i}`, via: ['en'], pos: 'm.', en: 'x'.repeat(40) }))
    const result = { queries: [{ query: 'q', matches }], entries: [{ id: 1, isv: 'word0' }] }

    fitToSize(result, 1500, new Map([[1, 0]]))

    assert.equal(result.queries[0].matches.length, 10)
    assert.equal(result.queries[0].more, 20)
    assert.deepEqual(result.entries, [{ id: 1, isv: 'word0' }])
    assert.match(result.note, /long match lists cut/)
})

test('bad requests are usage errors', () => {
    assert.throws(() => lookup(dict, ''), UsageError)
    assert.throws(() => lookup(dict, 'dog', { langs: 'xx' }), UsageError)
    assert.throws(() => forms(dict, [], {}), UsageError)
    assert.deepEqual(lookup(dict, 'dog', null), lookup(dict, 'dog'))
    assert.deepEqual(forms(dict, 'pes', null), forms(dict, 'pes'))
})
