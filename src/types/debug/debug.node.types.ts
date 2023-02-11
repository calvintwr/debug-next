type ThumbToCamelCase<S extends string> = S extends `${infer T}_${infer U}`
    ? `${Lowercase<T>}${Capitalize<ThumbToCamelCase<U>>}`
    : Lowercase<S>

export const inspectOptsKeysThumbCase = [
    'HIDE_DATE',
    'COLORS',
    'DEPTH',
    'SHOW_HIDDEN',
    'CUSTOM_INSPECT',
    'SHOW_PROXY',
    'MAX_ARRAY_LENGTH',
    'MAX_STRING_LENGTH',
    'BREAK_LENGTH',
    'COMPACT',
    'SORTED',
    'GETTERS',
    'NUMERIC_SEPARATOR',
]

export type TInspectOptsKeysThumbCase = (typeof inspectOptsKeysThumbCase)[number]

export type TInspectOptsKeys = ThumbToCamelCase<TInspectOptsKeysThumbCase>

/**
 * These are the possible values from the parsed outputs.
 * The options need to be checked for exact expections (number or boolean) before being used.
 */
export type TInspectOpts = {
    [key in TInspectOptsKeys]?: boolean | null | number
}
