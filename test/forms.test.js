import assert from 'node:assert/strict'
import { test } from 'node:test'

import { derivedEntries, expandForms, matchSlots, paradigms, renderParadigm, searchableForms } from '../src/forms.js'

const entry = (isv, pos, addition = '') => ({ isv, pos, addition })
// expected values below are the declension library's own test snapshots, hence etymological script
const render = (isv, pos, addition, script = 'etymological') => {
    const { list } = paradigms(entry(isv, pos, addition))

    return list.map((paradigm) => renderParadigm(paradigm, script))
}
const formsOf = (isv, pos, addition) => searchableForms(paradigms(entry(isv, pos, addition)).list)

test('masculine nouns', () => {
    const [grad] = render('grad', 'm.')

    assert.deepEqual(grad.sg, { nom: 'grad', acc: 'grad', gen: 'grada', loc: 'gradu', dat: 'gradu', ins: 'gradom', voc: 'grade' })
    assert.deepEqual(grad.pl, { nom: 'grady', acc: 'grady', gen: 'gradov', loc: 'gradah', dat: 'gradam', ins: 'gradami', voc: 'grady' })

    const [otec] = render('otėc', 'm.anim.')

    assert.equal(otec.sg.acc, 'otca')
    assert.equal(otec.sg.voc, 'otče')
    assert.equal(otec.pl.nom, 'otci')
    assert.equal(otec.pl.acc, 'otcev')
})

test('feminine and neuter nouns, alternative forms from the addition', () => {
    const [zena] = render('žena', 'f.')

    assert.equal(zena.sg.acc, 'ženų')
    assert.equal(zena.sg.ins, 'ženojų')
    assert.equal(zena.pl.gen, 'žen')

    const [slovo] = render('slovo', 'n.', '(slova/slovese)')

    assert.equal(slovo.sg.gen, 'slova / slovese')
    assert.equal(slovo.pl.nom, 'slova / slovesa')
})

test('the fleeting vowel is taken from the headword, standard script is the default', () => {
    const [pes] = render('pės', 'm.anim.', '', 'latin')

    assert.equal(pes.lemma, 'pes')
    assert.deepEqual(pes.sg, { nom: 'pes', acc: 'psa', gen: 'psa', loc: 'psu', dat: 'psu', ins: 'psom', voc: 'pse' })
    assert.equal(pes.pl.acc, 'psov')
    assert.equal(render('pės', 'm.anim.', '', 'cyrillic')[0].sg.gen, 'пса')
})

test('singular-only, plural-only and indeclinable nouns', () => {
    assert.deepEqual(Object.keys(render('zlato', 'n.sg.')[0]), ['lemma', 'sg'])
    assert.deepEqual(Object.keys(render('dveri', 'f.pl.')[0]), ['lemma', 'pl'])
    assert.deepEqual(render('alibi', 'n.indecl.'), [{ lemma: 'alibi', indeclinable: 'alibi' }])
})

test('a masculine-or-feminine noun gets a table per gender unless they coincide', () => {
    const kriz = render('križ', 'm./f.')

    assert.deepEqual(kriz.map((paradigm) => paradigm.gender), ['masculine', 'feminine'])
    assert.equal(kriz[0].sg.gen, 'križa')
    assert.equal(kriz[1].sg.gen, 'križi')

    const sirota = render('sirota', 'm./f.')

    assert.equal(sirota.length, 1)
    assert.equal('gender' in sirota[0], false)
})

test('headword variants are declined separately, each with its own hint', () => {
    const [djabol, djavol] = render('djabȯl, djavȯl', 'm.anim.', '(djabla, djavla)')

    assert.equal(djabol.sg.gen, 'djabla')
    assert.equal(djavol.sg.gen, 'djavla')
})

test('adjectives: genders, animacy, short form, comparison', () => {
    const [dobry] = render('dobry', 'adj.')

    assert.deepEqual(dobry.sg.nom, { m: 'dobry', n: 'dobro', f: 'dobra' })
    assert.deepEqual(dobry.sg.acc, { m: { anim: 'dobrogo', inan: 'dobry' }, n: 'dobro', f: 'dobrų' })
    assert.deepEqual(dobry.sg.gen, { 'm/n': 'dobrogo', 'f': 'dobroj' })
    assert.deepEqual(dobry.pl.nom, { 'm': { anim: 'dobri', inan: 'dobre' }, 'f/n': 'dobre' })
    assert.equal(dobry.pl.ins, 'dobrymi')
    assert.equal(dobry.short, 'dobr')
    assert.equal(dobry.adverb, 'dobro')
    assert.deepEqual(dobry.comparative, { adj: 'lěpši / lučši', adv: 'lěpje / lučše' })
    assert.deepEqual(dobry.superlative, { adj: 'najlěpši / najlučši', adv: 'najlěpje / najlučše' })
})

