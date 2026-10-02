import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
    describePos,
    exactKey,
    fold,
    governedCase,
    inflectionHint,
    isvKey,
    isvStd,
    lemmaVariants,
    splitVariants,
    srLatinToCyrillic,
    stripBrackets,
    toScript,
} from '../src/text.js'

test('fold: Latin letters lose diacritics, Cyrillic letters keep theirs', () => {
    assert.equal(fold('Łaska'), 'laska')
    assert.equal(fold('Straße'), 'strasse')
    assert.equal(fold('señor'), 'senor')
    assert.equal(fold('počítadlo'), 'pocitadlo')
    assert.equal(fold('Пёс'), 'пес')
    assert.equal(fold('Йод'), 'йод')
    assert.equal(fold('їжак'), 'їжак')
    assert.equal(fold(`о${String.fromCodePoint(0x301)}блако`), 'облако') // a stress mark
    assert.equal(fold('об’єкт'), "об'єкт")
    assert.equal(fold('  two   words '), 'two words')
    assert.equal(fold('Go away!'), 'go away')
    assert.equal(fold('U.S.A.'), 'usa')
    assert.equal(fold('kto-nebud'), 'kto-nebud')
})

test('fold: invisible characters, dash variants and morpheme bars do not matter', () => {
    const nonBreakingHyphen = String.fromCodePoint(0x2011)
    const zeroWidthSpace = String.fromCodePoint(0x200b)
    const softHyphen = String.fromCodePoint(0xad)

    assert.equal(fold(`кто${nonBreakingHyphen}нибудь`), 'кто-нибудь')
    assert.equal(fold(`${zeroWidthSpace}over${softHyphen}blow${zeroWidthSpace}`), 'overblow')
    assert.equal(fold('časow|y'), 'casowy')
    assert.equal(exactKey(`кто${nonBreakingHyphen}нибудь`), 'кто-нибудь')
})

test('exactKey ignores only case, ё/е, apostrophe style and punctuation', () => {
    assert.equal(exactKey('Пёс'), 'пес')
    assert.equal(exactKey('Łaska'), 'łaska')
    assert.notEqual(exactKey('łaska'), exactKey('laska'))
    assert.equal(exactKey('Dobro jutro!'), exactKey('dobro jutro'))
})

test('isvStd: any script or flavour → lower-case standard Latin', () => {
    assert.equal(isvStd('ČAS'), 'čas')
    assert.equal(isvStd('vȯzdušny'), 'vozdušny')
    assert.equal(isvStd('пес'), 'pes')
    assert.equal(isvStd('быти'), 'byti')
    assert.equal(isvStd('učiti sę'), 'učiti se')
    assert.equal(isvStd('Dobro jutro!'), 'dobro jutro')
})

test('isvStd takes Latin text letter for letter: foreign words do not turn into Interslavic ones', () => {
    assert.equal(isvStd('père'), 'père')
    assert.equal(isvStd('chien'), 'chien')
    assert.equal(isvStd('cinq'), 'cinq')
    assert.equal(isvStd('łaska'), 'łaska')
    assert.equal(isvStd('nizsi'), 'nizsi')
})

test('isvKey: no diacritics, y → i', () => {
    assert.equal(isvKey('vȯzdušny'), 'vozdusni')
    assert.equal(isvKey('byti'), 'biti')
    assert.equal(isvKey('быти'), 'biti')
    assert.equal(isvKey('biti'), 'biti')
    assert.equal(isvKey('učiti sę'), 'uciti se')
    assert.equal(isvKey('vojenno-vȯzdušne sily'), 'vojennovozdusne sili')
    assert.equal(isvKey('pės'), 'pes')
    assert.equal(isvKey('łaska'), 'laska')
})

test('isvKey: a word typed without its diacritics reaches the same key', () => {
    assert.equal(isvKey('nizsi'), isvKey('nizši'))
    assert.equal(isvKey('blizsi'), isvKey('blizši'))
    assert.equal(isvKey('szety'), isvKey('sžęty'))
})

