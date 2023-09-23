// Need to declare this before debug module is loaded
const NAMESPACE = 'debug:index.test.ts'
process.env.DEBUG = `${NAMESPACE}*`
process.env.DEBUG_VERBOSE = 'true'
process.env.LOG_ERROR = 'true'
// this is set to false so that string arguments without colors (generated randomly) can be practically tested.
process.env.DEBUG_COLORS = 'false'

import { formatWithOptions } from 'util'
import { debug, Log, LogBase } from './index'

const { log } = Log()
log(111111)

const should = it

// internally, debug calls formatWithOptions that collapses all args
// before passing to process.stdout.write or process.stderr.write
const format = (...args: unknown[]) => `${formatWithOptions({}, ...args)}\n`

describe('Log', () => {
    should('create correct namespace using `__filename`', () => {
        const namespace = LogBase.namespace(__filename)
        expect(namespace).toEqual(NAMESPACE)
    })

    should('be able to be disabled', () => {
        const logSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => false)
        const { log } = Log()
        log.enabled = false
        log('test')
        expect(logSpy).not.toBeCalled()
        logSpy.mockRestore()
    })

    should('initialize correctly', () => {
        const ret = Log(__filename)
        expect(ret).toBeDefined()
        expect(ret).toEqual(
            expect.objectContaining({
                log: expect.any(Function),
                logWarn: expect.any(Function),
                logError: expect.any(Function),
                logDebug: expect.any(Function),
                logVerbose: expect.any(Function),
                logFatal: expect.any(Function),
            }),
        )
    })

    should('should run #log', () => {
        const testMessage = '#log should run'

        // spy has to be before "imports" of log
        const logSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => false)
        const { log } = Log(__filename)

        log(testMessage)
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining(`${NAMESPACE} ${testMessage}`),
        )

        logSpy.mockRestore()
    })

    describe('log.extend', () => {
        should('be able to extend namespace', () => {
            // change debug's namespace
            // Note: Once debug is initialized, it's namespace will not response to env changes.
            //       We need to call #enable again to reload the env.
            const cached = process.env.DEBUG
            process.env.DEBUG = `${process.env.DEBUG}*`
            debug.enable(process.env.DEBUG)

            // spy has to be before "imports" of log
            const logSpy = jest
                .spyOn(process.stdout, 'write')
                .mockImplementation(() => false)

            const msg = '#extend can run'
            const { log } = Log(__filename)

            const extended = log.extend('extension')

            extended('#extend can run')
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining(`${NAMESPACE}:extension ${msg}`),
            )

            logSpy.mockRestore()

            // revert debug's namespace
            process.env.DEBUG = cached
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            debug.enable(process.env.DEBUG!)
        })
    })

    describe('Hooks', () => {
        const allHook = jest.fn()
        const testHook = jest.fn()

        beforeAll(() => {
            LogBase.attachHook('all', 'all', allHook)
            LogBase.attachHook('log', 'test', testHook)
            LogBase.attachHook('logDebug', 'testDebug', testHook)
            LogBase.attachHook('logError', 'testError', testHook)
            LogBase.attachHook('logFatal', 'testFatal', testHook)
            LogBase.attachHook('logVerbose', 'testVerbose', testHook)
            LogBase.attachHook('logWarn', 'testWarn', testHook)
        })
        beforeEach(() => testHook.mockClear())

        afterAll(() => {
            // force reset all hooks to not affect other tests
            LogBase._hooks = {
                log: {},
                logDebug: {},
                logError: {},
                logFatal: {},
                logVerbose: {},
                logWarn: {},
            }
            LogBase._hooksUnsafe = {
                log: {},
                logDebug: {},
                logError: {},
                logFatal: {},
                logVerbose: {},
                logWarn: {},
            }
        })

        should('run hooks attached', () => {
            testHook.mockClear()
            const { log, logDebug, logError, logFatal, logVerbose, logWarn } =
                Log(__filename)
            const args = ['foo', 'bar'] as const
            const spyOut = jest
                .spyOn(process.stdout, 'write')
                .mockImplementation(() => false)

            const spyErr = jest
                .spyOn(process.stderr, 'write')
                .mockImplementation(() => false)

            log(...args)
            expect(testHook).toBeCalledWith(args, 'log', true, null, 'test')

            testHook.mockClear()
            logDebug(...args)
            expect(testHook).toBeCalledWith(args, 'logDebug', true, null, 'testDebug')

            testHook.mockClear()
            logError(...args)
            expect(testHook).toBeCalledWith(args, 'logError', true, null, 'testError')

            testHook.mockClear()
            logFatal(...args)
            expect(testHook).toBeCalledWith(args, 'logFatal', true, null, 'testFatal')

            testHook.mockClear()
            logVerbose(...args)
            expect(testHook).toBeCalledWith(args, 'logVerbose', true, null, 'testVerbose')

            testHook.mockClear()
            logWarn(...args)
            expect(testHook).toBeCalledWith(args, 'logWarn', true, null, 'testWarn')

            expect(allHook).toBeCalledTimes(6)

            testHook.mockClear()
            spyOut.mockRestore()
            spyErr.mockRestore()
        })

        should('run hooks attached even if a hook errored', () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => false)
            const spyStdErr = jest
                .spyOn(process.stdout, 'write')
                .mockImplementation(() => false)

            const errorHook = jest.fn(() => {
                throw Error('Error!')
            })

            LogBase.attachHook('log', 'error-hook', errorHook)

            const { log } = Log(__filename)
            const args = ['foo', 'bar'] as const
            log(...args)

            expect(errorHook).toBeCalledWith(args, 'log', log.enabled, null, 'error-hook')
            expect(spy).toBeCalledWith(
                expect.stringContaining(
                    'Hook `error-hook` attached to log threw an error.',
                ),
            )
            // other hooks should still run normally
            expect(testHook).toBeCalledWith(args, 'log', log.enabled, null, 'test')

            // remove hook
            delete LogBase._hooks.log['error-hook']
            spy.mockRestore()
            spyStdErr.mockRestore()
        })

        should('run hooks for logVerbose', () => {
            const verboseHook = jest.fn()
            LogBase.attachHook('logVerbose', 'verboseHook', verboseHook)
            const { logVerbose } = Log(__filename)

            const spy = jest
                .spyOn(process.stdout, 'write')
                .mockImplementation(() => false)

            logVerbose('one arg')
            expect(verboseHook).toBeCalledWith(
                ['one arg'],
                'logVerbose',
                logVerbose.enabled,
                null,
                'verboseHook',
            )

            verboseHook.mockClear()

            const complex = [
                { complex: 'arg' },
                ['foo', 'bar'],
                () => {
                    /** */
                },
            ]
            logVerbose(...complex)
            expect(verboseHook).toBeCalledWith(
                complex,
                'logVerbose',
                logVerbose.enabled,
                null,
                'verboseHook',
            )

            delete LogBase._hooks.logVerbose['verboseHook']
            spy.mockRestore()
        })

        should('run hooks even if debugger is not enabled', () => {
            const warnHook = jest.fn()
            const spy = jest
                .spyOn(process.stdout, 'write')
                .mockImplementation(() => false)
            LogBase.attachHook('logWarn', 'warnHook', warnHook)
            const { logWarn } = Log(__filename)

            logWarn('hook should run')
            expect(warnHook).toBeCalledWith(
                ['hook should run'],
                'logWarn',
                logWarn.enabled,
                null,
                'warnHook',
            )
            delete LogBase._hooks.logVerbose['warnHook']
            spy.mockRestore()
        })
    })

    should('should run #logWarn', () => {
        const testMessage = '#logWarn should run'

        // spy has to be before "imports" of log
        const logWarnSpy = jest
            .spyOn(process.stdout, 'write')
            .mockImplementation(() => false)

        const { logWarn } = Log(__filename)

        logWarn(testMessage)
        expect(logWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining(`${NAMESPACE} ${testMessage}`),
        )

        logWarnSpy.mockRestore()
    })

    should('should run #logError', () => {
        const testMessage = '#logError should run'

        // spy has to be before "imports" of log
        const logErrorSpy = jest
            .spyOn(process.stderr, 'write')
            .mockImplementation(() => false)

        const { logError } = Log(__filename)

        logError(testMessage)
        expect(logErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining(`${NAMESPACE} ${testMessage}`),
        )

        logErrorSpy.mockRestore()
    })

    should('run #logError regardless of namespacing, when LOG_ERROR=true)', () => {
        const cached = process.env.LOG_ERROR
        process.env.LOG_ERROR = 'true'

        const testMessage = '#logError should run (namespaced off, LOG_ERROR=true)'
        const wrongNamespace = 'wrong/namespace'

        // spy has to be before "imports" of log
        const logErrorSpy = jest
            .spyOn(process.stderr, 'write')
            .mockImplementation(() => false)

        const { logError } = Log('wrong/namespace')

        logError(testMessage)
        expect(logErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining(
                `${LogBase.namespace(wrongNamespace)} ${testMessage}`,
            ),
        )

        logErrorSpy.mockRestore()
        process.env.LOG_ERROR = cached
    })

    should('run #logDebug', () => {
        const testMessage = '#logDebug should run'

        // spy has to be before "imports" of log
        const logDebugSpy = jest
            .spyOn(process.stdout, 'write')
            .mockImplementation(() => false)

        const { logDebug } = Log(__filename)

        logDebug(testMessage)
        expect(logDebugSpy).toHaveBeenCalledWith(
            expect.stringContaining(`${NAMESPACE} ${testMessage}`),
        )
        logDebugSpy.mockRestore()
    })

    should('run #logVerbose correctly (env.DEBUG_VERBOSE=true)', () => {
        const testMessage = '#logVerbose (DEBUG_VERBOSE=true)'
        const testObj = { foo: 'bar' }

        // spy has to be before "imports" of log
        const logVerboseSpy = jest
            .spyOn(process.stdout, 'write')
            .mockImplementation(() => false)

        const { logVerbose } = Log(__filename)

        logVerbose(testMessage, testObj)
        expect(logVerboseSpy).toHaveBeenCalledWith(
            expect.stringContaining(
                format(`${NAMESPACE} ${testMessage}`, testObj, '0ms'),
            ),
        )

        logVerboseSpy.mockRestore()
    })

    should('run #logVerbose with truncated messaging (env.DEBUG_VERBOSE=false)', () => {
        const envLogVerboseCached = process.env.DEBUG_VERBOSE
        process.env.DEBUG_VERBOSE = 'false'

        const testMessage = '#logVerbose (DEBUG_VERBOSE=false)'

        // spy has to be before "imports" of log
        const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => false)

        const { logVerbose } = Log(__filename)

        logVerbose(testMessage)
        expect(spy).toHaveBeenCalledWith(expect.stringContaining(testMessage))

        spy.mockRestore()

        process.env.DEBUG_VERBOSE = envLogVerboseCached
    })

    should(
        'run #logVerbose with truncated messaging (env.DEBUG_VERBOSE=false, with test obj)',
        () => {
            const envLogVerboseCached = process.env.DEBUG_VERBOSE
            process.env.DEBUG_VERBOSE = 'false'

            const testMessage = '#logVerbose (DEBUG_VERBOSE=false)'
            const testObj = { bar: 'foo' }

            // spy has to be before "imports" of log
            const spy = jest
                .spyOn(process.stdout, 'write')
                .mockImplementation(() => false)

            const { logVerbose } = Log(__filename)

            logVerbose(testObj, testMessage)
            expect(spy).toHaveBeenCalledWith(
                expect.stringContaining(
                    `${NAMESPACE} Verbose debugger available for: an object with keys [${Object.keys(
                        testObj,
                    )}] (and 1 more argument).`,
                ),
            )

            process.env.DEBUG_VERBOSE = envLogVerboseCached

            spy.mockRestore()
        },
    )

    should('run #logFatal (correct namespacing)', () => {
        const testMessage = '#logFatal (correct namespacing)'

        // spy has to be before "imports" of log
        const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => false)

        const { logFatal } = Log(__filename)

        logFatal(testMessage, { foo: 'bar' })
        expect(spy).toHaveBeenCalledWith(
            expect.stringContaining(`${NAMESPACE} \x1b[31m FATAL: ${testMessage}`),
        )

        spy.mockRestore()
    })

    should('run #logFatal (wrong namespacing/disabled)', () => {
        const testMessage = '#logFatal (wrong namespacing/disabled)'
        const disabledNamespace = 'disabled/namespace'

        // spy has to be before "imports" of log
        const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => false)

        const { logFatal } = Log(disabledNamespace)

        logFatal(testMessage)
        expect(spy).toHaveBeenCalledWith(
            expect.stringContaining(
                `${LogBase.namespace(disabledNamespace)} \x1b[31m FATAL: ${testMessage}`,
            ),
        )

        spy.mockRestore()
    })

    should('disable loggers not in namespace', () => {
        const cached = process.env.LOG_ERROR
        process.env.LOG_ERROR = 'false'

        const testMessage = 'disabled'
        const disabledNamespace = 'disabled/namespace'

        // spy has to be before "imports" of log
        const consoleSpy = jest
            .spyOn(process.stdout, 'write')
            .mockImplementation(() => false)

        const stdErrSpy = jest
            .spyOn(process.stderr, 'write')
            .mockImplementation(() => false)

        const { log, logWarn, logDebug, logVerbose, logError } = Log(disabledNamespace)

        log(testMessage)
        logWarn(testMessage)
        logDebug(testMessage)
        logVerbose(testMessage)
        logError(testMessage)

        expect(consoleSpy).not.toBeCalled()
        expect(stdErrSpy).not.toBeCalled()

        process.env.LOG_ERROR = cached
        consoleSpy.mockRestore()
        stdErrSpy.mockRestore()
    })

    should('provide function scope', () => {
        const { log } = Log()
        const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => false)
        function scoped() {
            log('output from scoped')
        }

        scoped()

        expect(spy).toBeCalledWith(expect.stringContaining(`${NAMESPACE} [scoped]`))
        // in-between these 2 are the line and position, don't want to test that.
        expect(spy).toBeCalledWith(expect.stringContaining(`output from scoped`))
        spy.mockRestore()
    })
})
