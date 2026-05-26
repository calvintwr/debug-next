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

const truncate = (s: string, max: number): string =>
    s.length > max ? s.slice(0, max) : s

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

const isSafeForLog = (ch: string): boolean => {
    const code = ch.charCodeAt(0)
    // Printable ASCII (and any non-ASCII character — emoji, accented
    // letters, CJK, etc.) is fine.
    if (code >= 0x20 && code !== DEL) return true
    // Below 0x20 we only allow the three whitespace controls.
    return code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN
}

const stripUnsafeChars = (s: string): string => {
    let out = ''
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]
        if (isSafeForLog(ch)) out += ch
    }
    return out
}

const collapseLineBreaks = (s: string): string => {
    let out = ''
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]
        out += ch === '\n' || ch === '\r' ? ' ' : ch
    }
    return out
}

// For headers (message, scope, digest, etc.): also collapse newlines
// into spaces so an attacker can't inject a forged "[ts] [app] FORGED
// LINE" entry by sneaking a `\n` into the payload.
const sanitizeSingleLine = (s: string): string => collapseLineBreaks(stripUnsafeChars(s))

// For multi-line fields (stack): keep newlines — a real stack trace
// spans several lines.
const sanitizeMultiLine = (s: string): string => stripUnsafeChars(s)

const asSingleLine = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' ? truncate(sanitizeSingleLine(v), max) : undefined

const asMultiLine = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' ? truncate(sanitizeMultiLine(v), max) : undefined

const MAX_META_BYTES = 8_000
const safeMeta = (m: unknown): string | undefined => {
    if (!Array.isArray(m) || m.length === 0) return undefined
    try {
        const serialized = JSON.stringify(m)
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
    const p = raw as TClientPayload

    const source =
        typeof p.source === 'string' && CLIENT_SOURCES.has(p.source)
            ? p.source
            : 'client-error'
    const ts = asSingleLine(p.ts, 64) ?? new Date().toISOString()
    const appName = asSingleLine(p.appName, 128) ?? fallbackAppName
    const level = asSingleLine(p.level, 32) ?? 'logError'
    const message = asSingleLine(p.message, 4000) ?? ''
    const stack = asMultiLine(p.stack, 16_000)
    const scope = asSingleLine(p.scope, 256)
    const digest = asSingleLine(p.digest, 256)

    const header = [`[${ts}]`, `[${appName}]`, level, source]
        .concat(scope ? [scope] : [])
        .concat(digest ? [`digest=${digest}`] : [])
        .join(' ')

    const lines: string[] = [`${header} — ${message}`]
    if (stack) lines.push(stack)
    const meta = safeMeta(p.meta)
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
export const createDebugNextRoute = (opts: TCreateDebugNextRouteOptions) => {
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

        const formatted = formatClientEvent(body, opts.appName)
        if (!formatted) {
            return jsonResponse({ ok: false, error: 'invalid_payload' }, 400)
        }

        appendRaw(formatted, opts)
        return jsonResponse({ ok: true })
    }

    return { POST }
}