test('verbs: simple tenses, compound tenses, participles', () => {
    const [pisati] = render('pisati', 'v.tr. ipf.', '(piše)')

    assert.equal(pisati.infinitive, 'pisati')
    assert.deepEqual(pisati.present, { '1sg': 'pišų / pišem', '2sg': 'pišeš', '3sg': 'piše', '1pl': 'pišemo', '2pl': 'pišete', '3pl': 'pišųt' })
    assert.equal(pisati.imperfect['3pl'], 'pisahų')
    assert.equal(pisati.future['1sg'], 'bųdų pisati')
    assert.equal(pisati.perfect['1sg'], 'jesm pisal(a)')
    assert.deepEqual(pisati.perfect['3sg'], { m: '(je) pisal', f: '(je) pisala', n: '(je) pisalo' })
    assert.equal(pisati.conditional['2pl'], 'byste pisali')
    assert.deepEqual(pisati.imperative, { '2sg': 'piši', '1pl': 'pišimo', '2pl': 'pišite' })
    assert.deepEqual(pisati.lParticiple, { m: 'pisal', f: 'pisala', n: 'pisalo', pl: 'pisali' })
    assert.deepEqual(pisati.participle.presentActive, { m: 'pišųći', f: 'pišųća', n: 'pišųće' })
    assert.deepEqual(pisati.participle.pastPassive, { m: 'pisany', f: 'pisana', n: 'pisano' })
    assert.equal(pisati.verbalNoun, 'pisańje')

    const [latin] = render('pisati', 'v.tr. ipf.', '(piše)', 'latin')

    assert.equal(latin.present['1sg'], 'pišu / pišem')
    assert.equal(latin.participle.presentActive.m, 'pišuči')
    assert.equal(latin.verbalNoun, 'pisanje')
})

test('reflexive verbs keep "sę"; intransitive ones have no passive participles', () => {
    const [uciti] = render('učiti sę', 'v.refl. ipf.')

    assert.equal(uciti.present['1sg'], 'učų sę / učim sę')
    assert.equal(uciti.imperative['2sg'], 'uči sę')
    assert.equal(uciti.lParticiple.f, 'učila sę')
    assert.equal(uciti.participle.presentActive.m, 'učęći sę')
    assert.equal('pastPassive' in uciti.participle, false)
    assert.equal(uciti.verbalNoun, 'učeńje')
})

test('suffix-only participle endings are written out in full', () => {
    const [delati] = render('dělati', 'v.tr. ipf.', '', 'latin')

    assert.deepEqual(delati.participle.presentPassive, { m: 'dělajemy / dělamy', f: 'dělajema / dělama', n: 'dělajemo / dělamo' })
    assert.equal(delati.imperative['2sg'], 'dělaj')
})

test('byti: own future and conditional forms', () => {
    const [byti] = render('byti', 'v.intr. ipf.', '(jesm, jesi, jest, jesmo, jeste, sųt; byl; bųdų)')

    assert.equal(byti.present['3sg'], 'jest (je)')
    assert.equal(byti.future['1sg'], 'bųdų')
    assert.deepEqual(byti.conditionalAuxiliary, { '1sg': 'byh', '2sg': 'bys', '3sg': 'by', '1pl': 'byhmo', '2pl': 'byste', '3pl': 'by' })
})

test('pronouns and numerals', () => {
    const [ja] = render('ja', 'pron.pers.')

    assert.equal(ja.sg.acc, 'mene (mę)')
    assert.equal(ja.pl.dat, 'nam')

    const [on] = render('on', 'pron.pers.')

    assert.equal(on.sg.acc.m, '(n)jego (go)')
    assert.deepEqual(on.pl.nom, { 'm': { anim: 'oni', inan: 'one' }, 'f/n': 'one' })

    const [dva] = render('dva', 'num.card.', '(dvě)')

    assert.deepEqual(dva.m, { nom: 'dva', acc: 'dva / dvoh', gen: 'dvoh', loc: 'dvoh', dat: 'dvom', ins: 'dvoma' })
    assert.equal(dva['f/n'].nom, 'dvě')

    assert.equal(render('pęť', 'num.card.')[0].sg.gen, 'pęti')
    assert.equal(render('četvŕty', 'num.ord.')[0].sg.nom.f, 'četvŕta')
    assert.equal(render('kto', 'pron.int.')[0].gen, 'kogo')
})

