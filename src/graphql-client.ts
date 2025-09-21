import { Agent } from 'undici';

export interface GraphQLClientOptions {
    baseUrl: string;
    token: string;
    timeoutMs?: number;
    allowSelfSigned?: boolean;
}

export type GraphQLErrorPayload = {
    message?: string;
    locations?: Array<{ line?: number; column?: number }>;
    extensions?: {
        code?: string;
        [key: string]: unknown;
    };
};

export class GraphQLHttpError extends Error {
    public readonly status: number;
    public readonly body: string;
    public readonly json?: { errors?: GraphQLErrorPayload[]; [key: string]: unknown };

    public constructor(status: number, body: string, json?: { errors?: GraphQLErrorPayload[]; [key: string]: unknown }) {
        const suffix = body ? `: ${body}` : '';
        super(`HTTP ${status}${suffix}`);
        this.name = 'GraphQLHttpError';
        this.status = status;
        this.body = body;
        this.json = json;
    }
}

export class GraphQLRequestError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'GraphQLRequestError';
    }
}

export class GraphQLResponseError extends Error {
    public readonly errors: GraphQLErrorPayload[];

    public constructor(errors: GraphQLErrorPayload[]) {
        super(errors.map((error) => error.message).filter(Boolean).join('; ') || 'GraphQL response contained errors');
        this.name = 'GraphQLResponseError';
        this.errors = errors;
    }
}

interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}

export class GraphQLClient {
    private readonly endpoint: string;
    private readonly token: string;
    private readonly timeoutMs: number;
    private readonly agent?: Agent;

    public constructor({ baseUrl, token, timeoutMs, allowSelfSigned }: GraphQLClientOptions) {
        const trimmedBaseUrl = baseUrl.replace(/\/$/, '');
        this.endpoint = `${trimmedBaseUrl}/graphql`;
        this.token = token;
        this.timeoutMs = timeoutMs ?? 15000;

        if (allowSelfSigned && this.endpoint.startsWith('https://')) {
            // Accept self-signed certs by disabling TLS validation for this client only
            this.agent = new Agent({
                connect: {
                    rejectUnauthorized: false,
                },
            });
        }
    }

    public async query<T>(query: string): Promise<T> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            };

            if (this.token) {
                headers['x-api-key'] = this.token;
            }

            const requestInit: RequestInit = {
                method: 'POST',
                headers,
                body: JSON.stringify({ query }),
                signal: controller.signal,
            };

            if (this.agent) {
                (requestInit as unknown as { dispatcher: unknown }).dispatcher = this.agent;
            }

            const response = await fetch(this.endpoint, requestInit);

            if (!response.ok) {
                let bodyText = '';
                try {
                    bodyText = await response.text();
                } catch (readError) {
                    const message = readError instanceof Error ? readError.message : String(readError);
                    throw new GraphQLHttpError(response.status, message || '');
                }

                let json: { errors?: GraphQLErrorPayload[]; [key: string]: unknown } | undefined;
                try {
                    json = bodyText ? (JSON.parse(bodyText) as typeof json) : undefined;
                } catch {
                    // ignore parse error, keep original body text
                }

                throw new GraphQLHttpError(response.status, bodyText.trim(), json);
            }

            const payload = (await response.json()) as GraphQLResponse<T>;

            if (payload.errors?.length) {
                throw new GraphQLResponseError(payload.errors);
            }

            if (!payload.data) {
                throw new GraphQLRequestError('Empty response payload');
            }

            return payload.data;
        } catch (error) {
            if (error instanceof GraphQLHttpError || error instanceof GraphQLRequestError || error instanceof GraphQLResponseError) {
                throw error;
            }
            throw new GraphQLRequestError(`GraphQL request failed: ${this.describeError(error)}`);
        } finally {
            clearTimeout(timeout);
        }
    }

    public async dispose(): Promise<void> {
        if (this.agent) {
            await this.agent.close();
        }
    }

    private describeError(error: unknown): string {
        if (error instanceof Error) {
            const segments: string[] = [];
            if (error.message) {
                segments.push(error.message);
            }

            const nodeError = error as NodeJS.ErrnoException & { cause?: unknown };
            if (typeof nodeError.code === 'string') {
                segments.push(`code=${nodeError.code}`);
            }
            if (typeof nodeError.syscall === 'string') {
                segments.push(`syscall=${nodeError.syscall}`);
            }
            if ('address' in nodeError && typeof (nodeError as { address: unknown }).address === 'string') {
                segments.push(`address=${(nodeError as { address: string }).address}`);
            }
            if ('port' in nodeError && typeof (nodeError as { port: unknown }).port === 'number') {
                segments.push(`port=${(nodeError as { port: number }).port}`);
            }
            if (nodeError.cause) {
                segments.push(`cause=${this.describeError(nodeError.cause)}`);
            }

            return segments.join(' ');
        }

        return String(error);
    }
}
