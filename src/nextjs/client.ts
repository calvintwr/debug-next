/**
 * Browser-only helpers. Two exports:
 *
 *  - `registerClientCapture`: installs `window.onerror` and
 *    `unhandledrejection` listeners that POST the captured event to the
 *    debug-next route handler. Idempotent per page.
 *  - `reportClientEvent`: post a single event manually — used from
 *    `global-error.tsx` and other React error boundaries.
 *
 * Has no Node-only imports, so it's safe to include in any client bundle
 * (e.g. `instrumentation-client.ts`).
 */

export type TClientEventInput = {
    appName: string
    source: 'client-error' | 'client-rejection' | 'global-error'
    level?: string
    message: string
    stack?: string
    digest?: string
    scope?: string | null
    meta?: unknown[]
}

export type TRegisterClientCaptureOptions = {
    appName: string
    /** Route the browser POSTs error events to. Default: `/api/_debug-next`. */
    endpoint?: string
}

const safePost = (endpoint: string, payload: unknown): void => {
    let body: string
    try {
        body = JSON.stringify(payload)
    } catch {
        return
    }

    try {
        if (
            typeof navigator !== 'undefined' &&
            typeof navigator.sendBeacon === 'function'
        ) {
            const blob = new Blob([body], { type: 'application/json' })
            if (navigator.sendBeacon(endpoint, blob)) return
        }
    } catch {
        // fall through to fetch
    }

    try {
        void fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
        })
    } catch {
        // swallow — nothing more we can do client-side
    }
}

/**
 * Build the JSON payload sent to the route handler. Exposed so consumers
 * (e.g. `global-error.tsx`) can construct one directly without going through
 * the listeners.
 */
export const reportClientEvent = (endpoint: string, input: TClientEventInput): void => {
    safePost(endpoint, {
        appName: input.appName,
        source: input.source,
        level: input.level ?? 'logError',
        message: input.message,
        stack: input.stack,
        digest: input.digest,
        scope: input.scope ?? null,
        meta: input.meta,
        ts: new Date().toISOString(),
    })
}

/**
 * Install global error listeners that forward uncaught errors and unhandled
 * rejections to the debug-next route handler. Idempotent — safe to call once
 * per page from `instrumentation-client.ts`.
 *
 * No-ops when `process.env.NODE_ENV === 'production'` so production
 * browsers don't fire pointless POSTs at a server-side route that's
 * also no-op in prod (the route handler returns 404 there). Next.js
 * inlines `process.env.NODE_ENV` into client bundles at build time, so
 * this check costs nothing at runtime.
 */
export const registerClientCapture = (opts: TRegisterClientCaptureOptions): void => {
    if (typeof window === 'undefined') return
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
        return
    }

    const endpoint = opts.endpoint ?? '/api/_debug-next'
    const flag = '__debug_next_capture_installed__'
    const w = window as unknown as Record<string, unknown>
    if (w[flag]) return
    w[flag] = true

    window.addEventListener('error', event => {
        const err = event.error instanceof Error ? event.error : null
        reportClientEvent(endpoint, {
            appName: opts.appName,
            source: 'client-error',
            message: err?.message ?? event.message ?? 'Uncaught error',
            stack: err?.stack,
            scope: event.filename
                ? `${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}`
                : null,
        })
    })

    window.addEventListener('unhandledrejection', event => {
        const reason = event.reason
        const err = reason instanceof Error ? reason : null
        const message =
            err?.message ??
            (typeof reason === 'string' ? reason : 'Unhandled promise rejection')
        reportClientEvent(endpoint, {
            appName: opts.appName,
            source: 'client-rejection',
            message,
            stack: err?.stack,
            meta: err ? undefined : [reason],
        })
    })
}
