import { debug } from '../index'

const debugtsLogger = debug('debugts')

export interface CallSite {
    /**
		Returns the value of `this`.
		*/
    getThis(): unknown | undefined

    /**
		Returns the type of `this` as a string. This is the name of the function stored in the constructor field of `this`, if available, otherwise the object's `[[Class]]` internal property.
		*/
    getTypeName(): string | null

    /**
		Returns the current function.
		*/
    // eslint-disable-next-line @typescript-eslint/ban-types
    getFunction(): Function | undefined

    /**
		Returns the name of the current function, typically its `name` property. If a name property is not available an attempt will be made to try to infer a name from the function's context.
		*/
    getFunctionName(): string | null

    /**
		Returns the name of the property of `this` or one of its prototypes that holds the current function.
		*/
    getMethodName(): string | undefined

    /**
		Returns the name of the script if this function was defined in a script.
		*/
    getFileName(): string | null

    /**
		Returns the current line number if this function was defined in a script.
		*/
    getLineNumber(): number | null

    /**
		Returns the current column number if this function was defined in a script.
		*/
    getColumnNumber(): number | null

    /**
		Returns a string representing the location where `eval` was called if this function was created using a call to `eval`.
		*/
    getEvalOrigin(): string | undefined

    /**
		Returns `true` if this is a top-level invocation, that is, if it's a global object.
		*/
    isToplevel(): boolean

    /**
		Returns `true` if this call takes place in code defined by a call to `eval`.
		*/
    isEval(): boolean

    /**
		Returns `true` if this call is in native V8 code.
		*/
    isNative(): boolean

    /**
		Returns `true` if this is a constructor call.
		*/
    isConstructor(): boolean
}

/**
 * See npm callsites
 * @returns
 */
const callsites = (): CallSite[] => {
    const _prepareStackTrace = Error.prepareStackTrace
    Error.prepareStackTrace = (_, stack) => stack
    const stack = new Error().stack?.slice(1)
    Error.prepareStackTrace = _prepareStackTrace
    return stack as unknown as CallSite[]
}

export interface ICallerCallsite {
    scope: string | undefined | null
    file: string | undefined | null
    line: number | undefined | null
    position: number | undefined | null
}

export function callerCallsite({ depth = 0 } = {}) {
    const callers = []
    const callerFileSet = new Set()
    const msg = 'WARN: You are losing debugging information.'

    const result: ICallerCallsite = {
        scope: undefined,
        file: undefined,
        line: undefined,
        position: undefined,
    }

    try {
        for (const callsite of callsites()) {
            const fileName = callsite.getFileName()
            const hasReceiver = callsite.getTypeName() !== null && fileName !== null

            if (!callerFileSet.has(fileName)) {
                callerFileSet.add(fileName)
                callers.unshift(callsite)
            }

            if (hasReceiver) {
                result.scope = callers[depth].getFunctionName()
                result.file = callers[depth].getFileName()
                result.line = callers[depth].getLineNumber()
                result.position = callers[depth].getColumnNumber()

                return result
            }
        }
        return null
    } catch (err) {
        debugtsLogger.extend('getCaller')(`${msg} Reason: Error in parsing stack.`, err)
        return null
        // don't return the partial result, because without the filename, it's pretty meaningless
    }
}
