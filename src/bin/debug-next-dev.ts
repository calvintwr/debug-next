#!/usr/bin/env node
/**
 * CLI wrapper for `next dev` (or any long-running build command). Pipes
 * the child process's stdout/stderr output to `<appName>.log` so the
 * AI copilot can read exactly what the developer sees in the terminal
 * and browser console.
 *
 *   debug-next-dev -- next dev --turbopack
 *
 * The log file is cleared once at startup, so each `bun run dev`
 * session starts with a clean view.
 *
 * Env overrides:
 *   DEBUG_NEXT_APP_NAME   App name (default: package.json#name)
 *   DEBUG_NEXT_LOG_DIR    Log directory (default: <repo-root>/.debug-next)
 *   DEBUG_NEXT_DISABLE    "true" disables file writes
 */

import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { appendRaw, resetLogFile } from '../nextjs/file-writer'

/* -------------------------------------------------------------------------- */
/* CLI surface                                                                 */
/* -------------------------------------------------------------------------- */

const USAGE = [
    'Usage: debug-next-dev [--] <command> [args...]',
    '',
    'Wraps a Next.js dev/build command, pipes its output to the terminal,',
    'and writes the same stream verbatim to .debug-next/<appName>.log.',
    '',
    'Env:',
    '  DEBUG_NEXT_APP_NAME   Override app name (default: package.json#name)',
    '  DEBUG_NEXT_LOG_DIR    Override log directory (default: repo-root/.debug-next)',
    '  DEBUG_NEXT_DISABLE    Set to "true" to disable writes',
    '',
].join('\n')

const log = (msg: string): void => void process.stderr.write(`[debug-next-dev] ${msg}\n`)

type TParsedArgs = { kind: 'help'; explicit: boolean } | { kind: 'run'; cmd: string[] }

const parseArgs = (argv: string[]): TParsedArgs => {
    if (argv.length === 0) return { kind: 'help', explicit: false }
    if (argv[0] === '-h' || argv[0] === '--help') {
        return { kind: 'help', explicit: true }
    }
    const cmd = argv[0] === '--' ? argv.slice(1) : argv
    if (cmd.length === 0) return { kind: 'help', explicit: false }
    return { kind: 'run', cmd }
}

/* -------------------------------------------------------------------------- */
/* App-name discovery                                                          */
/* -------------------------------------------------------------------------- */

const stripNpmScope = (name: string): string => name.replace(/^@[^/]+\//, '')

const readPackageName = (cwd: string): string | undefined => {
    try {
        const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')
        const pkg = JSON.parse(raw) as { name?: unknown }
        if (typeof pkg.name === 'string' && pkg.name.length > 0) {
            return stripNpmScope(pkg.name)
        }
    } catch {
        // fall through
    }
    return undefined
}

const resolveAppName = (): string =>
    process.env.DEBUG_NEXT_APP_NAME ?? readPackageName(process.cwd()) ?? 'app'

/* -------------------------------------------------------------------------- */
/* Child process orchestration                                                 */
/* -------------------------------------------------------------------------- */

const wireSignalForwarding = (child: ChildProcess): void => {
    const forward = (signal: NodeJS.Signals): void => {
        if (!child.killed) child.kill(signal)
    }
    process.on('SIGINT', () => forward('SIGINT'))
    process.on('SIGTERM', () => forward('SIGTERM'))
    process.on('SIGHUP', () => forward('SIGHUP'))
}

const teeStream = (
    stream: NodeJS.ReadableStream | null,
    sink: NodeJS.WriteStream,
    writeOpts: { appName: string; logDir?: string },
): void => {
    if (!stream) return
    stream.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8')
        sink.write(text)
        appendRaw(text, writeOpts)
    })
    // An unhandled 'error' on a Readable would crash the parent CLI.
    stream.on('error', err => log(`stream error: ${err.message}`))
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

const main = (): void => {
    const parsed = parseArgs(process.argv.slice(2))
    if (parsed.kind === 'help') {
        process.stderr.write(USAGE)
        process.exit(parsed.explicit ? 0 : 2)
    }

    const appName = resolveAppName()
    const logDir = process.env.DEBUG_NEXT_LOG_DIR
    const writeOpts = { appName, ...(logDir ? { logDir } : {}) }

    resetLogFile(writeOpts)
    appendRaw(
        `[${new Date().toISOString()}] [debug-next-dev] wrapping: ${parsed.cmd.join(
            ' ',
        )}\n`,
        writeOpts,
    )

    log(`wrapping: ${parsed.cmd.join(' ')}`)
    log(`app: ${appName}`)

    const child = spawn(parsed.cmd[0], parsed.cmd.slice(1), {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: process.env,
    })

    teeStream(child.stdout, process.stdout, writeOpts)
    teeStream(child.stderr, process.stderr, writeOpts)
    wireSignalForwarding(child)

    child.on('error', err => {
        log(`failed to spawn: ${err.message}`)
        process.exit(1)
    })

    child.on('exit', (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal)
            return
        }
        process.exit(code ?? 0)
    })
}

main()
