import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { FIXTURE_DIR } from './helpers.js'

// The real server process, fed with the fixture sheets through ISV_DICT_DATA_DIR.
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp.js')
let dataDir
let server
let exited
let buffer = ''
let nextId = 1
const pending = new Map()
const garbage = []

before(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'isv-dict-test-'))

    for (const file of ['words.tsv', 'words_add_lang.tsv']) {
        copyFileSync(path.join(FIXTURE_DIR, file), path.join(dataDir, file))
    }

    server = spawn(process.execPath, [SERVER], {
        env: { ...process.env, ISV_DICT_DATA_DIR: dataDir, ISV_DICT_MAX_CHARS: '3000' },
        stdio: ['pipe', 'pipe', 'ignore'],
    })
    exited = new Promise((resolve) => server.on('exit', resolve))
    server.stdout.on('data', (chunk) => {
        buffer += chunk
        let end

        while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end)

            buffer = buffer.slice(end + 1)

            try {
                const message = JSON.parse(line)

                pending.get(message.id)?.(message)
            } catch {
                garbage.push(line)
            }
        }
    })
})

after(async () => {
    server.stdin.end()
    await exited
    rmSync(dataDir, { recursive: true, force: true })
})

const send = (message) => server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const request = (method, params) => new Promise((resolve) => {
    const id = nextId++

    pending.set(id, resolve)
    send({ id, method, params })
})
const callTool = async (name, args) => (await request('tools/call', { name, arguments: args })).result

test('the server introduces itself and lists both tools', async () => {
    const init = await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
    })

    assert.equal(init.result.serverInfo.name, 'isv-dict')
    send({ method: 'notifications/initialized' })

    const { tools } = (await request('tools/list', {})).result

    assert.deepEqual(tools.map((tool) => tool.name), ['isv_lookup', 'isv_forms'])
    assert.deepEqual(Object.keys(tools[0].inputSchema.properties), ['words', 'langs', 'forms', 'from', 'script', 'limit'])
    assert.deepEqual(tools[0].inputSchema.required, ['words'])
    assert.deepEqual(Object.keys(tools[1].inputSchema.properties), ['words', 'script'])
    assert.match(tools[0].description, /dictionary forms \(lemmas\)/)
})

test('isv_lookup answers with the dictionary entries as JSON text', async () => {
    const result = await callTool('isv_lookup', { words: ['собака'], langs: 'min' })
    const answer = JSON.parse(result.content[0].text)

    assert.notEqual(result.isError, true)
    assert.deepEqual(answer.queries[0].matches[0], { id: 2345, isv: 'pes', via: ['ru', 'uk'] })
    assert.deepEqual(answer.entries[0].translations, { en: 'dog', ru: 'собака, пёс', uk: 'пес, собака', pl: 'pies' })
})

test('isv_forms answers with the forms', async () => {
    const result = await callTool('isv_forms', { words: ['psa'] })
    const answer = JSON.parse(result.content[0].text)

    assert.deepEqual(answer.queries[0].matches[0].via, ['isv form: sg.acc, sg.gen'])
    assert.equal(answer.entries[0].forms[0].sg.ins, 'psom')
})

test('words and language lists may also come as one comma-separated string or as a list', async () => {
    const asString = await callTool('isv_lookup', { words: 'собака, dog', langs: 'en,ru', from: 'ru,en' })
    const asList = await callTool('isv_lookup', { words: ['собака', 'dog'], langs: ['en', 'ru'], from: ['ru', 'en'] })

    assert.notEqual(asString.isError, true)
    assert.equal(asString.content[0].text, asList.content[0].text)
    assert.deepEqual(Object.keys(JSON.parse(asList.content[0].text).entries[0].translations), ['en', 'ru'])
})

test('long answers are shortened to the configured size', async () => {
    const result = await callTool('isv_lookup', { words: ['pisati', 'byti', 'učiti', 'dobry'], forms: true })
    const answer = JSON.parse(result.content[0].text)

    assert.ok(result.content[0].text.length <= 3000)
    assert.match(answer.note, /shortened to fit the size limit/)
})

test('a wrong option value comes back as a tool error, not a crash', async () => {
    const result = await callTool('isv_lookup', { words: ['dog'], langs: 'klingon' })

    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /Unknown value in "langs"/)
    assert.equal((await callTool('isv_forms', { words: ['pes'] })).isError, undefined)
})

test('nothing but protocol messages is written to stdout', () => {
    assert.deepEqual(garbage, [])
})
