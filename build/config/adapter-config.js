"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateConfig = validateConfig;
const unraid_domains_1 = require("../shared/unraid-domains");
/**
 * Validate and normalize adapter configuration settings
 *
 * @param config - Raw configuration from ioBroker
 * @returns Validated configuration or null if invalid
 */
function validateConfig(config, logger) {
    const baseUrl = (config.baseUrl ?? '').trim();
    const apiToken = (config.apiToken ?? '').trim();
    const pollIntervalSecondsRaw = Number(config.pollIntervalSeconds ?? 60);
    const pollIntervalSeconds = Number.isFinite(pollIntervalSecondsRaw) && pollIntervalSecondsRaw > 0 ? pollIntervalSecondsRaw : 60;
    const allowSelfSigned = Boolean(config.allowSelfSigned);
    const useSubscriptions = Boolean(config.useSubscriptions);
    const enabledDomainsRaw = Array.isArray(config.enabledDomains)
        ? config.enabledDomains
        : [...unraid_domains_1.defaultEnabledDomains];
    const knownIds = new Set(unraid_domains_1.allDomainIds);
    const enabledDomains = [];
    for (const id of enabledDomainsRaw) {
        if (knownIds.has(id)) {
            enabledDomains.push(id);
        }
    }
    if (!enabledDomains.length) {
        enabledDomains.push(...unraid_domains_1.defaultEnabledDomains);
    }
    if (!baseUrl) {
        logger?.error('Base URL is not configured.');
        return null;
    }
    if (!apiToken) {
        logger?.error('API token is not configured.');
        return null;
    }
    return {
        baseUrl,
        apiToken,
        pollIntervalSeconds,
        allowSelfSigned,
        enabledDomains,
        useSubscriptions,
    };
}
//# sourceMappingURL=adapter-config.js.map