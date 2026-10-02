#!/usr/bin/env node
// Command line interface. Results go to stdout as JSON, progress and errors to stderr.

import { parseArgs } from 'node:util'

import { openDict, refreshDict } from './dict.js'
import { PARAMETERS, UsageError, describeDict, forms, lookup } from './lookup.js'

const HELP = `isv-dict — local Interslavic dictionary lookup

Usage:
  isv-dict lookup <words…> [options]   words in any language → Interslavic dictionary entries
  isv-dict forms <words…> [options]    Interslavic words → all their inflected forms
  isv-dict update                      download the dictionary again and rebuild the index
  isv-dict info                        where the data is, how fresh, which languages
  isv-dict serve [--port 8787]         HTTP API on 127.0.0.1 (GET/POST /lookup, /forms, /info)
  isv-dict mcp                         MCP server on stdio (tools isv_lookup, isv_forms)

Words are separated by commas (or given as separate arguments); quote a phrase:
  isv-dict lookup "собака, дом" pisati --langs min
  isv-dict lookup "железная дорога" --forms
  isv-dict forms pes "učiti sę" id:141 --script cyrillic

Pass dictionary forms (nominative singular, infinitive). Inflected forms are recognised only
for Interslavic words.

Options of lookup:
  --langs <v>     ${PARAMETERS.langs}
  --forms         ${PARAMETERS.forms}
  --from <codes>  ${PARAMETERS.from}
  --limit <n>     ${PARAMETERS.limit}

Options of lookup and forms:
  --script <v>    ${PARAMETERS.script}
  --max-chars <n> Shorten the answer to about this many characters of JSON (default: no limit).
  --pretty        Indent the JSON.
`

const log = (message) => process.stderr.write(`${message}\n`)

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            'langs': { type: 'string' },
            'forms': { type: 'boolean' },
            'from': { type: 'string' },
            'script': { type: 'string' },
            'limit': { type: 'string' },
            'max-chars': { type: 'string' },
            'pretty': { type: 'boolean' },
            'port': { type: 'string' },
            'host': { type: 'string' },
            'help': { type: 'boolean', short: 'h' },
        },
    })
    const [command, ...words] = positionals
    const print = (value) => process.stdout.write(`${JSON.stringify(value, null, values.pretty ? 2 : 0)}\n`)

    if (values.help || !command || command === 'help') {
        process.stdout.write(HELP)

        return
    }

    switch (command) {
        case 'lookup':
            print(lookup(await openDict({ log }), words, {
                langs: values.langs,
                forms: values.forms,
                from: values.from,
                script: values.script,
                limit: values.limit,
                maxChars: values['max-chars'],
            }))
            break
        case 'forms':
            print(forms(await openDict({ log }), words, {
                script: values.script,
                limit: values.limit,
                maxChars: values['max-chars'],
            }))
            break
        case 'update':
            await refreshDict({ log })
            break
        case 'info':
            print(describeDict(await openDict({ log })))
            break
        case 'serve': {
            const { startServer } = await import('./http.js')

            await startServer({ port: values.port, host: values.host, log })
            break
        }
        case 'mcp':
            await import('./mcp.js')
            break
        default:
            throw new UsageError(`Unknown command "${command}". Run "isv-dict help".`)
    }
}

main().catch((error) => {
    // a wrong option or value is the caller's mistake: one line and exit code 2, no stack trace
    const isUsageError = error instanceof UsageError || String(error.code).startsWith('ERR_PARSE_ARGS')

    log(isUsageError ? error.message : (error.stack ?? String(error)))
    process.exitCode = isUsageError ? 2 : 1
})
