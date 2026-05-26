/**
 * Persists raw log text to `<logDir>/<appName>.log`. The file is meant
 * to mirror what a developer sees scrolling by in the terminal — same
 * format, same content, with ANSI escape codes stripped so the file
 * stays clean.
 *
 * Three public APIs:
 *
 *  - `appendRaw(text, opts)`: append a string verbatim (after ANSI
 *    strip). Used by the CLI to tee child stdout/stderr to disk and by
 *    the server/route helpers to emit synthesized lines.
 *  - `resetLogFile(opts)`: truncate the log file. Idempotent per
 *    process via a module-level Set, so hot reloads don't keep
 *    clobbering mid-session content.
 *  - `createFileWriterHook(opts)`: returns a `LogBase` hook that writes
 *    one terminal-style line per log call.
 */

import * as fs from 'fs'
import * as path from 'path'
import { inspect } from 'util'
import type { TDebugHook } from '../index'

export type TFileWriterOptions = {
    appName: string
    logDir?: string
}

// Keyed by cwd so a process that changes directory mid-run (rare, but
// possible inside test harnesses or scripts) still resolves correctly.
const logDirByCwd = new Map<string, string>()
const dirsEnsured = new Set<string>()
const filesReset = new Set<string>()

const REPO_ROOT_WALK_MAX = 20
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g

const findRepoRoot = (start: string): string => {
    let cur = start
    for (let i = 0; i < REPO_ROOT_WALK_MAX; i++) {
        try {
            if (fs.existsSync(path.join(cur, '.git'))) return cur
        } catch {
            // ignore — fall through to next parent
        }
        const parent = path.dirname(cur)
        if (parent === cur) break
        cur = parent
    }
    return start
}

/**
 * Resolve the directory the log file lives in. Precedence:
 *   1. Explicit `override`.
 *   2. `DEBUG_NEXT_LOG_DIR` env var.
 *   3. `<repo-root>/.debug-next` (repo root discovered by walking up for `.git`).
 *   4. `<cwd>/.debug-next` if no `.git` ancestor exists.
 */
export const resolveLogDir = (override?: string): string => {
    if (override) return override
    if (process.env.DEBUG_NEXT_LOG_DIR) return process.env.DEBUG_NEXT_LOG_DIR
    const cwd = process.cwd()
    const cached = logDirByCwd.get(cwd)
    if (cached) return cached
    const resolved = path.join(findRepoRoot(cwd), '.debug-next')
    logDirByCwd.set(cwd, resolved)
    return resolved
}

export const isFileWritingDisabled = (): boolean => {
    if (typeof process === 'undefined') return true
    if (process.env.DEBUG_NEXT_DISABLE === 'true') return true
    if (process.env.NEXT_RUNTIME === 'edge') return true
    // Off by default in production. Self-hosted servers that want
    // disk logs in prod can opt in with `DEBUG_NEXT_FORCE=true`.
    if (
        process.env.NODE_ENV === 'production' &&
        process.env.DEBUG_NEXT_FORCE !== 'true'
    ) {
        return true
    }
    return false
}

const logFilePath = (opts: TFileWriterOptions): string =>
    path.join(resolveLogDir(opts.logDir), `${opts.appName}.log`)

const ensureDir = (dir: string): void => {
    if (dirsEnsured.has(dir)) return
    fs.mkdirSync(dir, { recursive: true })
    dirsEnsured.add(dir)
}

/**
 * Append raw text to the app's log file. ANSI escape codes are stripped.
 * Never throws.
 */
export const appendRaw = (text: string, opts: TFileWriterOptions): void => {
    if (isFileWritingDisabled()) return
    const fp = logFilePath(opts)
    try {
        ensureDir(path.dirname(fp))
        fs.appendFileSync(fp, text.replace(ANSI_RE, ''))
    } catch {
        // hook must never throw
    }
}

/**
 * Truncate the app's log file. Idempotent within a single process — a
 * second call from the same Node process (e.g. after a hot reload) is a
 * no-op, so in-session events aren't wiped.
 */
