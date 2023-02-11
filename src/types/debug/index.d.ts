/* eslint-disable @typescript-eslint/no-explicit-any */
declare const debug: Debug & { debug: Debug; default: Debug }

declare module 'debug' {
    export = debug
    export as namespace debug
}

interface Debug {
    (namespace: string): Debugger
    coerce: (val: any) => any
    disable: () => string
    enable: (namespaces: string) => void
    enabled: (namespaces: string) => boolean
    formatArgs: (this: Debugger, args: unknown[]) => void
    log: (...args: unknown[]) => void
    selectColor: (namespace: string) => string | number
    humanize: typeof import('ms')

    names: RegExp[]
    skips: RegExp[]

    /**
     * Custom formatters
     * You can add custom formatters by extending the debug.formatters object. For example, if you wanted to add support for rendering a Buffer as hex with %h, you could do something like:
     * @example
     * import { debug } from 'debug'
     *
     * debug.formatters.h = (v) => {
     *     return v.toString('hex')
     * }
     *
     * // …elsewhere
     * const log = debug('foo')
     * log('this is hex: %h', new Buffer('hello world'))
     */
    formatters: Formatters
}

type IDebug = Debug

type formatter = (v: any) => string

interface Formatters {
    [formatter: string]: formatter
}

type IDebugger = Debugger

interface Debugger {
    (...args: unknown[]): void
    /**
     * Debug uses printf-style formatting. Below are the officially supported formatters:

     * |Formatter|Representation|
     * |:--------|:-------------|
     * |%O	     |Pretty-print an Object on multiple lines.|
     * |%o	     |Pretty-print an Object all on a single line.|
     * |%s	     |String.|
     * |%d	     |Number (both integer and float).|
     * |%j	     |JSON. Replaced with the string '[Circular]' if the argument contains circular references.|
     * |%%	     |Single percent sign ('%'). This does not consume an argument.|
     * 
     * @example
     */
    (formatter: formatter, ...args: unknown[]): void

    color: string
    diff: number
    enabled: boolean
    log: (...args: unknown[]) => void
    namespace: string

    // added property
    scope: string | null

    /**
     * @deprecated DO NOT USE. This is a temporary stub function. It WILL be removed in the next major release.
     */
    destroy: () => boolean

    /**
     * Extends the namespace of a debugger
     * @param namespace
     * @param delimiter
     * @returns
     *
     * @example
     * // index.ts
     * const { log } = Log(__filename)
     * log('Outer scope')
     *
     * const parent = () => {
     *     const { log: logParent } = log.extend('parent')
     *     logParent('output from parent')
     *
     *     const child = () => {
     *         const { log: logChild } = logParent.extend('output from child')
     *         logChild('child')
     *     }
     *     child()
     * }
     *
     * // will output:
     * // index.ts Outerscope
     * // index.ts:parent output from parent
     * // index.ts:parent:child output from child
     */
    extend: (namespace: string, delimiter?: string) => Debugger

    /**
     * Use env variables to toggle this rather can manipulating directly here.
     */
    inspectOpts: {
        hideDate: boolean | null | number
        colors: boolean | null | number
        depth: boolean | null | number
        showHidden: boolean | null | number
        customInspect: boolean | null | number
        showProxy: boolean | null | number
        maxArrayLength: boolean | null | number
        maxStringLength: boolean | null | number
        breakLength: boolean | null | number
        compact: boolean | null | number
        sorted: boolean | null | number
        getters: boolean | null | number
        numericSeparator: boolean | null | number
    }
}
