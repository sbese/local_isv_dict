import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseSheets, parseTsv } from '../src/data.js'
import { readFixture } from './helpers.js'

const entries = parseSheets(readFixture('words.tsv'), readFixture('words_add_lang.tsv'))
const byId = (id) => entries.find((entry) => entry.id === id)

test('parseTsv trims cells, drops # markers and empty lines', () => {
    const { header, rows } = parseTsv('id\tisv\r\n1\t #agentura \r\n\r\n2\tb\n')

    assert.deepEqual(header, ['id', 'isv'])
    assert.deepEqual(rows, [['1', 'agentura'], ['2', 'b']])
})

test('parseSheets returns every row, sorted by id', () => {
    assert.equal(entries.length, 31)
    assert.deepEqual(entries.map((entry) => entry.id), entries.map((entry) => entry.id).sort((a, b) => a - b))
})

test('an entry keeps the grammar columns', () => {
    const pisati = byId(141)

    assert.equal(pisati.isv, 'pisati')
    assert.equal(pisati.addition, '(piše)')
    assert.equal(pisati.pos, 'v.tr. ipf.')
    assert.equal(pisati.type, '1')
    assert.equal(typeof pisati.frequency, 'number')
    assert.match(pisati.intelligibility, /ru\+/)
})

test('languages of the second sheet are merged in by id', () => {
    const pes = byId(2345)

    assert.equal(pes.tr.en, 'dog')
    assert.equal(pes.tr.ru, 'собака, пёс')
    assert.equal(pes.tr.es, 'perro')
    assert.equal(pes.tr.fr, '!chien')
})

test('empty cells and a bare "!" are not translations', () => {
    assert.equal('cu' in byId(24020).tr, false)
})

test('editorial marks: # is dropped, a leading ! on the headword means "suggested for removal"', () => {
    assert.equal(byId(24110).isv, 'agentura')
    assert.equal(byId(34502).pos, 'v.intr. pf.')
    assert.equal(byId(17219).isv, 'črnica')
    assert.equal(byId(17219).removed, true)
    assert.equal(byId(2345).removed, false)
})

test('a sheet without the id or isv column is rejected', () => {
    assert.throws(() => parseSheets('foo\tbar\n1\t2\n'), /no "id" column/)
})
