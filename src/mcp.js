#!/usr/bin/env node
// MCP server on stdio with two tools: isv_lookup and isv_forms.
// stdout belongs to the protocol — everything else is written to stderr.

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'

import { openDict } from './dict.js'
import { FORMS_DESCRIPTION, LOOKUP_DESCRIPTION, PARAMETERS, forms, lookup } from './lookup.js'
import { SCRIPTS } from './text.js'

// MCP clients cut off or reject long tool results (Claude Code: about 25k tokens), so answers are
// shortened to this many characters of JSON; what was left out is named in the answer's `note`.
// Cyrillic and diacritics cost roughly a token per two characters, hence the margin.
const DEFAULT_MAX_CHARS = 30_000

const log = (message) => process.stderr.write(`${message}\n`)
const getDict = () => openDict({ log })

function configuredMaxChars() {
    const setting = process.env.ISV_DICT_MAX_CHARS

    if (setting === undefined || setting === '') {
        return DEFAULT_MAX_CHARS
    }

    const value = Number(setting)

    if (Number.isInteger(value) && value >= 1000 && value <= 10_000_000) {
        return value
    }

    log(`ISV_DICT_MAX_CHARS="${setting}" is not a whole number from 1000 to 10000000 — using ${DEFAULT_MAX_CHARS}`)

    return DEFAULT_MAX_CHARS
}

const maxChars = configuredMaxChars()

function tool(handler) {
    return async ({ words, ...options }) => {
        try {
            const result = handler(await getDict(), words, { ...options, maxChars })

            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${error.message ?? error}` }], isError: true }
        }
    }
}

// A list is the natural shape, but models now and then send one comma-separated string — the
// handlers take both, as they do over HTTP and in the CLI.
const listOrString = (description) => z.union([z.array(z.string()), z.string()]).describe(description)

function createServer() {
    const server = new McpServer({ name: 'isv-dict', version: '0.1.0' })
    const script = z.enum(SCRIPTS).optional().describe(PARAMETERS.script)

    server.registerTool('isv_lookup', {
        title: 'Interslavic dictionary lookup',
        description: LOOKUP_DESCRIPTION,
        inputSchema: z.object({
            words: listOrString(`${PARAMETERS.words} Any language, dictionary forms.`),
            langs: listOrString(PARAMETERS.langs).optional(),
            forms: z.boolean().optional().describe(PARAMETERS.forms),
            from: listOrString(PARAMETERS.from).optional(),
            script,
            limit: z.number().int().min(1).max(50).optional().describe(PARAMETERS.limit),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, tool(lookup))

    server.registerTool('isv_forms', {
        title: 'Interslavic word forms',
        description: FORMS_DESCRIPTION,
        inputSchema: z.object({
            words: listOrString(
                'Interslavic words — dictionary or inflected forms, Latin or Cyrillic — or id:<number> from isv_lookup.',
            ),
            script,
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, tool(forms))

    return server
}

serveStdio(createServer, { onerror: (error) => log(`MCP error: ${error.message}`) })
log('isv-dict MCP server is running on stdio')
// load the dictionary right away so that the first tool call does not wait for it
getDict().catch((error) => log(`Could not load the dictionary: ${error.message}`))