test('what cannot be inflected says why', () => {
    assert.deepEqual(paradigms(entry('atomna bomba', 'f.')), { list: [], note: 'multi-word expression: forms are not generated' })
    assert.deepEqual(paradigms(entry('krajno', 'adv.')), { list: [], note: 'adverb: not inflected' })
    assert.deepEqual(paradigms(entry('bųde/bųdųt', 'v.aux. ipf.')), { list: [], note: 'forms are not available for this word' })
    assert.deepEqual(paradigms(entry('čto-to', '')), { list: [], note: 'unknown part of speech' })
})

test('a phrase with a verb: only the verb is conjugated, and its forms are not searchable', () => {
    const { list } = paradigms(entry('iměti pravdų', 'v.ipf.'))

    assert.equal(list.length, 1)
    assert.match(list[0].note, /only the verb "iměti" is conjugated/)
    assert.equal(searchableForms(list).size, 0)
})

test('expandForms splits a cell into single forms', () => {
    assert.deepEqual(expandForms('slova / slovesa'), ['slova', 'slovesa'])
    assert.deepEqual(expandForms('pišų, pišem'), ['pišų', 'pišem'])
    assert.deepEqual(expandForms('mene (mę)'), ['mene', 'mę'])
    assert.deepEqual(expandForms('(n)jego (go)'), ['jego', 'njego', 'go'])
    assert.deepEqual(expandForms('(n)jih / (n)je'), ['jih', 'njih', 'je', 'nje'])
    assert.deepEqual(expandForms('jest (je)'), ['jest', 'je'])
})

test('searchable forms: real word forms only', () => {
    const pisati = formsOf('pisati', 'v.tr. ipf.', '(piše)')

    for (const form of ['pisati', 'pišų', 'pišem', 'pisah', 'piši', 'pisal', 'pisala', 'pišųći', 'pisany', 'pisańje']) {
        assert.ok(pisati.has(form), `pisati should have the form ${form}`)
    }

    // auxiliaries of the compound tenses are forms of "byti", not of every verb
    for (const auxiliary of ['jesm', 'je', 'bųdų', 'byh', 'běh']) {
        assert.equal(pisati.has(auxiliary), false, `${auxiliary} is not a form of pisati`)
    }

    const byti = formsOf('byti', 'v.intr. ipf.', '')

    for (const form of ['jesm', 'jest', 'je', 'sųt', 'bųdų', 'byh', 'běh', 'byl']) {
        assert.ok(byti.has(form), `byti should have the form ${form}`)
    }

    const uciti = formsOf('učiti sę', 'v.refl. ipf.')

    assert.ok(uciti.has('učų sę'))
    assert.ok(uciti.has('učų'))

    assert.deepEqual([...formsOf('on', 'pron.pers.')].slice(0, 6), ['on', 'ono', 'ona', 'jego', 'njego', 'go'])
    assert.equal([...formsOf('slovjansky', 'adj.')].some((form) => form.includes(' ')), false)
})

test('matchSlots names the slots a form fills', () => {
    const pes = paradigms(entry('pės', 'm.anim.')).list
    const pisati = paradigms(entry('pisati', 'v.tr. ipf.', '(piše)')).list

    assert.deepEqual(matchSlots(pes, 'psa'), { slots: ['sg.acc', 'sg.gen'], exact: true })
    assert.deepEqual(matchSlots(pes, 'пса'), { slots: ['sg.acc', 'sg.gen'], exact: true })
    assert.deepEqual(matchSlots(pisati, 'pisal'), { slots: ['lParticiple.m'], exact: true })
    assert.deepEqual(matchSlots(pisati, 'pisu'), { slots: ['present.1sg'], exact: false })
    assert.deepEqual(matchSlots(pisati, 'kot'), { slots: [], exact: false })
})

test('matchSlots: a form typed exactly does not drag in its look-alikes', () => {
    // genitive singular "slugy" and nominative plural "slugi" differ only in y/i
    const sluga = paradigms(entry('sluga', 'm.anim.')).list

    assert.deepEqual(matchSlots(sluga, 'slugy'), { slots: ['sg.gen'], exact: true })
    assert.deepEqual(matchSlots(sluga, 'slugi'), { slots: ['pl.nom', 'pl.voc'], exact: true })

    // a foreign word that merely resembles a form is not an exact match
    const prati = paradigms(entry('prati', 'v.tr. ipf.', '(pere)')).list

    assert.deepEqual(matchSlots(prati, 'pere'), { slots: ['present.3sg'], exact: true })
    assert.deepEqual(matchSlots(prati, 'père'), { slots: ['present.3sg'], exact: false })
})

