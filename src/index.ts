import debug from 'debug'
import { relative } from 'path'
import { cleanInspectOpts } from './helpers/cleanInspectOpts'
import { isPrimitive } from './helpers/isPrimitive'
import { formatWithOptions } from 'util'
import { callerCallsite } from './helpers/callerCallsite'
import { Debugger } from './types/debug/debug.types'

// TODO: Figure deprecation later
/**
 * @deprecated Please use `import { debug } from 'debug-next'`. Or, you may instantiate automatically namespaces loggers via `import { Log } from 'debug-next'`.
 */
export default debug

// Provide name exports
export { debug }

export type TDebugHook = (
    args: unknown[],
    loggerType: keyof typeof LogBase._hooks,
    isEnabled: boolean,
    scope: undefined | string | null,
    hookName: string,
) => void

type THookMap = {
    [key: string]: (
        isLoggerEnabled: boolean,
        scope: undefined | string | null,
        ...args: unknown[]
    ) => void
}

type TDebuggers = 'log' | 'logWarn' | 'logDebug' | 'logVerbose' | 'logError' | 'logFatal'

type THooksObject = { [Key in TDebuggers]: THookMap }

export const LogBase = {
    appName: 'debug',
    baseDir: '',
    truncateDir: ['src/', 'dist/'],
    namespace(fileName: string) {
        let relatived = relative(this.baseDir, fileName)

        // #relative will return the same name if the directory
        // doesn't match. it is also an indication that this
        // is not a filename, but an actual namespace. just return.
        if (relatived === fileName) return relatived

        for (let i = 0; i < this.truncateDir.length; i++) {
            const truncate = this.truncateDir[i]
            if (relatived.indexOf(truncate) === 0) {
                relatived = relatived.slice(truncate.length, relatived.length)
            }
        }

        if (relatived.indexOf('../') === 0) {
            return `${this.appName}:${relatived.replace('../', '')}`
        }

        return `${this.appName}:${relatived.replace(/\//g, ':').replace(/\\/g, ':')}`
    },
    _isInitialized: false,
    /**
     * Initialize LogBase. Can only be done once.
     * @param appName Name of the app. This is a prefix to the namespace. E.g. appName:namespace1:namespace2
     * @param baseDir Base directory of the app. This is required to diff the paths with other files to get a relative path for namespacing.
     */
    init(appName: string, baseDir: string) {
        if (this._isInitialized) throw Error('LogBase can only be initialised once.')
        this.appName = appName
        this.baseDir = baseDir
        this._isInitialized = true
        Object.freeze(this)
        return this
    },
    _hooks: <THooksObject>{
        log: <THookMap>{},
        logWarn: <THookMap>{},
        logDebug: <THookMap>{},
        logVerbose: <THookMap>{},
        logError: <THookMap>{},
        logFatal: <THookMap>{},
    },
    _hooksUnsafe: <THooksObject>{
        log: <THookMap>{},
        logWarn: <THookMap>{},
        logDebug: <THookMap>{},
        logVerbose: <THookMap>{},
        logError: <THookMap>{},
        logFatal: <THookMap>{},
    },
    _runHooks(
        logger: TDebuggers,
        isEnabled: boolean,
        scope: undefined | null | string,
        args: unknown[],
    ) {
        for (const hook in LogBase._hooks[logger]) {
            this._hooks[logger][hook](isEnabled, scope, ...args)
        }
        for (const hook in LogBase._hooksUnsafe.log) {
            this._hooksUnsafe[logger][hook](isEnabled, scope, ...args)
        }
    },
    /**
     * Hooks added will run after the logging is complete.
     * @param attachTo Attach hook to a logger.
     * @param hookName Name of hook.
     * @param hook Hook to run. Will be try/caught and not throw.
     *
     * @example
     * // To add a transportation to Datadog
     * import { datadogLogs } from '@datadog/browser-logs'
     * const datadogHook = (args, loggerType, isEnabled, scope, hookName) => {
     *     // run only if the logger was enabled by namespace
     *     if (isEnabled) {
     *
     *         // loggerType is log/logDebug etc...
     *         const msg = loggerType
     *
     *         // scope is the function caller name
     *         msg += ` ${scope}`
     *
     *         // hookName is `datadog` in this case
     *         msg += ` ${hookName}`
     *
     *         // hookName is `datadog` in this case
     *         datadogLogs.logger.info(msg, { info: args })
     *     }
     * }
     * LogBase.addHook('log', 'datadog', datadogHook)
     *
     * @example
     * // Adding Sentry hook
     * import * as Sentry from '@sentry/node'
     * const sentryHook = (...args) => {
     *     if (args.length === 1 && args[0] instanceof Error) {
     *         Sentry.captureException(args[0])
     *         return
     *     }
     *
     *     Sentry.captureException({
     *        message: 'Error!',
     *        info: args
     *     })
     * }
     * LogBase.attachHook('logError', 'sentry', sentryHook)
     */
    attachHook(attachTo: keyof THooksObject | 'all', hookName: string, hook: TDebugHook) {
        if (attachTo === 'all') {
            ;(
                [
                    'log',
                    'logWarn',
                    'logDebug',
                    'logVerbose',
                    'logError',
                    'logFatal',
                ] as const
            ).forEach(attachTo => LogBase.attachHook(attachTo, hookName, hook))
            return
        }
        const hooks = this._hooks[attachTo]
        if (hooks[hookName]) {
            throw Error(
                `Hook name of ${hookName} already exist for #${attachTo} method. If this is not a mistake, use another name.`,
            )
        }
        hooks[hookName] = (isEnabled, scope, ...args) => {
            try {
                return hook(args, attachTo, isEnabled, scope, hookName)
            } catch (err) {
                let msg = `Hook \`${hookName}\` attached to ${attachTo} threw an error.`
                msg += ` Please make sure you pass in hooks that are safe to execute. This is try/caught by debug to prevent execution errors.`
                msg += ` If you need to throw, use \`.addHookUnsafe\`.`
                // eslint-disable-next-line no-console
                console.error(msg)
                // eslint-disable-next-line no-console
                console.error(err)
            }
        }
    },
    /**
     * An unsafe version of #attachHook. Use this if you want the failure of the hook to throw.
     * Usage is the same as #attachHook.
     */
    attachHookUnsafe(
        attachTo: keyof THooksObject | 'all',
        hookName: string,
        hook: TDebugHook,
    ) {
        if (attachTo === 'all') {
            ;(
                [
                    'log',
                    'logWarn',
                    'logDebug',
                    'logVerbose',
                    'logError',
                    'logFatal',
                ] as const
            ).forEach(attachTo => LogBase.attachHook(attachTo, hookName, hook))
            return
        }

        const hooks = this._hooksUnsafe[attachTo]
        if (hooks[hookName]) {
            throw Error(
                `Hook name of ${hookName} already exist for #${attachTo} method. If this is not a mistake, use another name.`,
            )
        }
        hooks[hookName] = (isEnabled, scope, ...args) =>
            hook(args, attachTo, isEnabled, scope, hookName)
    },
}

