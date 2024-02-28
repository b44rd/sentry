/**
   * Extracts the hard crash information from the event exceptions.
   * No exceptions or undefined handled are not hard crashes.
   */
export function isHardCrash(payload) {
    const values = typeof payload !== 'string' && 'exception' in payload && payload.exception?.values
        ? payload.exception.values
        : [];
    for (const exception of values) {
        if (!(exception.mechanism?.handled !== false)) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=misc.js.map