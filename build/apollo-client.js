"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMORY_SUBSCRIPTION = exports.CPU_SUBSCRIPTION = exports.METRICS_SUBSCRIPTION = exports.UnraidApolloClient = void 0;
const core_1 = require("@apollo/client/core");
const subscriptions_1 = require("@apollo/client/link/subscriptions");
const utilities_1 = require("@apollo/client/utilities");
const graphql_ws_1 = require("graphql-ws");
const ws_1 = __importDefault(require("ws"));
const undici_1 = require("undici");
/**
 * Apollo GraphQL client wrapper for Unraid server communication.
 * Handles both HTTP queries/mutations and WebSocket subscriptions.
 */
class UnraidApolloClient {
    /** Apollo Client instance for GraphQL operations */
    client;
    /** WebSocket client for subscription support */
    wsClient;
    /** Base URL of the Unraid server */
    baseUrl;
    /** API token for authentication */
    apiToken;
    /**
     * Creates a new Unraid Apollo client instance
     *
     * @param options - Configuration options for the client
     */
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.apiToken = options.apiToken;
        // Configure undici for self-signed certificates if needed
        if (options.allowSelfSigned && this.baseUrl.startsWith('https://')) {
            (0, undici_1.setGlobalDispatcher)(new undici_1.Agent({
                connect: {
                    rejectUnauthorized: false,
                },
            }));
        }
        // Create WebSocket client for subscriptions
        const wsUrl = `${this.baseUrl.replace(/^http/, 'ws')}/graphql`;
        // Create a custom WebSocket class that includes our options
        class CustomWebSocket extends ws_1.default {
            constructor(url, protocols) {
                const wsOptions = {
                    rejectUnauthorized: !options.allowSelfSigned,
                    headers: {
                        'x-api-key': options.apiToken,
                    },
                };
                super(url, protocols, wsOptions);
            }
        }
        this.wsClient = (0, graphql_ws_1.createClient)({
            url: wsUrl,
            webSocketImpl: CustomWebSocket,
            connectionParams: {
                'x-api-key': this.apiToken,
            },
            retryAttempts: 5,
            shouldRetry: () => true,
            keepAlive: 30000,
        });
        // Create HTTP link for queries and mutations
        const httpLink = new core_1.HttpLink({
            uri: `${this.baseUrl}/graphql`,
            headers: {
                'x-api-key': this.apiToken,
            },
        });
        // Create WebSocket link for subscriptions
        const wsLink = new subscriptions_1.GraphQLWsLink(this.wsClient);
        // Split link based on operation type
        const splitLink = (0, core_1.split)(({ query }) => {
            const definition = (0, utilities_1.getMainDefinition)(query);
            return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
        }, wsLink, httpLink);
        // Create Apollo Client
        this.client = new core_1.ApolloClient({
            link: splitLink,
            cache: new core_1.InMemoryCache(),
            defaultOptions: {
                watchQuery: {
                    fetchPolicy: 'no-cache',
                },
                query: {
                    fetchPolicy: 'no-cache',
                },
            },
        });
    }
    /**
     * Execute a GraphQL query against the Unraid server
     *
     * @param query - The GraphQL query string
     * @returns Promise resolving to the query result data
     * @template T - Type of the expected query result
     */
    async query(query) {
        const result = await this.client.query({
            query: (0, core_1.gql)(query),
        });
        return result.data;
    }
    /**
     * Execute a GraphQL mutation against the Unraid server
     *
     * @param mutation - The GraphQL mutation string
     * @param variables - Optional variables for the mutation
     * @returns Promise resolving to the mutation result data
     * @template T - Type of the expected mutation result
     */
    async mutate(mutation, variables) {
        const result = await this.client.mutate({
            mutation: (0, core_1.gql)(mutation),
            variables,
        });
        return result.data;
    }
    /**
     * Subscribe to a GraphQL subscription for real-time updates
     *
     * @param subscription - The GraphQL subscription string
     * @param variables - Optional variables for the subscription
     * @returns Observable that emits subscription results
     * @template T - Type of the expected subscription result
     */
    subscribe(subscription, variables) {
        return this.client.subscribe({
            query: (0, core_1.gql)(subscription),
            variables,
        });
    }
    /**
     * Run an introspection query to discover available GraphQL subscriptions.
     * Useful for debugging and discovering the Unraid API schema.
     *
     * @returns Promise resolving to subscription type information or null if failed
     */
    async introspectSubscriptions() {
        const introspectionQuery = `
            query IntrospectionQuery {
                __schema {
                    subscriptionType {
                        name
                        fields {
                            name
                            description
                            args {
                                name
                                type {
                                    name
                                    kind
                                }
                            }
                            type {
                                name
                                kind
                            }
                        }
                    }
                }
            }
        `;
        try {
            const result = await this.query(introspectionQuery);
            return result?.__schema?.subscriptionType;
        }
        catch (error) {
            console.error('Failed to introspect subscriptions:', error);
            return null;
        }
    }
    /**
     * Dispose the client and close all connections.
     * Should be called when the client is no longer needed.
     *
     * @returns Promise that resolves when cleanup is complete
     */
    async dispose() {
        this.client.stop();
        await this.wsClient.dispose();
    }
    /**
     * Check if the WebSocket connection is established
     *
     * @returns True if WebSocket client exists, false otherwise
     */
    isConnected() {
        // This is a simplified check - you might want to implement more sophisticated logic
        return this.wsClient !== null;
    }
}
exports.UnraidApolloClient = UnraidApolloClient;
/**
 * GraphQL subscription for comprehensive system metrics.
 * Includes both CPU and memory statistics.
 */
exports.METRICS_SUBSCRIPTION = `
    subscription MetricsSubscription {
        metrics {
            cpu {
                percentTotal
            }
            memory {
                percentTotal
                total
                used
                free
            }
        }
    }
`;
/**
 * GraphQL subscription for CPU metrics only.
 * Returns the total CPU usage percentage.
 */
exports.CPU_SUBSCRIPTION = `
    subscription CpuSubscription {
        cpu {
            percentTotal
        }
    }
`;
/**
 * GraphQL subscription for memory metrics.
 * Includes total, used, free memory and usage percentage.
 */
exports.MEMORY_SUBSCRIPTION = `
    subscription MemorySubscription {
        memory {
            percentTotal
            total
            used
            free
        }
    }
`;
//# sourceMappingURL=apollo-client.js.map