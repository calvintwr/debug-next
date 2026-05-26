import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const TMP_PREFIX = path.join(os.tmpdir(), 'debug-next-route-')

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
    jest.resetModules()
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./route') as typeof import('./route')
}

const post = async (
    POST: (req: Request) => Promise<Response>,
    body: unknown,
): Promise<{ status: number; body: unknown }> => {
    const res = await POST(
        new Request('http://x/api/_debug-next', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
    )
    const text = await res.text()
    let parsed: unknown = text
    try {
        parsed = JSON.parse(text)
    } catch {
        // leave as text
    }
    return { status: res.status, body: parsed }
}

describe('createDebugNextRoute — production guard', () => {
    beforeEach(cleanEnv)
    afterAll(cleanEnv)

    it('returns 404 in production by default without parsing the body', async () => {
        const logDir = freshTmpDir()
        process.env.DEBUG_NEXT_LOG_DIR = logDir
        process.env.NODE_ENV = 'production'
        const { createDebugNextRoute } = reloadModule()
        const { POST } = createDebugNextRoute({ appName: 'app' })
        const res = await post(POST, {
            source: 'client-error',
            message: 'should not be written',
        })
        expect(res.status).toBe(404)
        expect(res.body).toEqual({ error: 'not_found' })
        expect(fs.existsSync(path.join(logDir, 'app.log'))).toBe(false)
    })

    it('accepts traffic in production when DEBUG_NEXT_FORCE=true', async () => {
        const logDir = freshTmpDir()
        process.env.DEBUG_NEXT_LOG_DIR = logDir
        process.env.NODE_ENV = 'production'
        process.env.DEBUG_NEXT_FORCE = 'true'
        const { createDebugNextRoute } = reloadModule()
        const { POST } = createDebugNextRoute({ appName: 'app' })
        const res = await post(POST, {
            source: 'client-error',
            message: 'opt-in',
        })
        expect(res.status).toBe(200)
        expect(readLog(logDir, 'app')).toContain('opt-in')
    })
})

describe('createDebugNextRoute — request handling', () => {
    let logDir: string
    let POST: (req: Request) => Promise<Response>

    beforeEach(() => {
        cleanEnv()
        logDir = freshTmpDir()
        process.env.DEBUG_NEXT_LOG_DIR = logDir
        const { createDebugNextRoute } = reloadModule()
        POST = createDebugNextRoute({ appName: 'app' }).POST
    })

    it('returns 400 invalid_json for non-JSON bodies', async () => {
        const res = await post(POST, 'not-json{')
        expect(res.status).toBe(400)
        expect(res.body).toEqual({ ok: false, error: 'invalid_json' })
    })

    it('returns 400 invalid_payload for non-object bodies', async () => {
        const res = await post(POST, 42)
        expect(res.status).toBe(400)
        expect(res.body).toEqual({ ok: false, error: 'invalid_payload' })
    })

    it('writes a valid event with all fields', async () => {
        const res = await post(POST, {
            appName: 'browser-side-name',
            source: 'client-error',
            message: 'Something broke',
            stack: 'Error: Something broke\n    at fn (file.ts:10:5)',
            scope: 'file.ts:10:5',
            digest: 'abc123',
            level: 'logError',
        })
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ ok: true })
        const out = readLog(logDir, 'app')
        expect(out).toContain('[browser-side-name]')
        expect(out).toContain('logError client-error file.ts:10:5 digest=abc123')
        expect(out).toContain('Something broke')
        expect(out).toContain('Error: Something broke')
        expect(out).toContain('    at fn (file.ts:10:5)')
    })

    it('falls back to the route-level appName when payload omits it', async () => {
        const res = await post(POST, {
            source: 'client-error',
            message: 'no app name in payload',
        })
        expect(res.status).toBe(200)
        expect(readLog(logDir, 'app')).toContain('[app]')
    })

    it('defaults to client-error for unknown source values', async () => {
        const res = await post(POST, {
            source: 'something-weird',
            message: 'msg',
        })
        expect(res.status).toBe(200)
        expect(readLog(logDir, 'app')).toContain('client-error')
    })

    it('accepts the three allowed sources', async () => {
        for (const source of ['client-error', 'client-rejection', 'global-error']) {
            const r = await post(POST, { source, message: `m-${source}` })
            expect(r.status).toBe(200)
            expect(readLog(logDir, 'app')).toContain(source)
        }
    })
})

describe('createDebugNextRoute — sanitization', () => {
    let logDir: string
    let POST: (req: Request) => Promise<Response>

    beforeEach(() => {
        cleanEnv()
        logDir = freshTmpDir()
        process.env.DEBUG_NEXT_LOG_DIR = logDir
        const { createDebugNextRoute } = reloadModule()
        POST = createDebugNextRoute({ appName: 'app' }).POST
    })

    it('collapses newlines in single-line fields so injected forged log lines stay on one line', async () => {
        await post(POST, {
            source: 'client-error',
            message: 'real\n[2026-01-01T00:00:00.000Z] [evil] FORGED',
        })
        const lines = readLog(logDir, 'app').split('\n').filter(Boolean)
        // The whole rendered event should still occupy a single line:
        // the injected `\n` was collapsed to a space.
        const eventLine = lines.find(l => l.includes('real'))
        expect(eventLine).toBeDefined()
        expect(eventLine).toMatch(/real \[2026-01-01T00:00:00.000Z\] \[evil\] FORGED/)
    })

    it('strips ASCII control characters from single-line fields', async () => {
        await post(POST, {
            source: 'client-error',
            message: 'msg',
            scope: 'a\x00b\x07c\x1bd',
        })
        // \x00 (NUL), \x07 (BEL), \x1b (ESC) should all be gone.
        expect(readLog(logDir, 'app')).toContain('abcd')
        expect(readLog(logDir, 'app')).not.toMatch(/[\x00\x07\x1b]/)
    })

    it('preserves newlines and tabs in the stack field', async () => {
        await post(POST, {
            source: 'client-error',
            message: 'm',
            stack: 'Error: foo\n\tat bar\n\tat baz',
        })
        const out = readLog(logDir, 'app')
        expect(out).toContain('Error: foo\n\tat bar\n\tat baz')
    })

    it('strips other control chars from the stack while keeping line breaks', async () => {
        await post(POST, {
            source: 'client-error',
            message: 'm',
            stack: 'line1\x00with-null\nline2\x07with-bel',
        })
        const out = readLog(logDir, 'app')
        expect(out).toContain('line1with-null\nline2with-bel')
        expect(out).not.toMatch(/[\x00\x07]/)
    })

    it('caps oversized meta with a truncation marker', async () => {
        const huge = { blob: 'x'.repeat(20_000) }
        await post(POST, {
            source: 'client-error',
            message: 'm',
            meta: [huge],
        })
        const out = readLog(logDir, 'app')
        expect(out).toContain('… (truncated)')
        // Sanity: the rendered meta line shouldn't carry the full 20 KB blob.
        const metaLine = out.split('\n').find(l => l.startsWith('meta: ')) ?? ''
        expect(metaLine.length).toBeLessThan(10_000)
    })

    it('truncates excessively long single-line fields to their per-field cap', async () => {
        await post(POST, {
            source: 'client-error',
            message: 'a'.repeat(10_000),
        })
        const out = readLog(logDir, 'app')
        // message cap is 4000 — we should see ~4000 'a's, not 10000.
        const longRun = out.match(/a{1000,}/)?.[0] ?? ''
        expect(longRun.length).toBeLessThanOrEqual(4_000)
    })
})
