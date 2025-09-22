import type { DomainId } from '../shared/unraid-domains';
import { allDomainIds, defaultEnabledDomains } from '../shared/unraid-domains';

/**
 * Adapter configuration settings from the admin interface
 */
export interface AdapterConfig {
    /** Base URL of the Unraid server */
    baseUrl: string;
    /** API token for Unraid authentication */
    apiToken: string;
    /** Interval between polling requests in seconds */
    pollIntervalSeconds: number;
    /** Allow self-signed SSL certificates */
    allowSelfSigned: boolean;
    /** List of enabled domain IDs for data collection */
    enabledDomains: DomainId[];
    /** Whether to use WebSocket subscriptions (experimental) */
    useSubscriptions?: boolean;
}

/**
 * Validate and normalize adapter configuration settings
 * @param config - Raw configuration from ioBroker
 * @returns Validated configuration or null if invalid
 */
export function validateConfig(config: Record<string, unknown>, logger?: { error: (msg: string) => void }): AdapterConfig | null {
    const baseUrl = (config.baseUrl as string ?? '').trim();
    const apiToken = (config.apiToken as string ?? '').trim();
    const pollIntervalSecondsRaw = Number(config.pollIntervalSeconds ?? 60);
    const pollIntervalSeconds = Number.isFinite(pollIntervalSecondsRaw) && pollIntervalSecondsRaw > 0
        ? pollIntervalSecondsRaw
        : 60;
    const allowSelfSigned = Boolean(config.allowSelfSigned);
    const useSubscriptions = Boolean(config.useSubscriptions);

    const enabledDomainsRaw = Array.isArray(config.enabledDomains)
        ? (config.enabledDomains as string[])
        : [...defaultEnabledDomains];

    const knownIds = new Set(allDomainIds);
    const enabledDomains: DomainId[] = [];
    for (const id of enabledDomainsRaw) {
        if (knownIds.has(id as DomainId)) {
            enabledDomains.push(id as DomainId);
        }
    }

    if (!enabledDomains.length) {
        enabledDomains.push(...(defaultEnabledDomains as DomainId[]));
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