test('toScript converts dictionary text and drops the helper letters of generated forms', () => {
    assert.equal(toScript('pišųćí'), 'pišuči')
    assert.equal(toScript('pišųćí', 'cyrillic'), 'пишучи')
    assert.equal(toScript('pišųćí', 'etymological'), 'pišųći')
    assert.equal(toScript('pišemœ', 'etymological'), 'pišemo')
    assert.equal(toScript('pęť', 'etymological'), 'pęť')
    assert.equal(toScript('(n)jego (go)'), '(n)jego (go)')
    assert.equal(toScript('Gruby Nacionaľny Produkt [GNP]'), 'Gruby Nacionalny Produkt [GNP]')
    assert.equal(toScript(''), '')
})

test('stripBrackets removes remarks, nested ones too', () => {
    assert.equal(stripBrackets('акция (ценная бумага)'), 'акция')
    assert.equal(stripBrackets('hektar [ha]'), 'hektar')
    assert.equal(stripBrackets('a (b (c) d) e'), 'a e')
})

test('splitVariants: commas, semicolons, remarks and the unverified mark', () => {
    assert.deepEqual(splitVariants('!Hund, Rüde'), { variants: ['Hund', 'Rüde'], unverified: true })
    assert.deepEqual(splitVariants('admin (slang), administrator').variants, ['admin', 'administrator'])
    assert.deepEqual(splitVariants('affair (adultery), affair (controversial situation)').variants, ['affair'])
    assert.deepEqual(splitVariants(''), { variants: [], unverified: false })
    assert.deepEqual(splitVariants(`!${String.fromCodePoint(0x200b)}pos`), { variants: ['pos'], unverified: true })
})

test('splitVariants: a ";" cell keeps its comma phrases whole and also offers their parts', () => {
    assert.deepEqual(
        splitVariants('хоць; хаця; нягледзячы на тое, што').variants,
        ['хоць', 'хаця', 'нягледзячы на тое, што', 'нягледзячы на тое', 'што'],
    )
    assert.deepEqual(
        splitVariants('tradicionalan, uobičajen; uvriježen').variants,
        ['tradicionalan, uobičajen', 'tradicionalan', 'uobičajen', 'uvriježen'],
    )
})

test('splitVariants: one-word alternatives written with a slash are variants too', () => {
    assert.deepEqual(splitVariants('a, ale/pak/tola').variants, ['a', 'ale/pak/tola', 'ale', 'pak', 'tola'])
    assert.deepEqual(splitVariants('watch a movie/TV').variants, ['watch a movie/TV'])
})

test('lemmaVariants', () => {
    assert.deepEqual(lemmaVariants('uho, uško [@]'), ['uho', 'uško'])
    assert.deepEqual(lemmaVariants('naskakati (na)'), ['naskakati'])
})

test('srLatinToCyrillic', () => {
    assert.deepEqual(srLatinToCyrillic('bez'), ['без'])
    assert.deepEqual(srLatinToCyrillic('Džep'), ['џеп', 'джеп'])
    // "nj" is њ in most words but н + ј in some
    assert.deepEqual(srLatinToCyrillic('injekcija'), ['ињекција', 'инјекција'])
    assert.deepEqual(srLatinToCyrillic('пас'), [])
})

test('describePos spells out the dictionary abbreviations', () => {
    assert.equal(describePos('m.anim.'), 'noun, masculine, animate')
    assert.equal(describePos('m.'), 'noun, masculine, inanimate')
    assert.equal(describePos('m./f.'), 'noun, masculine or feminine, inanimate')
    assert.equal(describePos('f.pl.'), 'noun, feminine, plural only')
    assert.equal(describePos('n.indecl.'), 'noun, neuter, indeclinable')
    assert.equal(describePos('v.tr. ipf.'), 'verb, transitive, imperfective')
    assert.equal(describePos('v.refl. ipf./pf.'), 'verb, reflexive, imperfective / perfective')
    assert.equal(describePos('adj.comp.'), 'adjective, comparative degree')
    assert.equal(describePos('num.card.'), 'numeral, cardinal')
    assert.equal(describePos('num.'), 'numeral')
    assert.equal(describePos('pron.pers.'), 'pronoun, personal')
    assert.equal(describePos('prep.'), 'preposition')
    assert.equal(describePos(''), '')
})

test('the addition column: governed case and inflection hint', () => {
    assert.equal(governedCase('(izběži) (+2)'), 'genitive')
    assert.equal(governedCase('(+5)'), 'instrumental')
    assert.equal(governedCase('(psa)'), null)
    assert.equal(inflectionHint('(izběži) (+2)'), '(izběži)')
    assert.equal(inflectionHint('(+3)'), '')
})
