// Downloading and parsing the Interslavic dictionary sheet — the same Google Sheet the web app
// at https://interslavic-dictionary.com is built from (see `tablesData` in its src/consts.ts).

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { LANGS } from './text.js'

const SPREADSHEET_ID = '1N79e_yVHDo-d026HljueuKJlAAdeELAiPzdFzdBuKbY'
const MIN_ROWS = 10000

const SHEETS = [
    {
        name: 'words',
        gid: '1987833874',
        file: 'words.tsv',
        required: ['id', 'isv', 'addition', 'partOfSpeech', 'type', 'en', 'ru', 'pl'],
    },
    {
        name: 'words_add_lang',
        gid: '2005431854',
        file: 'words_add_lang.tsv',
        required: ['id', 'csb', 'es', 'fr'],
    },
]

export const DATA_DIR = process.env.ISV_DICT_DATA_DIR
    ? path.resolve(process.env.ISV_DICT_DATA_DIR)
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')

const META_FILE = 'meta.json'

const sheetUrl = (gid) => `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=tsv&gid=${gid}`

/**
 * The sheet has no quoting, so a table is just lines of tab-separated cells.
 * `#` is an editorial marker in the sheet; the web app drops every one of them, and so do we.
 * Some cells also carry invisible characters (zero-width spaces, soft hyphens, stray control
 * codes) that would break both searching and the output.
 */
export function parseTsv(text) {
    const clean = (cell) => cell.replace(/[\p{Cc}\p{Cf}\p{Co}]/gu, '').trim()
    const lines = text
        .replace(/#/g, '')
        .split('\n')
        .map((line) => line.split('\t').map(clean))
        .filter((cells) => cells.some(Boolean))

    return { header: lines[0] ?? [], rows: lines.slice(1) }
}

// A column name may repeat (the second sheet mirrors the base columns); the first one wins.
function indexColumns(header) {
    const columns = new Map()

    header.forEach((name, i) => {
        if (name && !columns.has(name)) {
            columns.set(name, i)
        }
    })

    return columns
}

/**
 * @typedef {object} Entry
 * @property {number} id
 * @property {string} isv headword(s) in etymological Latin, comma-separated when there are variants
 * @property {boolean} removed the sheet marks this word as suggested for removal
 * @property {string} addition
 * @property {string} pos raw part-of-speech tag, e.g. `m.anim.`
 * @property {string} type
 * @property {number|null} frequency
 * @property {string} intelligibility
 * @property {Record<string, string>} tr raw non-empty translation cells; a leading `!` = unverified
 */

/**
 * Merges the main sheet with the additional-languages sheet (joined by `id`).
 * @returns {Entry[]}
 */
export function parseSheets(mainTsv, extraTsv = '') {
    const main = parseTsv(mainTsv)
    const mainColumns = indexColumns(main.header)

    for (const name of ['id', 'isv']) {
        if (!mainColumns.has(name)) {
            throw new Error(`The words sheet has no "${name}" column`)
        }
    }

    const extra = parseTsv(extraTsv)
    const extraColumns = indexColumns(extra.header)
    const extraLangs = LANGS.filter((lang) => !mainColumns.has(lang) && extraColumns.has(lang))
    const extraById = new Map()

    if (extraLangs.length) {
        const idColumn = extraColumns.get('id')

        for (const row of extra.rows) {
            extraById.set(row[idColumn], row)
        }
    }

    const entries = []

    for (const row of main.rows) {
        const get = (name) => (mainColumns.has(name) ? row[mainColumns.get(name)] ?? '' : '')
        const id = get('id')
        const removed = get('isv').startsWith('!')
        const isv = removed ? get('isv').slice(1).trim() : get('isv')

        if (!/^-?\d+$/.test(id) || !isv) {
            continue
        }

        const extraRow = extraById.get(id)
        const tr = {}

        for (const lang of LANGS) {
            const cell = mainColumns.has(lang)
                ? get(lang)
                : (extraRow && extraColumns.has(lang) && extraRow[extraColumns.get(lang)]) || ''

            if (cell && cell !== '!') {
                tr[lang] = cell
            }
        }

        const frequency = Number.parseFloat(get('frequency'))

        entries.push({
            id: Number(id),
            isv,
            removed,
            addition: get('addition'),
            pos: get('partOfSpeech'),
            type: get('type'),
            frequency: Number.isFinite(frequency) ? frequency : null,
            intelligibility: get('intelligibility'),
            tr,
        })
    }

    return entries.sort((a, b) => a.id - b.id)
}

function validateSheet(sheet, text) {
    const { header, rows } = parseTsv(text)
    const missing = sheet.required.filter((name) => !header.includes(name))

    if (missing.length) {
        throw new Error(`Sheet "${sheet.name}" has no column(s) ${missing.join(', ')} — did its layout change?`)
    }

    if (rows.length < MIN_ROWS) {
        throw new Error(`Sheet "${sheet.name}" has only ${rows.length} rows, expected at least ${MIN_ROWS}`)
    }

    return rows.length
}

/**
 * Downloads both sheets and replaces the local copies only when everything is valid.
 * @param {{dataDir?: string, log?: (message: string) => void}} [options]
 */
export async function update({ dataDir = DATA_DIR, log = () => {} } = {}) {
    const downloads = []

    for (const sheet of SHEETS) {
        log(`Downloading sheet "${sheet.name}"…`)

        const response = await fetch(sheetUrl(sheet.gid), { redirect: 'follow' })

        if (!response.ok) {
            throw new Error(`Sheet "${sheet.name}": HTTP ${response.status} ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type') ?? ''

        if (!contentType.includes('tab-separated-values')) {
            throw new Error(`Sheet "${sheet.name}": unexpected content type "${contentType}" — is the sheet still public?`)
        }

        const text = await response.text()

        downloads.push({ sheet, text, rows: validateSheet(sheet, text) })
    }

    await mkdir(dataDir, { recursive: true })

    for (const { sheet, text } of downloads) {
        const target = path.join(dataDir, sheet.file)
        const temporary = `${target}.${process.pid}.tmp`

        await writeFile(temporary, text)
        await rename(temporary, target)
    }

    const meta = {
        downloadedAt: new Date().toISOString(),
        source: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
        sheets: downloads.map(({ sheet, text, rows }) => ({
            name: sheet.name,
            gid: sheet.gid,
            file: sheet.file,
            bytes: Buffer.byteLength(text),
            rows,
        })),
    }

    await writeFile(path.join(dataDir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`)
    log(`Saved ${downloads.map(({ sheet, rows }) => `${sheet.file} (${rows} rows)`).join(', ')} to ${dataDir}`)

    return meta
}

/**
 * Reads the downloaded sheets. Throws an error with `code: 'ENOENT'` when they are not there yet.
 * @returns {Promise<{entries: Entry[], sha: string, meta: object|null}>}
 */
export async function loadSource(dataDir = DATA_DIR) {
    const [mainTsv, extraTsv] = await Promise.all(
        SHEETS.map((sheet) => readFile(path.join(dataDir, sheet.file), 'utf8')),
    )
    const sha = createHash('sha1').update(mainTsv).update(extraTsv).digest('hex')

    let meta = null

    try {
        meta = JSON.parse(await readFile(path.join(dataDir, META_FILE), 'utf8'))
    } catch {
        // the sheets are usable without the download record
    }

    return { entries: parseSheets(mainTsv, extraTsv), sha, meta }
}