test('derivedEntries: the verbal noun of every verb the dictionary has no noun for', () => {
    const verb = (id, isv, pos = 'v.tr. ipf.', more = {}) => ({ id, isv, pos, addition: '', removed: false, tr: {}, ...more })
    const derived = derivedEntries([
        verb(1, 'pisati'),
        verb(2, 'učiti'),
        verb(3, 'učiti sę', 'v.refl. ipf.'),
        verb(4, 'vladati, vlåděti'),
        verb(5, 'iměti pravdų', 'v.ipf.'),
        verb(6, 'biti', 'v.tr. ipf.', { removed: true }),
        verb(7, 'kovati'),
        { id: 8, isv: 'kovańje', pos: 'n.', addition: '', tr: {} },
        // shares "oglušeńje" with the verb before it, and the nouns of both join one entry
        verb(9, 'ogluhnųti, oglušeti', 'v.intr. pf.'),
        verb(10, 'oglušiti', 'v.tr. pf.'),
    ])
    const summary = derived
        .filter((entry) => entry.derived.kind === 'verbal noun')
        .map((entry) => [entry.id, entry.isv, entry.pos, entry.derived.from.map((source) => source.id)])

    // učiti and učiti sę share one noun; a phrase, a removed verb and a verb whose noun exists give none
    assert.deepEqual(summary, [
        [-1, 'pisańje', 'n.', [1]],
        [-2, 'učeńje', 'n.', [2, 3]],
        [-4, 'vladańje, vlåděńje', 'n.', [4]],
        [-9, 'ogluhnųťje, oglušeńje', 'n.', [9, 10]],
    ])
    assert.deepEqual(derived[0].tr, {})
    assert.equal(derived[0].derived.kind, 'verbal noun')

    // in the library's own spelling, so that it declines right: genitive plural "pisanij"
    const [pisanje] = paradigms(derived[0]).list.map((paradigm) => renderParadigm(paradigm, 'etymological'))

    assert.equal(pisanje.sg.ins, 'pisańjem')
    assert.equal(pisanje.pl.gen, 'pisanij')
    assert.equal(paradigms(derived[2]).list.length, 2)
})

test('derivedEntries: participles decline like adjectives, without comparison', () => {
    const derived = derivedEntries([
        { id: 141, isv: 'pisati', pos: 'v.tr. ipf.', addition: '(piše)', removed: false, tr: {} },
        { id: 1531, isv: 'učiti sę', pos: 'v.refl. ipf.', addition: '', removed: false, tr: {} },
        { id: 7, isv: 'pisavši', pos: 'adj.', addition: '', tr: {} },
    ])
    const participles = derived.filter((entry) => entry.pos === 'adj.')

    // "pisavši" is in the dictionary already; a reflexive verb has active participles only, without "sę"
    assert.deepEqual(participles.map((entry) => [entry.id, entry.isv, entry.derived.kind]), [
        [-1000141, 'pišųći', 'present active participle'],
        [-1001531, 'učęći', 'present active participle'],
        [-2000141, 'pišemy', 'present passive participle'],
        [-3001531, 'učivši', 'past active participle'],
        [-4000141, 'pisany', 'past passive participle'],
    ].sort((a, b) => b[0] - a[0]))

    const table = (id) => renderParadigm(paradigms(participles.find((entry) => entry.id === id)).list[0], 'etymological')
    const pisany = table(-4000141)
    const pisuci = table(-1000141)

    assert.equal(pisany.sg.gen['m/n'], 'pisanogo')
    assert.equal(pisany.short, 'pisan')
    assert.equal(pisuci.sg.gen['m/n'], 'pišųćego')
    assert.equal(pisuci.pl.ins, 'pišųćimi')
    // an active participle has no short form, no participle has an adverb or comparison
    assert.deepEqual(Object.keys(pisuci), ['lemma', 'sg', 'pl'])
    assert.deepEqual(Object.keys(pisany), ['lemma', 'sg', 'pl', 'short'])
})

test('derivedEntries: a noun spelled like a participle does not stand in for it', () => {
    const derived = derivedEntries([
        { id: 1526, isv: 'učiti', pos: 'v.tr. ipf.', addition: '', removed: false, tr: {} },
        { id: 13168, isv: 'učeny', pos: 'm.anim.', addition: '', tr: {} },
    ])
    const uceny = derived.find((entry) => entry.isv === 'učeny')

    // the noun "učeny" (a scholar) has the masculine only; "učenų" is the participle's feminine
    assert.equal(uceny.id, -4001526)
    assert.equal(uceny.derived.kind, 'past passive participle')
    assert.ok(searchableForms(paradigms(uceny).list).has('učenų'))
})
