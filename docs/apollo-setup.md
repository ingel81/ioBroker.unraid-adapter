# 📘 Apollo Client Setup mit Self-Signed TLS (Node.js / ioBroker / Unraid)

## Dependencies
```bash
npm i @apollo/client graphql graphql-ws ws
# undici ist bereits im Projekt
```

## TLS mit `undici`
```ts
import { setGlobalDispatcher, Agent } from 'undici';
import fs from 'node:fs';

const ca = fs.readFileSync('/opt/certs/unraid-ca.pem', 'utf8');

setGlobalDispatcher(new Agent({
  connect: { tls: { ca, rejectUnauthorized: true } }
}));
```
➡️ Alle `fetch`-Calls (inkl. Apollo `HttpLink`) vertrauen jetzt der Unraid-CA.

## WebSocket (Subscriptions)
```ts
import WebSocket from 'ws';
import { createClient } from 'graphql-ws';

const ca = fs.readFileSync('/opt/certs/unraid-ca.pem', 'utf8');

const wsClient = createClient({
  url: 'wss://unraid.local/graphql',
  webSocketImpl: (url, protocols) =>
    new WebSocket(url, protocols, { ca, rejectUnauthorized: true }),
  connectionParams: { Authorization: `Bearer ${process.env.UNRAID_TOKEN}` },
});
```

## Apollo Client (HTTP + WS Split)
```ts
import { ApolloClient, InMemoryCache, split, HttpLink, gql } from '@apollo/client/core';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';

const httpLink = new HttpLink({
  uri: 'https://unraid.local/graphql',
  headers: { Authorization: `Bearer ${process.env.UNRAID_TOKEN}` },
});

const wsLink = new GraphQLWsLink(wsClient);

const link = split(
  ({ query }) => {
    const def = getMainDefinition(query);
    return def.kind === 'OperationDefinition' && def.operation === 'subscription';
  },
  wsLink,
  httpLink
);

export const apollo = new ApolloClient({
  link,
  cache: new InMemoryCache(),
});

// Beispiel-Operationen
export const SUB = gql`subscription { newMessage { id text ts } }`;
export const MUT = gql`mutation($text:String!){ createMessage(text:$text){ id text ts } }`;
```

## Usage
```ts
// Subscription
apollo.subscribe({ query: SUB }).subscribe({
  next: (ev) => console.log(ev.data),
  error: console.error,
});

// Mutation
const res = await apollo.mutate({
  mutation: MUT,
  variables: { text: 'Hallo von ioBroker!' },
});
console.log(res.data);
```

---

👉 Damit kann Codex sofort:
- Queries/Mutations (über Apollo HttpLink + `undici`-CA)
- Subscriptions (über `graphql-ws` + `ws` mit CA)
- Einheitliches Auth via `Authorization: Bearer …`
