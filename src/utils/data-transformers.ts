/**
 * Data transformation utilities for converting between Unraid API values
 * and ioBroker state values
 */

/**
 * Convert kilobytes to gigabytes with 2 decimal precision
 */
export function kilobytesToGigabytes(value: unknown): number | null {
    const numeric = toNumberOrNull(value);
    if (numeric === null) {
        return null;
    }
    const gb = numeric / (1024 * 1024);
    return Number.isFinite(gb) ? Math.round(gb * 100) / 100 : null;
}

/**
 * Convert bytes to gigabytes with 2 decimal precision
 */
export function bytesToGigabytes(value: unknown): number | null {
    const numeric = toNumberOrNull(value);
    if (numeric === null) {
        return null;
    }
    const gb = numeric / (1024 * 1024 * 1024);
    return Number.isFinite(gb) ? Math.round(gb * 100) / 100 : null;
}

/**
 * Calculate usage percentage from used and total values
 */
export function calculateUsagePercent(used: unknown, total: unknown): number | null {
    const usedNumeric = toNumberOrNull(used);
    const totalNumeric = toNumberOrNull(total);

    // Return null if either value is null or total is 0
    if (usedNumeric === null || totalNumeric === null || totalNumeric === 0) {
        return null;
    }

    const percent = (usedNumeric / totalNumeric) * 100;
    return Number.isFinite(percent) ? Math.round(percent * 100) / 100 : null;
}

/**
 * Convert BigInt values to number safely
 */
export function bigIntToNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'bigint') {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }
    return toNumberOrNull(value);
}

/**
 * Convert any value to string or null
 */
export function toStringOrNull(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return null;
}

/**
 * Convert any value to boolean or null
 */
export function toBooleanOrNull(value: unknown): boolean | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    return null;
}

/**
 * Convert any value to number or null
 */
export function toNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/**
 * Resolve a value from an object by path
 */
export function resolveValue(source: unknown, path: readonly string[]): unknown {
    let current: unknown = source;
    for (const segment of path) {
        if (!current || typeof current !== 'object') {
            return null;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return current === undefined ? null : current;
}