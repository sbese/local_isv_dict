import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'

import { createApp } from '../src/http.js'
import { forms, lookup } from '../src/lookup.js'
import { fixtureDict } from './helpers.js'

const dict = fixtureDict()
let server
let base

before(async () => {
    server = createServer(createApp({ getDict: async () => dict }))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

const get = async (path) => {
    const response = await fetch(base + path)

    return { status: response.status, type: response.headers.get('content-type'), body: await response.json() }
}
const post = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

    return { status: response.status, body: await response.json() }
}

test('GET /lookup returns exactly what the handler returns', async () => {
    const { status, type, body } = await get(`/lookup?words=${encodeURIComponent('собака,dog')}&langs=min`)

    assert.equal(status, 200)
    assert.equal(type, 'application/json; charset=utf-8')
    assert.deepEqual(body, lookup(dict, 'собака,dog', { langs: 'min' }))
})

test('GET /forms and repeated words parameters', async () => {
    const { body } = await get('/forms?words=psa&words=pisal&script=cyrillic')

    assert.deepEqual(body, forms(dict, ['psa', 'pisal'], { script: 'cyrillic' }))
})

test('POST takes the same parameters as JSON', async () => {
    const parameters = { words: ['dog', 'час'], langs: 'en,ru', forms: true, limit: 1 }
    const { status, body } = await post('/lookup', parameters)

    assert.equal(status, 200)
    assert.deepEqual(body, lookup(dict, parameters.words, parameters))
    assert.deepEqual((await post('/forms', { words: ['id:141'] })).body, forms(dict, ['id:141']))
})

test('GET / describes the API, GET /info the data', async () => {
    const usage = await get('/')

    assert.equal(usage.status, 200)
    assert.ok(usage.body.endpoints)
    assert.ok(usage.body.parameters.langs)
    assert.equal((await get('/info')).body.entries, 31)
})

test('pretty switches indentation on, pretty=0 does not', async () => {
    const text = async (path) => (await fetch(base + path)).text()

    assert.ok((await text('/lookup?words=dog&pretty=1')).includes('\n  "queries"'))
    assert.ok((await text('/lookup?words=dog&pretty')).includes('\n  "queries"'))
    assert.ok(!(await text('/lookup?words=dog&pretty=0')).includes('\n  '))
    assert.ok(!(await text('/lookup?words=dog')).includes('\n  '))
})

test('a body over the size limit is answered with 413, not a dropped connection', async () => {
    const { status, body } = await post('/lookup', { words: ['dog'], padding: 'x'.repeat(1_100_000) })

    assert.equal(status, 413)
    assert.match(body.error, /too large/)
    // and the server keeps working
    assert.equal((await get('/lookup?words=dog')).status, 200)
})

test('mistakes in the request are 4xx with a message', async () => {
    assert.deepEqual(await post('/lookup', 'not json'), { status: 400, body: { error: 'The request body must be JSON, for example {"words": ["dog"]}' } })
    assert.equal((await get('/lookup')).status, 400)
    assert.equal((await get('/lookup?words=dog&langs=zz')).status, 400)
    assert.equal((await get('/nothing')).status, 404)
    assert.equal((await fetch(`${base}/lookup`, { method: 'DELETE' })).status, 405)
})
