/**
 * Server-side glue for hooking debug-next into a Next.js app's
 * `instrumentation.ts`.
 *
 *  - `attachFileWriter`: installs the raw-line hook on the global
 *    `LogBase`. With `resetOnStart`, also truncates the log file once
 *    per process before appending.
 *  - `createOnRequestError`: returns an `onRequestError` handler that
 *    appends a terminal-style block per server error and optionally
 *    forwards to Sentry.
 *
 * File writes live in `./file-writer.ts`. This module just wires them
 * to Next.js's instrumentation surfaces.
 */

import { inspect } from 'util'
import { LogBase } from '../index'
import {
    appendRaw,
    createFileWriterHook,
    isFileWritingDisabled,
    resetLogFile,
    resolveLogDir,
    teeStdStreams,
    type TFileWriterOptions,
    type TTeeStdStreamsOptions,
} from './file-writer'

export { appendRaw, createFileWriterHook, resetLogFile, resolveLogDir, teeStdStreams }
export type { TFileWriterOptions, TTeeStdStreamsOptions }

const HOOK_NAME = 'debug-next/fileWriter'

export type TAttachFileWriterOptions = {
    appName: string
    logDir?: string
    /**
     * Controls whether `LogBase.init()` is called. Pass `false` when the
     * host has already initialized LogBase (e.g. an Express app already
     * using debug-next). Pass an object to override `baseDir`.
     */
    initLogBase?: boolean | { baseDir: string }
    /**
     * Truncate `<appName>.log` once at process startup so each restart
     * begins with a clean view. Defaults to `true`. Idempotent across
     * hot reloads within the same process (a module-level Set prevents
     * mid-session events from being wiped). Pass `false` to keep
     * history across restarts.
     */
    resetOnStart?: boolean
}

/**
 * Install the raw-line file-writer hook on the global `LogBase`.
 * Idempotent: silently no-ops if `LogBase` is already initialized or
 * the hook is already attached.
 */
export const attachFileWriter = (opts: TAttachFileWriterOptions): void => {
    if (process.env.NEXT_RUNTIME === 'edge') return

    if (opts.resetOnStart !== false) {
        resetLogFile({ appName: opts.appName, logDir: opts.logDir })
    }

    if (opts.initLogBase !== false) {
        const baseDir =
            typeof opts.initLogBase === 'object'
                ? opts.initLogBase.baseDir
                : process.cwd()
        try {
            LogBase.init(opts.appName, baseDir)
        } catch {
            // already initialized
        }
    }

    // When file writes are disabled (prod by default, or DEBUG_NEXT_DISABLE),
    // skip attaching the hook so it doesn't fire on every Log() call only to
    // no-op inside appendRaw. LogBase.init above is preserved either way so
    // other hooks the host attaches (e.g. Sentry) still work.
    if (isFileWritingDisabled()) return

    const hook = createFileWriterHook({ appName: opts.appName, logDir: opts.logDir })
    try {
        LogBase.attachHook('all', HOOK_NAME, hook)
    } catch {
        // hook already attached
    }
}

type TNextRequestLike = {
    path: string
    method: string
    headers: Record<string, string | string[] | undefined>
}

type TNextRouteContext = {
    routerKind: string
    routePath: string
    routeType: string
    renderSource?: string
    revalidateReason?: string
}

type TOnRequestError = (
    error: unknown,
    request: TNextRequestLike,
    context: TNextRouteContext,
) => void | Promise<void>

export type TCreateOnRequestErrorOptions = {
    appName: string
    logDir?: string
    /** Existing Sentry handler to compose with (e.g. `Sentry.captureRequestError`). */
    sentry?: TOnRequestError
}

const formatRequestError = (
    appName: string,
    error: unknown,
    request: TNextRequestLike,
    context: TNextRouteContext,
): string => {
    const err = error instanceof Error ? error : new Error(String(error))
    const route = context?.routeType ?? 'route'
    const reqLine = `${request.method ?? ''} ${request.path ?? ''}`.trim()
    const header = `[${new Date().toISOString()}] [${appName}] logError ${route} — ${
        reqLine || '(no request)'
    }`
    const body = inspect(err, { depth: 4, colors: false, breakLength: 120 })
    return `${header}\n${body}\n\n`
}

/**
 * Build a Next.js `onRequestError` handler that appends a
 * terminal-style block per server error to `<appName>.log` and, if
 * configured, also calls the supplied Sentry handler. Failures in the
 * Sentry handler are swallowed — Next.js's error path must never throw.
 *
 * Usage in `instrumentation.ts`:
 * ```ts
 * import * as Sentry from '@sentry/nextjs'
 * import { createOnRequestError } from 'debug-next/nextjs'
 *
 * export const onRequestError = createOnRequestError({
 *     appName: 'dashboard',
 *     sentry: Sentry.captureRequestError,
 * })
 * ```
 */
export const createOnRequestError = (
    opts: TCreateOnRequestErrorOptions,
): TOnRequestError => {
    return async (error, request, context) => {
        appendRaw(formatRequestError(opts.appName, error, request, context), {
            appName: opts.appName,
            ...(opts.logDir ? { logDir: opts.logDir } : {}),
        })

        if (opts.sentry) {
            try {
                await opts.sentry(error, request, context)
            } catch {
                // never throw from instrumentation
            }
        }
    }
}