/**
 * Create a Debugger instance that will automatically turn filenames into namespaces.
 * @param filenameOrNamespace
 * @returns
 */
const createLogger = (filenameOrNamespace: string | undefined) => {
    let namespace: string | undefined = undefined
    if (filenameOrNamespace !== undefined) {
        namespace = LogBase.namespace(filenameOrNamespace)
    } else {
        const callsite = callerCallsite({ depth: 0 })
        if (callsite?.file) {
            namespace = LogBase.namespace(callsite?.file)
        }
    }

    // create a debugger that logs to normal logs
    const logger = debug(namespace || '') as Debugger

    // overwrite old behaviour of writing to `process.stderr` to use `process.stdout` instead.
    // this allow logs to be separated between non-error types (process.stdout) and error types (process.stderr)
    logger.log = (...args) => {
        const inspectOpts = cleanInspectOpts(logger.inspectOpts)
        return process.stdout.write(`${formatWithOptions(inspectOpts, ...args)}\n`)
    }
    return logger
}

const _createDebugger = (name: TDebuggers, debugInstance: Debugger) => {
    const modifiedDebugger = Object.assign((...args: unknown[]) => {
        // callerCallsite has some performance overheads.
        // if it not enabled, and have no hooks to run, return
        if (
            !debugInstance.enabled &&
            Object.keys(LogBase._hooks[name]).length === 0 &&
            Object.keys(LogBase._hooksUnsafe[name]).length === 0
        ) {
            return
        }

        // get callsite, run debug, and hooks afterwards.
        const scope = callerCallsite({ depth: 0 })?.scope
        debugWithScope(scope || '', debugInstance, ...args)
        LogBase._runHooks(name, debugInstance.enabled, scope, args)
    }, debugInstance)

    // restore the reference of `enabled` back to the Debugger
    Object.defineProperty(modifiedDebugger, 'enabled', {
        get() {
            return debugInstance.enabled
        },
        set(v: boolean) {
            debugInstance.enabled = v
        },
    })
    return modifiedDebugger
}

/**
 * Call this to debug with scope. Scope can either be passed in, or be automagically obtained.
 * @param scope Pass in scope if you have, otherwise use null/undefined to automagically obtain scope. Pass in empty string '' skip (no scope).
 * @param logger A debugger to use.
 * @param args Arguments to be passed to the debugger.
 */
const debugWithScope = (
    scope: string | undefined | null,
    logger: Debugger,
    ...args: unknown[]
) => {
    const gotScope = scope ?? callerCallsite({ depth: 0 })?.scope

    // if scope is empty string, undefined, or null
    // log without the need to switch the scope
    if (!gotScope) return logger(...args)

    // the reason why we needed to switch scope this way
    // is because the debugger instance is shared by all scopes in the same namespace
    // so we switch it only for calling the debugger, and restore after
    logger.scope = gotScope
    const d = logger(...args)
    logger.scope = null
    return d
}

