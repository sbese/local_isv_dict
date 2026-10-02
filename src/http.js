// HTTP interface: the same two handlers as the CLI and the MCP server, on localhost only.
//
//   GET  /lookup?words=собака,дом&langs=min      GET  /forms?words=pes
//   POST /lookup  {"words": ["собака"], ...}     POST /forms  {"words": ["pes"]}
//   GET  /info                                   GET  /  (usage)

import { createServer } from 'node:http'

import { openDict } from './dict.js'
import { FORMS_DESCRIPTION, LOOKUP_DESCRIPTION, PARAMETERS, UsageError, describeDict, forms, lookup } from './lookup.js'

const DEFAULT_PORT = 8787
const MAX_BODY_BYTES = 1_000_000
const HANDLERS = { '/lookup': lookup, '/forms': forms }
const OPTION_NAMES = ['langs', 'forms', 'from', 'script', 'limit', 'maxChars']

const USAGE = {
    name: 'isv-dict — local Interslavic dictionary',
    endpoints: {
        'GET /lookup?words=собака,дом&langs=min': 'words in any language → Interslavic dictionary entries',
        'GET /forms?words=pes': 'Interslavic words → all their inflected forms',
        'POST /lookup, POST /forms': 'the same with a JSON body: {"words": ["собака", "дом"], "langs": "min"}',
        'GET /info': 'data location, download date, languages',
    },
    parameters: { ...PARAMETERS, maxChars: 'Shorten the answer to about this many characters of JSON.', pretty: 'Indent the JSON.' },
    lookup: LOOKUP_DESCRIPTION,
    forms: FORMS_DESCRIPTION,
}

class BodyTooLarge extends UsageError {}

function readBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = []
        let size = 0

        // An oversized body is read to the end without being kept: cutting the connection instead
        // would leave the client with a reset and no explanation.
        request.on('data', (chunk) => {
            size += chunk.length

            if (size <= MAX_BODY_BYTES) {
                chunks.push(chunk)
            }
        })
        request.on('end', () => {
            if (size > MAX_BODY_BYTES) {
                reject(new BodyTooLarge('The request body is too large: the limit is 1 MB'))
            } else {
                resolve(Buffer.concat(chunks).toString('utf8'))
            }
        })
        request.on('error', reject)
    })
}

// `?pretty`, `?pretty=1` and `"pretty": true` switch indentation on; `0`, `false`, `no`, `off` do not
const isSwitchedOn = (value) => value !== undefined && !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())

async function readParameters(request, url) {
    const parameters = {}

    for (const name of [...OPTION_NAMES, 'pretty']) {
        if (url.searchParams.has(name)) {
            parameters[name] = url.searchParams.get(name)
        }
    }

    if (url.searchParams.has('words')) {
        parameters.words = url.searchParams.getAll('words')
    }

    if (request.method === 'POST') {
        const body = await readBody(request)

        if (body.trim()) {
            let parsed

            try {
                parsed = JSON.parse(body)
            } catch {
                throw new UsageError('The request body must be JSON, for example {"words": ["dog"]}')
            }

            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new UsageError('The request body must be a JSON object, for example {"words": ["dog"]}')
            }

            Object.assign(parameters, parsed)
        }
    }

    return parameters
}

async function route(request, getDict) {
    const url = new URL(request.url, 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (!['GET', 'POST'].includes(request.method)) {
        return { status: 405, body: { error: 'Use GET or POST' } }
    }

    if (path === '/') {
        return { status: 200, body: USAGE, pretty: true }
    }

    if (path === '/info') {
        return { status: 200, body: describeDict(await getDict()), pretty: true }
    }

    const handler = HANDLERS[path]

    if (!handler) {
        return { status: 404, body: { error: `Unknown path ${path}. See GET / for the endpoints.` } }
    }

    const { words, pretty, ...options } = await readParameters(request, url)

    return { status: 200, body: handler(await getDict(), words, options), pretty: isSwitchedOn(pretty) }
}

/** The request listener, separate from the listening socket so that it can be tested. */
export function createApp({ getDict = () => openDict(), log = () => {} } = {}) {
    return async (request, response) => {
        let result

        try {
            result = await route(request, getDict)
        } catch (error) {
            if (error instanceof UsageError) {
                result = { status: error instanceof BodyTooLarge ? 413 : 400, body: { error: error.message } }
            } else {
                log(error.stack ?? String(error))
                result = { status: 500, body: { error: error.message ?? 'Internal error' } }
            }
        }

        response.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8' })
        response.end(`${JSON.stringify(result.body, null, result.pretty ? 2 : 0)}\n`)
    }
}

/** Starts the HTTP API and loads the dictionary in the background. */
export async function startServer({ port, host = '127.0.0.1', log = () => {} } = {}) {
    const listenPort = Number(port ?? process.env.PORT ?? DEFAULT_PORT)

    if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
        throw new UsageError('"port" must be a number from 0 to 65535')
    }

    const getDict = () => openDict({ log })
    const server = createServer(createApp({ getDict, log }))

    await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(listenPort, host, resolve)
    })
    log(`isv-dict HTTP API: http://${host}:${server.address().port}/  (GET / shows the usage)`)
    getDict().catch((error) => log(`Could not load the dictionary: ${error.message}`))

    return server
}
