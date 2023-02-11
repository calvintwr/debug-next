import { Debugger } from '../types/debug/debug.types'

/**
 * Debug can parse inspectOpts from env into boolean, null or number.
 * It passes them along to NodeJS's util, which doesn't reject.
 * However, we should respect type safety in-case Node makes breaking changes.
 * See: https://nodejs.org/api/util.html#util_util_inspect_object_options
 * @param inspectOpts
 * @returns
 */
export const cleanInspectOpts = (inspectOpts: Debugger['inspectOpts']) => {
    if (typeof inspectOpts !== 'object') return {}
    if (Object.keys(inspectOpts).length === 0) return {}

    const {
        hideDate,
        colors,
        depth,
        showHidden,
        customInspect,
        showProxy,
        maxArrayLength,
        maxStringLength,
        breakLength,
        compact,
        sorted,
        getters,
        numericSeparator,
    } = inspectOpts

    if (Number.isInteger(depth)) {
        depth
    }

    return {
        ...(typeof hideDate === 'boolean' ? { hideDate } : {}),
        ...(typeof colors === 'boolean' ? { colors } : {}),
        ...(Number.isInteger(depth) && typeof depth === 'number' ? { depth } : {}),
        ...(typeof showHidden === 'boolean' ? { showHidden } : {}),
        ...(typeof customInspect === 'boolean' ? { customInspect } : {}),
        ...(typeof showProxy === 'boolean' ? { showProxy } : {}),
        ...(Number.isInteger(maxArrayLength) && typeof maxArrayLength === 'number'
            ? { maxArrayLength }
            : {}),
        ...(Number.isInteger(maxStringLength) && typeof maxStringLength === 'number'
            ? { maxStringLength }
            : {}),
        ...(Number.isInteger(breakLength) && typeof breakLength === 'number'
            ? { breakLength }
            : {}),
        ...(Number.isInteger(compact) && typeof compact === 'number'
            ? { compact }
            : typeof compact === 'boolean'
            ? { compact }
            : {}),
        ...(typeof sorted === 'boolean' ? { sorted } : {}),
        ...(typeof getters === 'boolean' ? { getters } : {}),
        ...(typeof numericSeparator === 'boolean' ? { numericSeparator } : {}),
    }
}
