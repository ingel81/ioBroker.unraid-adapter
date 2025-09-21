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
class UnraidApolloClient {
    client;
    wsClient;
    baseUrl;
    apiToken;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.apiToken = options.apiToken;
        // Configure undici for self-signed certificates if needed
        if (options.allowSelfSigned && this.baseUrl.startsWith('https://')) {
            (0, undici_1.setGlobalDispatcher)(new undici_1.Agent({
                connect: {
                    rejectUnauthorized: false
                }
            }));
        }
        // Create WebSocket client for subscriptions
        const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/graphql';
        // Create a custom WebSocket class that includes our options
        class CustomWebSocket extends ws_1.default {
            constructor(url, protocols) {
                const wsOptions = {
                    rejectUnauthorized: !options.allowSelfSigned,
                    headers: {
                        'x-api-key': options.apiToken
                    }
                };
                super(url, protocols, wsOptions);
            }
        }
        this.wsClient = (0, graphql_ws_1.createClient)({
            url: wsUrl,
            webSocketImpl: CustomWebSocket,
            connectionParams: {
                'x-api-key': this.apiToken
            },
            retryAttempts: 5,
            shouldRetry: () => true,
            keepAlive: 30000,
        });
        // Create HTTP link for queries and mutations
        const httpLink = new core_1.HttpLink({
            uri: `${this.baseUrl}/graphql`,
            headers: {
                'x-api-key': this.apiToken
            }
        });
        // Create WebSocket link for subscriptions
        const wsLink = new subscriptions_1.GraphQLWsLink(this.wsClient);
        // Split link based on operation type
        const splitLink = (0, core_1.split)(({ query }) => {
            const definition = (0, utilities_1.getMainDefinition)(query);
            return (definition.kind === 'OperationDefinition' &&
                definition.operation === 'subscription');
        }, wsLink, httpLink);
        // Create Apollo Client
        this.client = new core_1.ApolloClient({
            link: splitLink,
            cache: new core_1.InMemoryCache(),
            defaultOptions: {
                watchQuery: {
                    fetchPolicy: 'no-cache'
                },
                query: {
                    fetchPolicy: 'no-cache'
                }
            }
        });
    }
    /**
     * Execute a GraphQL query
     */
    async query(query) {
        const result = await this.client.query({
            query: (0, core_1.gql)(query)
        });
        return result.data;
    }
    /**
     * Execute a GraphQL mutation
     */
    async mutate(mutation, variables) {
        const result = await this.client.mutate({
            mutation: (0, core_1.gql)(mutation),
            variables
        });
        return result.data;
    }
    /**
     * Subscribe to a GraphQL subscription
     */
    subscribe(subscription, variables) {
        return this.client.subscribe({
            query: (0, core_1.gql)(subscription),
            variables
        });
    }
    /**
     * Run an introspection query to discover available subscriptions
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
     * Dispose the client and close connections
     */
    async dispose() {
        this.client.stop();
        await this.wsClient.dispose();
    }
    /**
     * Check if WebSocket is connected
     */
    isConnected() {
        // This is a simplified check - you might want to implement more sophisticated logic
        return this.wsClient !== null;
    }
}
exports.UnraidApolloClient = UnraidApolloClient;
// Export commonly used GraphQL subscriptions for Unraid metrics
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
exports.CPU_SUBSCRIPTION = `
    subscription CpuSubscription {
        cpu {
            percentTotal
        }
    }
`;
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