/**
 * A centralised logging interface that will create namespaced debugger automatically using the file structure.
 * @param fileName [optional] If left empty, it will Pass in `__filename`.
 */
export const Log = (fileName?: string) => {
    // create a debugger that logs to normal logs
    const debugStdOut = createLogger(fileName)

    // create a debugger that logs to error logs (default behaviour of the debug module)
    const debugStdErr = debug(debugStdOut.namespace) as Debugger
    // force debug to be enabled despite namespacing
    if (process.env.LOG_ERROR === 'true' || process.env.DEBUG_ERROR === 'true')
        debugStdErr.enabled = true
    // only overwrite when explicitly declared to be false
    if (process.env.LOG_ERROR === 'false' || process.env.DEBUG_ERROR === 'false')
        debugStdErr.enabled = false

    // if debugStdErr is enabled, we can use the same debugger for FATAL
    let debugStdErrFatal: Debugger
    if (debugStdErr.enabled === true) {
        debugStdErrFatal = debugStdErr as Debugger
    } else {
        // else we will create another one.
        debugStdErrFatal = debug(debugStdOut.namespace) as Debugger
        // fatal is forced enabled by default
        debugStdErrFatal.enabled = true
    }

    const log: Debugger = _createDebugger('log', debugStdOut)
    const logWarn: Debugger = _createDebugger('logWarn', debugStdOut)
    const logDebug: Debugger = _createDebugger('logDebug', debugStdOut)

    const logVerbose: Debugger = Object.assign(
        (...args: [arg: unknown, ...args: unknown[]]) => {
            // callerCallsite has some performance overheads.
            // if it not enabled, and have no hooks to run, return
            if (
                !debugStdOut.enabled &&
                Object.keys(LogBase._hooks.logVerbose).length === 0 &&
                Object.keys(LogBase._hooksUnsafe.logVerbose).length === 0
            ) {
                return
            }

            // LOG_VERBOSE for backward compatibility
            // use DEBUG_VERBOSE
            if (process.env.LOG_EXPAND_VERBOSE) {
                // eslint-disable-next-line no-console
                console.warn(
                    'Deprecated: Use `DEBUG_VERBOSE` instead of `LOG_EXPAND_VERBOSE`.',
                )
            }

            if (
                // If verbose mode is on, log normally.
                process.env.LOG_EXPAND_VERBOSE === 'true' ||
                process.env.DEBUG_VERBOSE === 'true' ||
                // if there is only 1 argument of primitive type
                (args.length === 1 && isPrimitive(args[0])) ||
                // if there are 2, and both are primitives
                (args.length === 2 && isPrimitive(args[0]) && isPrimitive(args[1]))
            ) {
                const scope = callerCallsite({ depth: 0 })?.scope
                debugWithScope(scope || '', debugStdOut, ...args)
                LogBase._runHooks('logVerbose', debugStdOut.enabled, scope, args)
                return
            }

            let messageIfFirstArgumentIsString = ''
            let message = ''

            // copy out args array before it gets manipulated.
            // _runHooks needs to call it later
            let copiedArgs: unknown[] | null = null

            // if the first argument is a string, we will use it as the first message
            if (typeof args[0] === 'string') {
                // copy out args array before it gets manipulated.
                // _runHooks needs to call it later
                copiedArgs = [...args]
                messageIfFirstArgumentIsString = args.shift() as string
            }

            if (args[0] === null || args[0] === undefined) {
                message = typeof args[0]
            } else if (Array.isArray(args[0])) {
                message = `an array of length ${args[0].length}`
            } else if (typeof args[0] === 'object') {
                try {
                    message = `an object with keys [${Object.keys(args[0])}]`
                } catch (e) {
                    message = `an unknown object`
                }
            } else {
                message = 'an unknown object'
            }
            if (args.length > 1)
                message += ` (and ${args.length - 1} more argument${
                    args.length - 1 === 1 ? '' : 's'
                }).`

            let finalMessage = messageIfFirstArgumentIsString
            if (messageIfFirstArgumentIsString && message) finalMessage += ' | '
            if (message) {
                finalMessage += `Verbose debugger available for: ${message}`
            }

            const scope = callerCallsite({ depth: 0 })?.scope
            debugWithScope(scope || '', debugStdOut, finalMessage)
            LogBase._runHooks(
                'logVerbose',
                debugStdOut.enabled,
                scope,
                copiedArgs || args,
            )
            return
        },
        debugStdOut,
    )

    const logError: Debugger = _createDebugger('logError', debugStdErr)

    const logFatal: Debugger = Object.assign(
        (...args: [arg: unknown, ...args: unknown[]]) => {
            const scope = callerCallsite({ depth: 0 })?.scope
            debugWithScope(
                scope || '',
                debugStdErrFatal,
                '\x1b[31m',
                'FATAL:',
                ...args,
                '\u001B[0m',
            )
            LogBase._runHooks('logFatal', debugStdErrFatal.enabled, scope, args)
        },
        debugStdErrFatal,
    )

    return { log, logWarn, logError, logFatal, logDebug, logVerbose }
}