export const resetLogFile = (opts: TFileWriterOptions): void => {
    if (isFileWritingDisabled()) return
    const fp = logFilePath(opts)
    if (filesReset.has(fp)) return
    try {
        ensureDir(path.dirname(fp))
        fs.writeFileSync(fp, '')
        filesReset.add(fp)
    } catch {
        // best effort
    }
}

const PIPE_FLAG = Symbol.for('debug-next/pipe-to-file-installed')
const MAX_PENDING_BYTES = 1_048_576 * 5 // 5 MiB

type TWrappedStream = NodeJS.WriteStream & { [PIPE_FLAG]?: true }

export type TPipeStdStreamsToFileOptions = TFileWriterOptions & {
    /**
     * Truncate `<appName>.log` once at process startup. Defaults to
     * `true`. Idempotent across hot reloads within the same process.
     */
    resetOnStart?: boolean
}

/**
 * Wrap `process.stdout.write` and `process.stderr.write` so every byte
 * written to the terminal is also appended verbatim (ANSI-stripped) to
 * `<appName>.log`. Captures everything the developer sees — Express's
 * morgan output, debug-next's namespaced lines, `console.log`, error
 * stacks — without needing a `LogBase` hook.
 *
 * Idempotent across hot reloads via a symbol on the stream object.
 */
export const pipeStdStreamsToFile = (opts: TPipeStdStreamsToFileOptions): void => {
    if (isFileWritingDisabled()) return

    if (opts.resetOnStart !== false) {
        resetLogFile({ appName: opts.appName, logDir: opts.logDir })
    }

    const writeOpts: TFileWriterOptions = {
        appName: opts.appName,
        ...(opts.logDir ? { logDir: opts.logDir } : {}),
    }

    const wrap = (stream: TWrappedStream): void => {
        if (stream[PIPE_FLAG]) return
        const original = stream.write.bind(stream)
        // Per-stream buffer holds the trailing partial line until a
        // newline arrives — so we don't stamp the same logical line twice
        // when a write is chunked.
        let pending = ''

        stream.write = function teedWrite(
            chunk: string | Uint8Array,
            ...rest: unknown[]
        ): boolean {
            try {
                const text =
                    typeof chunk === 'string'
                        ? chunk
                        : Buffer.isBuffer(chunk)
                        ? chunk.toString('utf-8')
                        : ''
                if (text) {
                    pending += text
                    const newlineAt = pending.lastIndexOf('\n')
                    if (newlineAt >= 0) {
                        const completeLines = pending.slice(0, newlineAt)
                        pending = pending.slice(newlineAt + 1)
                        const ts = new Date().toISOString()
                        const stamped = completeLines
                            .split('\n')
                            .map(line => `[${ts}] ${line}`)
                            .join('\n')
                        appendRaw(`${stamped}\n`, writeOpts)
                    }
                    // Force-flush an oversized partial line so a long
                    // newline-less stream (binary dump, single-line JSON
                    // blob) can't grow `pending` without bound.
                    if (pending.length > MAX_PENDING_BYTES) {
                        appendRaw(`[${new Date().toISOString()}] ${pending}\n`, writeOpts)
                        pending = ''
                    }
                }
            } catch {
                // never let a logger break the host
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (original as any)(chunk, ...rest)
        } as typeof stream.write
        stream[PIPE_FLAG] = true
    }

    wrap(process.stdout as TWrappedStream)
    wrap(process.stderr as TWrappedStream)
}

/**
 * Build a `LogBase` hook suitable for `LogBase.attachHook('all', name, hook)`.
 * Each log call becomes one line in the file, formatted to look like
 * Node's terminal output. Error subclasses (e.g. Snag) are inspected
 * with `util.inspect`, so their enumerable properties (breadcrumbs,
 * info, etc.) appear in the file instead of being silently dropped.
 */
export const createFileWriterHook = (opts: TFileWriterOptions): TDebugHook => {
    return (args, level, _isEnabled, scope) => {
        const formatted = inspect(args.length === 1 ? args[0] : args, {
            depth: 4,
            colors: false,
            breakLength: 120,
        })
        const tag = scope ? `${level} ${scope}` : level
        appendRaw(
            `[${new Date().toISOString()}] [${opts.appName}] ${tag}: ${formatted}\n`,
            opts,
        )
    }
}
