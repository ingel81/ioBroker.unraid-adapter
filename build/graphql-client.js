"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphQLClient = exports.GraphQLResponseError = exports.GraphQLRequestError = exports.GraphQLHttpError = void 0;
const undici_1 = require("undici");
class GraphQLHttpError extends Error {
    status;
    body;
    json;
    constructor(status, body, json) {
        const suffix = body ? `: ${body}` : '';
        super(`HTTP ${status}${suffix}`);
        this.name = 'GraphQLHttpError';
        this.status = status;
        this.body = body;
        this.json = json;
    }
}
exports.GraphQLHttpError = GraphQLHttpError;
class GraphQLRequestError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GraphQLRequestError';
    }
}
exports.GraphQLRequestError = GraphQLRequestError;
class GraphQLResponseError extends Error {
    errors;
    constructor(errors) {
        super(errors.map((error) => error.message).filter(Boolean).join('; ') || 'GraphQL response contained errors');
        this.name = 'GraphQLResponseError';
        this.errors = errors;
    }
}
exports.GraphQLResponseError = GraphQLResponseError;
class GraphQLClient {
    endpoint;
    token;
    timeoutMs;
    agent;
    constructor({ baseUrl, token, timeoutMs, allowSelfSigned }) {
        const trimmedBaseUrl = baseUrl.replace(/\/$/, '');
        this.endpoint = `${trimmedBaseUrl}/graphql`;
        this.token = token;
        this.timeoutMs = timeoutMs ?? 15000;
        if (allowSelfSigned && this.endpoint.startsWith('https://')) {
            // Accept self-signed certs by disabling TLS validation for this client only
            this.agent = new undici_1.Agent({
                connect: {
                    rejectUnauthorized: false,
                },
            });
        }
    }
    async query(query) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const headers = {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            };
            if (this.token) {
                headers['x-api-key'] = this.token;
            }
            const requestInit = {
                method: 'POST',
                headers,
                body: JSON.stringify({ query }),
                signal: controller.signal,
            };
            if (this.agent) {
                requestInit.dispatcher = this.agent;
            }
            const response = await fetch(this.endpoint, requestInit);
            if (!response.ok) {
                let bodyText = '';
                try {
                    bodyText = await response.text();
                }
                catch (readError) {
                    const message = readError instanceof Error ? readError.message : String(readError);
                    throw new GraphQLHttpError(response.status, message || '');
                }
                let json;
                try {
                    json = bodyText ? JSON.parse(bodyText) : undefined;
                }
                catch {
                    // ignore parse error, keep original body text
                }
                throw new GraphQLHttpError(response.status, bodyText.trim(), json);
            }
            const payload = (await response.json());
            if (payload.errors?.length) {
                throw new GraphQLResponseError(payload.errors);
            }
            if (!payload.data) {
                throw new GraphQLRequestError('Empty response payload');
            }
            return payload.data;
        }
        catch (error) {
            if (error instanceof GraphQLHttpError || error instanceof GraphQLRequestError || error instanceof GraphQLResponseError) {
                throw error;
            }
            throw new GraphQLRequestError(`GraphQL request failed: ${this.describeError(error)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async dispose() {
        if (this.agent) {
            await this.agent.close();
        }
    }
    describeError(error) {
        if (error instanceof Error) {
            const segments = [];
            if (error.message) {
                segments.push(error.message);
            }
            const nodeError = error;
            if (typeof nodeError.code === 'string') {
                segments.push(`code=${nodeError.code}`);
            }
            if (typeof nodeError.syscall === 'string') {
                segments.push(`syscall=${nodeError.syscall}`);
            }
            if ('address' in nodeError && typeof nodeError.address === 'string') {
                segments.push(`address=${nodeError.address}`);
            }
            if ('port' in nodeError && typeof nodeError.port === 'number') {
                segments.push(`port=${nodeError.port}`);
            }
            if (nodeError.cause) {
                segments.push(`cause=${this.describeError(nodeError.cause)}`);
            }
            return segments.join(' ');
        }
        return String(error);
    }
}
exports.GraphQLClient = GraphQLClient;
//# sourceMappingURL=graphql-client.js.map