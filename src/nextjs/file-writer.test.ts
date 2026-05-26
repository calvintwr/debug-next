import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const TMP_PREFIX = path.join(os.tmpdir(), 'debug-next-fw-')

const freshTmpDir = (): string => fs.mkdtempSync(TMP_PREFIX)

const readLog = (dir: string, appName: string): string =>
    fs.readFileSync(path.join(dir, `${appName}.log`), 'utf-8')

const cleanEnv = () => {
    delete process.env.NODE_ENV
    delete process.env.DEBUG_NEXT_DISABLE
    delete process.env.DEBUG_NEXT_FORCE
    delete process.env.DEBUG_NEXT_LOG_DIR
    delete process.env.NEXT_RUNTIME
}

const reloadModule = () => {
    // Module-level state (filesReset, dirsEnsured, logDirByCwd, PIPE_FLAG
    // on streams) needs to be fresh between tests that exercise it.
    jest.resetModules()
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./file-writer') as typeof import('./file-writer')
}

describe('isFileWritingDisabled', () => {
    beforeEach(cleanEnv)
    afterAll(cleanEnv)

    it('returns false in development with no flags', () => {
        const { isFileWritingDisabled } = reloadModule()
        expect(isFileWritingDisabled()).toBe(false)
    })

    it('returns true when DEBUG_NEXT_DISABLE=true', () => {
        process.env.DEBUG_NEXT_DISABLE = 'true'
        const { isFileWritingDisabled } = reloadModule()
        expect(isFileWritingDisabled()).toBe(true)
    })

    it('returns true on the edge runtime', () => {
        process.env.NEXT_RUNTIME = 'edge'
        const { isFileWritingDisabled } = reloadModule()
        expect(isFileWritingDisabled()).toBe(true)
    })

    it('returns true in production by default', () => {
        process.env.NODE_ENV = 'production'
        const { isFileWritingDisabled } = reloadModule()
        expect(isFileWritingDisabled()).toBe(true)
    })

    it('returns false in production when DEBUG_NEXT_FORCE=true', () => {
        process.env.NODE_ENV = 'production'
        process.env.DEBUG_NEXT_FORCE = 'true'
        const { isFileWritingDisabled } = reloadModule()
        expect(isFileWritingDisabled()).toBe(false)
    })

    it('respects DEBUG_NEXT_DISABLE over DEBUG_NEXT_FORCE', () => {
        process.env.NODE_ENV = 'production'
        process.env.DEBUG_NEXT_FORCE = 'true'
        process.env.DEBUG_NEXT_DISABLE = 'true'
        const { isFileWritingDisabled } = reloadModule()
        expect(isFileWritingDisabled()).toBe(true)
    })
})

describe('appendRaw', () => {
    let logDir: string

    beforeEach(() => {
        cleanEnv()
        logDir = freshTmpDir()
        process.env.DEBUG_NEXT_LOG_DIR = logDir
    })

    it('creates the log directory and writes text verbatim', () => {
        const { appendRaw } = reloadModule()
        appendRaw('hello world\n', { appName: 'app' })
        expect(readLog(logDir, 'app')).toBe('hello world\n')
    })

    it('strips ANSI escape codes', () => {
        const { appendRaw } = reloadModule()
        appendRaw('\x1b[31mred\x1b[0m text\n', { appName: 'app' })
        expect(readLog(logDir, 'app')).toBe('red text\n')
    })

    it('appends across multiple calls', () => {
        const { appendRaw } = reloadModule()
        appendRaw('first\n', { appName: 'app' })
        appendRaw('second\n', { appName: 'app' })
        expect(readLog(logDir, 'app')).toBe('first\nsecond\n')
    })

    it('no-ops in production without DEBUG_NEXT_FORCE', () => {
        process.env.NODE_ENV = 'production'
        const { appendRaw } = reloadModule()
        appendRaw('should not appear\n', { appName: 'app' })
        expect(fs.existsSync(path.join(logDir, 'app.log'))).toBe(false)
    })
})

describe('resetLogFile', () => {
    let logDir: string

    beforeEach(() => {
        cleanEnv()
        logDir = freshTmpDir()
        process.env.DEBUG_NEXT_LOG_DIR = logDir
    })

    it('truncates an existing file', () => {
        const { appendRaw, resetLogFile } = reloadModule()
        appendRaw('stale data\n', { appName: 'app' })
        resetLogFile({ appName: 'app' })
        appendRaw('fresh\n', { appName: 'app' })
        expect(readLog(logDir, 'app')).toBe('fresh\n')
    })

    it('is idempotent within a process (does not wipe mid-session events)', () => {
        const fw = reloadModule()
        fw.resetLogFile({ appName: 'app' }) // first call truncates
        fw.appendRaw('event-1\n', { appName: 'app' })
        fw.resetLogFile({ appName: 'app' }) // second call is a no-op
        fw.appendRaw('event-2\n', { appName: 'app' })
        expect(readLog(logDir, 'app')).toBe('event-1\nevent-2\n')
    })
})

