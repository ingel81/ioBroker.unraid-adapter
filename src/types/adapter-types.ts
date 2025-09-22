/**
 * Type definitions for adapter interfaces to avoid TypeScript issues
 * with the @iobroker/adapter-core types
 */

import type { AdapterInstance } from '@iobroker/adapter-core';

/**
 * Adapter interface type that can be used in constructor parameters
 */
export type AdapterInterface = AdapterInstance;