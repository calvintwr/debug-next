/**
 * Persists raw log text to `<logDir>/<appName>.log`. The file is meant
 * to mirror what a developer sees scrolling by in the terminal — same
 * format, same content, with ANSI escape codes stripped so the file
 * stays clean.
 *
 * Three public APIs:
 *
 *  - `appendRaw(text, options)`: append a string verbatim (after ANSI
 *    strip). Used by the CLI to mirror child stdout/stderr to disk and by
 *    the server/route helpers to emit synthesized lines.
 *  - `resetLogFile(options)`: truncate the log file. Idempotent per
 *    process via a module-level Set, so hot reloads don't keep
 *    clobbering mid-session content.
 *  - `createFileWriterHook(options)`: returns a `LogBase` hook that writes
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
const logDirectoryByCwd = new Map<string, string>()
const directoriesEnsured = new Set<string>()
const filesReset = new Set<string>()

const REPO_ROOT_WALK_MAX = 20
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g

const findRepoRoot = (start: string): string => {
    let currentDir = start
    for (let depth = 0; depth < REPO_ROOT_WALK_MAX; depth++) {
        try {
            if (fs.existsSync(path.join(currentDir, '.git'))) return currentDir
        } catch {
            // ignore — fall through to next parent
        }
        const parent = path.dirname(currentDir)
        if (parent === currentDir) break
        currentDir = parent
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
    const cached = logDirectoryByCwd.get(cwd)
    if (cached) return cached
    const resolved = path.join(findRepoRoot(cwd), '.debug-next')
    logDirectoryByCwd.set(cwd, resolved)
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

const logFilePath = (options: TFileWriterOptions): string =>
    path.join(resolveLogDir(options.logDir), `${options.appName}.log`)

const ensureDirectory = (directory: string): void => {
    if (directoriesEnsured.has(directory)) return
    fs.mkdirSync(directory, { recursive: true })
    directoriesEnsured.add(directory)
}

/**
 * Append raw text to the app's log file. ANSI escape codes are stripped.
 * Never throws.
 */
export const appendRaw = (text: string, options: TFileWriterOptions): void => {
    if (isFileWritingDisabled()) return
    const filePath = logFilePath(options)
    try {
        ensureDirectory(path.dirname(filePath))
        fs.appendFileSync(filePath, text.replace(ANSI_RE, ''))
    } catch {
        // hook must never throw
    }
}

/**
 * Truncate the app's log file. Idempotent within a single process — a
 * second call from the same Node process (e.g. after a hot reload) is a
 * no-op, so in-session events aren't wiped.
 */
export const resetLogFile = (options: TFileWriterOptions): void => {
    if (isFileWritingDisabled()) return
    const filePath = logFilePath(options)
    if (filesReset.has(filePath)) return
    try {
        ensureDirectory(path.dirname(filePath))
        fs.writeFileSync(filePath, '')
        filesReset.add(filePath)
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
export const pipeStdStreamsToFile = (options: TPipeStdStreamsToFileOptions): void => {
    if (isFileWritingDisabled()) return

    if (options.resetOnStart !== false) {
        resetLogFile({ appName: options.appName, logDir: options.logDir })
    }

    const writeOptions: TFileWriterOptions = {
        appName: options.appName,
        ...(options.logDir ? { logDir: options.logDir } : {}),
    }

    const wrap = (stream: TWrappedStream): void => {
        if (stream[PIPE_FLAG]) return
        const original = stream.write.bind(stream)
        // Per-stream buffer holds the trailing partial line until a
        // newline arrives — so we don't stamp the same logical line twice
        // when a write is chunked.
        let pending = ''

        stream.write = function pipedWrite(
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
                        const timestamp = new Date().toISOString()
                        const stamped = completeLines
                            .split('\n')
                            .map(line => `[${timestamp}] ${line}`)
                            .join('\n')
                        appendRaw(`${stamped}\n`, writeOptions)
                    }
                    // Force-flush an oversized partial line so a long
                    // newline-less stream (binary dump, single-line JSON
                    // blob) can't grow `pending` without bound.
                    if (pending.length > MAX_PENDING_BYTES) {
                        appendRaw(
                            `[${new Date().toISOString()}] ${pending}\n`,
                            writeOptions,
                        )
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
export const createFileWriterHook = (options: TFileWriterOptions): TDebugHook => {
    return (args, level, _isEnabled, scope) => {
        const formatted = inspect(args.length === 1 ? args[0] : args, {
            depth: 4,
            colors: false,
            breakLength: 120,
        })
        const tag = scope ? `${level} ${scope}` : level
        appendRaw(
            `[${new Date().toISOString()}] [${options.appName}] ${tag}: ${formatted}\n`,
            options,
        )
    }
}