describe('createFileWriterHook', () => {
    let logDir: string

    beforeEach(() => {
        cleanEnv()
        logDir = freshTmpDir()
        process.env.DEBUG_NEXT_LOG_DIR = logDir
    })

    it('produces a single line per call with ISO timestamp + app + level + scope', () => {
        const { createFileWriterHook } = reloadModule()
        const hook = createFileWriterHook({ appName: 'app' })
        hook(['hello'], 'log', true, 'fnScope', 'hook-name')
        const out = readLog(logDir, 'app')
        expect(out).toMatch(
            /^\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[app\] log fnScope: 'hello'\n$/,
        )
    })

    it('omits scope from the tag when null', () => {
        const { createFileWriterHook } = reloadModule()
        const hook = createFileWriterHook({ appName: 'app' })
        hook(['no scope'], 'log', true, null, 'hook-name')
        expect(readLog(logDir, 'app')).toMatch(/\[app\] log: 'no scope'\n$/)
    })

    it('inspects Error subclasses so custom enumerable props (Snag.breadcrumbs) survive', () => {
        const { createFileWriterHook } = reloadModule()
        const hook = createFileWriterHook({ appName: 'app' })

        class Snag extends Error {
            breadcrumbs: unknown[]
            constructor(msg: string, breadcrumbs: unknown[]) {
                super(msg)
                this.name = 'Snag'
                this.breadcrumbs = breadcrumbs
            }
        }
        const err = new Snag('boom', [{ step: 'checkout' }])
        hook([err], 'logError', true, 'handler', 'hook-name')

        const out = readLog(logDir, 'app')
        expect(out).toContain('Snag: boom')
        expect(out).toContain("breadcrumbs: [ { step: 'checkout' } ]")
    })
})

describe('pipeStdStreamsToFile', () => {
    let logDir: string
    let originalStdout: typeof process.stdout.write
    let originalStderr: typeof process.stderr.write
    const PIPE_FLAG = Symbol.for('debug-next/pipe-to-file-installed')

    beforeEach(() => {
        cleanEnv()
        logDir = freshTmpDir()
        process.env.DEBUG_NEXT_LOG_DIR = logDir
        originalStdout = process.stdout.write
        originalStderr = process.stderr.write
        // Force-reset the PIPE_FLAG so each test starts from a clean wrap.
        const out = process.stdout as unknown as Record<symbol, unknown>
        const err = process.stderr as unknown as Record<symbol, unknown>
        delete out[PIPE_FLAG]
        delete err[PIPE_FLAG]
        // Silence stdout/stderr for the duration of the test — our wrap
        // delegates to whatever `write` was at wrap time, so swapping in a
        // no-op here keeps the file write path live while sparing the
        // test runner's terminal from large test payloads.
        const noop = (() => true) as typeof process.stdout.write
        process.stdout.write = noop
        process.stderr.write = noop
    })

    afterEach(() => {
        process.stdout.write = originalStdout
        process.stderr.write = originalStderr
        const out = process.stdout as unknown as Record<symbol, unknown>
        const err = process.stderr as unknown as Record<symbol, unknown>
        delete out[PIPE_FLAG]
        delete err[PIPE_FLAG]
    })

    it('prepends an ISO timestamp to every complete line', () => {
        const { pipeStdStreamsToFile } = reloadModule()
        pipeStdStreamsToFile({ appName: 'app' })
        process.stdout.write('first line\n')
        process.stdout.write('second line\n')
        const lines = readLog(logDir, 'app').trim().split('\n')
        expect(lines).toHaveLength(2)
        expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] first line$/)
        expect(lines[1]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] second line$/)
    })

    it('joins a chunked write into one stamped line once the newline arrives', () => {
        const { pipeStdStreamsToFile } = reloadModule()
        pipeStdStreamsToFile({ appName: 'app' })
        // Two writes split mid-line — should appear as a single stamped
        // line, not two. (We can't reliably check that nothing was
        // flushed between the writes because Jest's reporter shares the
        // wrapped stdout and may flush its own newlines in between; what
        // we care about is that the partial and completing chunks
        // belong to the same logical line.)
        process.stdout.write('partial ')
        process.stdout.write('line completed\n')
        const out = readLog(logDir, 'app')
        expect(out).toMatch(/\[[^\]]+\] partial line completed\n/)
    })

    it('force-flushes an oversized partial line so pending cannot grow without bound', () => {
        const { pipeStdStreamsToFile } = reloadModule()
        pipeStdStreamsToFile({ appName: 'app' })
        // 6 MB of newline-free output exceeds the 5 MB MAX_PENDING_BYTES cap.
        process.stdout.write('x'.repeat(6 * 1024 * 1024))
        const stat = fs.statSync(path.join(logDir, 'app.log'))
        expect(stat.size).toBeGreaterThan(5 * 1024 * 1024)
    })

    it('is idempotent — calling twice in one process does not double-wrap', () => {
        const { pipeStdStreamsToFile } = reloadModule()
        pipeStdStreamsToFile({ appName: 'app' })
        pipeStdStreamsToFile({ appName: 'app' })
        process.stdout.write('once\n')
        const out = readLog(logDir, 'app')
        // If double-wrapped, we'd see two timestamped copies of "once".
        expect(out.match(/once/g) ?? []).toHaveLength(1)
    })

    it('no-ops in production without DEBUG_NEXT_FORCE', () => {
        process.env.NODE_ENV = 'production'
        const { pipeStdStreamsToFile } = reloadModule()
        pipeStdStreamsToFile({ appName: 'app' })
        process.stdout.write('should not be teed\n')
        expect(fs.existsSync(path.join(logDir, 'app.log'))).toBe(false)
    })
})
