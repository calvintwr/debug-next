type TToggleLiterals =
    | 'yes'
    | 'on'
    | 'true'
    | 'enabled'
    | 'no'
    | 'off'
    | 'false'
    | 'disabled'

declare namespace NodeJS {
    export interface ProcessEnv {
        // LOGGING
        // There are 3 levels of logging: (1) console/debug, (2) error, (3) fatal (will always be logged).

        // (1) and (2) is controlled by DEBUG env var.

        /**
         * Enables/disables specific debugging namespaces.
         * Setting debug: see https://github.com/debug-js/debug#wildcards
         * Example, DEBUG=malt:*,-malt:apps:error-handlers:* means all namespaces starting with "malt" but omit "error-handlers"
         */
        DEBUG?: string

        // LOG_VERBOSE enables namespaced loggers that are expecting largest datasets.
        DEBUG_VERBOSE?: 'true' | 'false'

        // (2) can be switched on regardless of DEBUG, by LOG_ERROR=true (advisable during heavy development / deploying radical changes)
        DEBUG_ERROR?: 'true' | 'false'

        /**
         * Hide date from debug output (non-TTY).
         */
        DEBUG_HIDE_DATE?: TToggleLiterals

        /* NODE util.inspect PROPERTIES
         * See https://nodejs.org/api/util.html#util_util_inspect_object_options
         */

        /**
         * Whether or not to use colors in the debug output.
         */
        DEBUG_COLORS?: TToggleLiterals

        /**
         * Specifies the number of times to recurse while formatting object. This is useful for inspecting
         * large objects. To recurse up to the maximum call stack size pass `Infinity` or `null`. Defaults: 2
         */
        DEBUG_DEPTH?:
            | '0'
            | '1'
            | '2'
            | '3'
            | '4'
            | '5'
            | '6'
            | '7'
            | '8'
            | '9'
            | '10'
            // eslint-disable-next-line @typescript-eslint/ban-types
            | (string & {})

        /**
         * If true, object's non-enumerable symbols and properties are included in the formatted result.
         * WeakMap and WeakSet entries are also included as well as user defined prototype properties
         * (excluding method properties). Default: false.
         */
        DEBUG_SHOW_HIDDEN?: TToggleLiterals

        /**
         * If false, [util.inspect.custom](depth, opts, inspect) functions are not invoked. Default: true.
         */
        DEBUG_CUSTOM_INSPECT?: TToggleLiterals
        /**
         * If true, Proxy inspection includes the target and handler objects. Default: false.
         */
        DEBUG_SHOW_PROXY?: TToggleLiterals
        /**
         * Specifies the maximum number of Array, TypedArray, Map, Set, WeakMap, and WeakSet elements to include when formatting. Set to null or Infinity to show all elements. Set to 0 or negative to show no elements. Default: 100.
         */
        DEBUG_MAX_ARRAY_LENGTH?:
            | '0'
            | '1'
            | '2'
            | '3'
            | '4'
            | '5'
            | '6'
            | '7'
            | '8'
            | '9'
            | '10'
            // eslint-disable-next-line @typescript-eslint/ban-types
            | (string & {})
        /**
         * Specifies the maximum number of characters to include when formatting. Set to null or Infinity to show all elements. Set to 0 or negative to show no characters. Default: 10000.
         */
        DEBUG_MAX_STRING_LENGTH?:
            | '0'
            | '1'
            | '2'
            | '3'
            | '4'
            | '5'
            | '6'
            | '7'
            | '8'
            | '9'
            | '10'
            // eslint-disable-next-line @typescript-eslint/ban-types
            | (string & {})
        /**
         * The length at which input values are split across multiple lines. Set to Infinity to format the input as a single line (in combination with compact set to true or any number >= 1). Default: 80.
         */
        DEBUG_BREAK_LENGTH?:
            | '0'
            | '1'
            | '2'
            | '3'
            | '4'
            | '5'
            | '6'
            | '7'
            | '8'
            | '9'
            | '10'
            // eslint-disable-next-line @typescript-eslint/ban-types
            | (string & {})
        /**
         * Setting this to false causes each object key to be displayed on a new line. It will break on new lines in text that is longer than breakLength. If set to a number, the most n inner elements are united on a single line as long as all properties fit into breakLength. Short array elements are also grouped together. Default: 3.
         */
        DEBUG_COMPACT?: TToggleLiterals
        /**
         * If set to true, all properties of an object, and Set and Map entries are sorted in the resulting string. If set to true the default sort is used.
         */
        DEBUG_SORTED?: TToggleLiterals
        /**
         * If set to true, getters are inspected. Default: false.
         */
        DEBUG_GETTERS?: TToggleLiterals
        /**
         * If set to true, an underscore is used to separate every three digits in all bigints and numbers. Default: false.
         */
        DEBUG_NUMERIC_SEPARATOR?: TToggleLiterals
    }
}
