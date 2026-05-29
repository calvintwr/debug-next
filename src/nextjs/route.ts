/**
 * Builds the App Router POST handler that receives client error events
 * from `registerClientCapture` and appends them to the app's log file
 * as terminal-style blocks.
 */

import { appendRaw, isFileWritingDisabled } from './file-writer'

export type TCreateDebugNextRouteOptions = {
    appName: string
    logDir?: string
}

const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })

const truncate = (value: string, maxLength: number): string =>
    value.length > maxLength ? value.slice(0, maxLength) : value

// We drop ASCII control characters from anything the client sends so a
// malicious payload can't slip terminal escapes, null bytes, or forged
// log entries into the file (which an AI session may read).
//
// Three control characters stay because stack traces and code excerpts
// legitimately need them:
const TAB = 0x09
const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d
const DEL = 0x7f

const isSafeForLog = (character: string): boolean => {
    const code = character.charCodeAt(0)
    // Printable ASCII (and any non-ASCII character — emoji, accented
    // letters, CJK, etc.) is fine.
    if (code >= 0x20 && code !== DEL) return true
    // Below 0x20 we only allow the three whitespace controls.
    return code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN
}

const stripUnsafeChars = (input: string): string => {
    let sanitized = ''
    for (let index = 0; index < input.length; index++) {
        const character = input[index]
        if (isSafeForLog(character)) sanitized += character
    }
    return sanitized
}

const collapseLineBreaks = (input: string): string => {
    let result = ''
    for (let index = 0; index < input.length; index++) {
        const character = input[index]
        result += character === '\n' || character === '\r' ? ' ' : character
    }
    return result
}

// For headers (message, scope, digest, etc.): also collapse newlines
// into spaces so an attacker can't inject a forged "[ts] [app] FORGED
// LINE" entry by sneaking a `\n` into the payload.
const sanitizeSingleLine = (input: string): string =>
    collapseLineBreaks(stripUnsafeChars(input))

// For multi-line fields (stack): keep newlines — a real stack trace
// spans several lines.
const sanitizeMultiLine = (input: string): string => stripUnsafeChars(input)

const asSingleLine = (value: unknown, maxLength: number): string | undefined =>
    typeof value === 'string' ? truncate(sanitizeSingleLine(value), maxLength) : undefined

const asMultiLine = (value: unknown, maxLength: number): string | undefined =>
    typeof value === 'string' ? truncate(sanitizeMultiLine(value), maxLength) : undefined

const MAX_META_BYTES = 8_000
const safeMeta = (meta: unknown): string | undefined => {
    if (!Array.isArray(meta) || meta.length === 0) return undefined
    try {
        const serialized = JSON.stringify(meta)
        return serialized.length > MAX_META_BYTES
            ? `${serialized.slice(0, MAX_META_BYTES)}… (truncated)`
            : serialized
    } catch {
        return undefined
    }
}

const CLIENT_SOURCES = new Set(['client-error', 'client-rejection', 'global-error'])

type TClientPayload = {
    appName?: unknown
    source?: unknown
    level?: unknown
    message?: unknown
    stack?: unknown
    digest?: unknown
    scope?: unknown
    meta?: unknown
    ts?: unknown
}

const formatClientEvent = (raw: unknown, fallbackAppName: string): string | null => {
    if (!raw || typeof raw !== 'object') return null
    const payload = raw as TClientPayload

    const source =
        typeof payload.source === 'string' && CLIENT_SOURCES.has(payload.source)
            ? payload.source
            : 'client-error'
    const timestamp = asSingleLine(payload.ts, 64) ?? new Date().toISOString()
    const appName = asSingleLine(payload.appName, 128) ?? fallbackAppName
    const level = asSingleLine(payload.level, 32) ?? 'logError'
    const message = asSingleLine(payload.message, 4000) ?? ''
    const stack = asMultiLine(payload.stack, 16_000)
    const scope = asSingleLine(payload.scope, 256)
    const digest = asSingleLine(payload.digest, 256)

    const header = [`[${timestamp}]`, `[${appName}]`, level, source]
        .concat(scope ? [scope] : [])
        .concat(digest ? [`digest=${digest}`] : [])
        .join(' ')

    const lines: string[] = [`${header} — ${message}`]
    if (stack) lines.push(stack)
    const meta = safeMeta(payload.meta)
    if (meta) lines.push(`meta: ${meta}`)
    return `${lines.join('\n')}\n\n`
}

/**
 * Usage — `app/api/_debug-next/route.ts`:
 * ```ts
 * import { createDebugNextRoute } from 'debug-next/nextjs/route'
 * export const runtime = 'nodejs'
 * export const { POST } = createDebugNextRoute({ appName: 'dashboard' })
 * ```
 *
 * ⚠️ **Do not enable this endpoint in production.** The handler accepts
 * unauthenticated POSTs from any caller (it has to — the browser fires
 * `window.onerror` / `unhandledrejection` without credentials) and writes
 * the body to a local file the AI copilot reads. In production that's
 * three problems at once:
 *
 *   1. **Public write surface.** Anyone on the internet can append to
 *      your log file (up to the per-field caps in `formatClientEvent`).
 *   2. **AI prompt-injection risk.** The file is consumed by AI sessions;
 *      attacker-controlled text in a log they read is a real vector even
 *      with the newline / control-char sanitization applied below.
 *   3. **No durable value.** On Vercel/serverless the writes silently
 *      fail anyway; on self-hosted servers the file grows unbounded.
 *
 * The handler short-circuits to 404 when `NODE_ENV=production` unless
 * `DEBUG_NEXT_FORCE=true` is set — and even then you should think hard
 * about whether you actually want this. Sentry is the right durable
 * sink for production client errors. `debug-next` is a dev-loop tool.
 */
export const createDebugNextRoute = (options: TCreateDebugNextRouteOptions) => {
    const POST = async (request: Request): Promise<Response> => {
        // 404 in production (or whenever writes are disabled) so the
        // endpoint doesn't leak its existence and refuses to parse the
        // body. See the JSDoc above for why this is intentionally strict.
        if (isFileWritingDisabled()) {
            return jsonResponse({ error: 'not_found' }, 404)
        }

        let body: unknown
        try {
            body = await request.json()
        } catch {
            return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
        }

        const formatted = formatClientEvent(body, options.appName)
        if (!formatted) {
            return jsonResponse({ ok: false, error: 'invalid_payload' }, 400)
        }

        appendRaw(formatted, options)
        return jsonResponse({ ok: true })
    }

    return { POST }
}
