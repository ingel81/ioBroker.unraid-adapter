import { ApolloClient, InMemoryCache, split, HttpLink, gql } from '@apollo/client/core';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';
import type { ClientOptions } from 'ws';
import WebSocket from 'ws';
import { setGlobalDispatcher, Agent } from 'undici';

export interface ApolloClientOptions {
    baseUrl: string;
    apiToken: string;
    allowSelfSigned?: boolean;
}

export class UnraidApolloClient {
    private client: ApolloClient<unknown>;
    private wsClient: ReturnType<typeof createClient>;
    private readonly baseUrl: string;
    private readonly apiToken: string;

    constructor(options: ApolloClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.apiToken = options.apiToken;

        // Configure undici for self-signed certificates if needed
        if (options.allowSelfSigned && this.baseUrl.startsWith('https://')) {
            setGlobalDispatcher(new Agent({
                connect: {
                    rejectUnauthorized: false
                }
            }));
        }

        // Create WebSocket client for subscriptions
        const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/graphql';

        // Create a custom WebSocket class that includes our options
        class CustomWebSocket extends WebSocket {
            constructor(url: string | URL, protocols?: string | string[]) {
                const wsOptions: ClientOptions = {
                    rejectUnauthorized: !options.allowSelfSigned,
                    headers: {
                        'x-api-key': options.apiToken
                    }
                };
                super(url, protocols, wsOptions);
            }
        }

        this.wsClient = createClient({
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
        const httpLink = new HttpLink({
            uri: `${this.baseUrl}/graphql`,
            headers: {
                'x-api-key': this.apiToken
            }
        });

        // Create WebSocket link for subscriptions
        const wsLink = new GraphQLWsLink(this.wsClient);

        // Split link based on operation type
        const splitLink = split(
            ({ query }) => {
                const definition = getMainDefinition(query);
                return (
                    definition.kind === 'OperationDefinition' &&
                    definition.operation === 'subscription'
                );
            },
            wsLink,
            httpLink
        );

        // Create Apollo Client
        this.client = new ApolloClient({
            link: splitLink,
            cache: new InMemoryCache(),
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
    async query<T = unknown>(query: string): Promise<T> {
        const result = await this.client.query<T>({
            query: gql(query)
        });
        return result.data;
    }

    /**
     * Execute a GraphQL mutation
     */
    async mutate<T = unknown>(mutation: string, variables?: Record<string, unknown>): Promise<T> {
        const result = await this.client.mutate<T>({
            mutation: gql(mutation),
            variables
        });
        return result.data as T;
    }

    /**
     * Subscribe to a GraphQL subscription
     */
    subscribe<T = unknown>(subscription: string, variables?: Record<string, unknown>) {
        return this.client.subscribe<T>({
            query: gql(subscription),
            variables
        });
    }

    /**
     * Run an introspection query to discover available subscriptions
     */
    async introspectSubscriptions(): Promise<unknown> {
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
            const result = await this.query<{ __schema?: { subscriptionType?: unknown } }>(introspectionQuery);
            return result?.__schema?.subscriptionType;
        } catch (error) {
            console.error('Failed to introspect subscriptions:', error);
            return null;
        }
    }

    /**
     * Dispose the client and close connections
     */
    async dispose(): Promise<void> {
        this.client.stop();
        await this.wsClient.dispose();
    }

    /**
     * Check if WebSocket is connected
     */
    isConnected(): boolean {
        // This is a simplified check - you might want to implement more sophisticated logic
        return this.wsClient !== null;
    }
}

// Export commonly used GraphQL subscriptions for Unraid metrics
export const METRICS_SUBSCRIPTION = `
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

export const CPU_SUBSCRIPTION = `
    subscription CpuSubscription {
        cpu {
            percentTotal
        }
    }
`;

export const MEMORY_SUBSCRIPTION = `
    subscription MemorySubscription {
        memory {
            percentTotal
            total
            used
            free
        }
    }
`;