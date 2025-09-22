"use strict";
/**
 * Data transformation utilities for converting between Unraid API values
 * and ioBroker state values
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.kilobytesToGigabytes = kilobytesToGigabytes;
exports.bytesToGigabytes = bytesToGigabytes;
exports.calculateUsagePercent = calculateUsagePercent;
exports.bigIntToNumber = bigIntToNumber;
exports.toStringOrNull = toStringOrNull;
exports.toBooleanOrNull = toBooleanOrNull;
exports.toNumberOrNull = toNumberOrNull;
exports.resolveValue = resolveValue;
/**
 * Convert kilobytes to gigabytes with 2 decimal precision
 */
function kilobytesToGigabytes(value) {
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
function bytesToGigabytes(value) {
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
function calculateUsagePercent(used, total) {
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
function bigIntToNumber(value) {
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
function toStringOrNull(value) {
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
function toBooleanOrNull(value) {
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
function toNumberOrNull(value) {
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
function resolveValue(source, path) {
    let current = source;
    for (const segment of path) {
        if (!current || typeof current !== 'object') {
            return null;
        }
        current = current[segment];
    }
    return current === undefined ? null : current;
}
//# sourceMappingURL=data-transformers.js.map