import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const TMP_PREFIX = path.join(os.tmpdir(), 'debug-next-srv-')

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
    return require('./server') as typeof import('./server')
}

const fakeRequest = {
    path: '/api/checkout',
    method: 'POST',
    headers: { 'user-agent': 'curl' },
}

const fakeContext = {
    routerKind: 'App',
    routePath: '/api/checkout',
    routeType: 'route',
}

describe('createOnRequestError', () => {
    let logDir: string

    beforeEach(() => {
        cleanEnv()
        logDir = freshTmpDir()
        process.env.DEBUG_NEXT_LOG_DIR = logDir
    })

    it('writes a header + inspected error body per call', async () => {
        const { createOnRequestError } = reloadModule()
        const onErr = createOnRequestError({ appName: 'app' })
        await onErr(new Error('boom'), fakeRequest, fakeContext)

        const out = readLog(logDir, 'app')
        expect(out).toMatch(
            /^\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[app\] logError route — POST \/api\/checkout$/m,
        )
        expect(out).toContain('Error: boom')
    })

    it('coerces non-Error throwables into an Error before logging', async () => {
        const { createOnRequestError } = reloadModule()
        const onErr = createOnRequestError({ appName: 'app' })
        await onErr('plain string error', fakeRequest, fakeContext)

        const out = readLog(logDir, 'app')
        expect(out).toContain('Error: plain string error')
    })

    it('calls the optional sentry handler with the same arguments', async () => {
        const { createOnRequestError } = reloadModule()
        const sentry = jest.fn()
        const onErr = createOnRequestError({ appName: 'app', sentry })
        const err = new Error('boom')
        await onErr(err, fakeRequest, fakeContext)

        expect(sentry).toHaveBeenCalledTimes(1)
        expect(sentry).toHaveBeenCalledWith(err, fakeRequest, fakeContext)
    })

    it('swallows errors from the sentry handler', async () => {
        const { createOnRequestError } = reloadModule()
        const sentry = jest.fn(() => {
            throw new Error('sentry exploded')
        })
        const onErr = createOnRequestError({ appName: 'app', sentry })
        await expect(
            onErr(new Error('boom'), fakeRequest, fakeContext),
        ).resolves.toBeUndefined()
        // File write still happened despite the Sentry throw.
        expect(readLog(logDir, 'app')).toContain('Error: boom')
    })

    it('no-ops the file write in production but still calls sentry', async () => {
        process.env.NODE_ENV = 'production'
        const { createOnRequestError } = reloadModule()
        const sentry = jest.fn()
        const onErr = createOnRequestError({ appName: 'app', sentry })
        await onErr(new Error('boom'), fakeRequest, fakeContext)

        expect(fs.existsSync(path.join(logDir, 'app.log'))).toBe(false)
        expect(sentry).toHaveBeenCalledTimes(1)
    })
})

describe('attachFileWriter', () => {
    let logDir: string

    beforeEach(() => {
        cleanEnv()
        logDir = freshTmpDir()
        process.env.DEBUG_NEXT_LOG_DIR = logDir
    })

    it('initialises LogBase and attaches the hook so Log() calls land in the file', () => {
        const { attachFileWriter } = reloadModule()
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Log } = require('..') as typeof import('..')
        attachFileWriter({ appName: 'app' })
        const { log } = Log('arbitrary-namespace')
        log('hello from hook')
        const out = readLog(logDir, 'app')
        expect(out).toContain('[app]')
        expect(out).toContain("'hello from hook'")
    })

    it('skips attaching the hook in production, but LogBase.init still succeeds', () => {
        process.env.NODE_ENV = 'production'
        const { attachFileWriter } = reloadModule()
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Log } = require('..') as typeof import('..')
        attachFileWriter({ appName: 'app' })
        const { log } = Log('namespace')
        log('production silent')
        expect(fs.existsSync(path.join(logDir, 'app.log'))).toBe(false)
    })

    it('is idempotent across repeated calls (no throw on double-init)', () => {
        const { attachFileWriter } = reloadModule()
        expect(() => {
            attachFileWriter({ appName: 'app' })
            attachFileWriter({ appName: 'app' })
        }).not.toThrow()
    })
})
