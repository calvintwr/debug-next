export const isPrimitive = (candidate: unknown) => {
    const t = typeof candidate
    if (t === 'string') return 'string'
    if (t === 'number') return 'number'
    if (t === 'boolean') return 'boolean'
    if (t === 'symbol') return 'symbol'
    if (candidate === undefined) return 'undefined'
    if (candidate === null) return 'null'
    return false
}
