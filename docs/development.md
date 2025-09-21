# Development Guide

## Project Structure

```
ioBroker.unraid-adapter/
├── src/                    # TypeScript source files
│   ├── main.ts            # Main adapter logic
│   ├── apollo-client.ts   # GraphQL client setup
│   └── shared/            # Shared types and definitions
│       └── unraid-domains.ts
├── build/                 # Compiled JavaScript (git-ignored)
├── admin/                 # Admin UI
│   ├── src/              # React TypeScript sources
│   │   ├── app.tsx
│   │   ├── index.tsx
│   │   └── components/
│   │       └── settings.tsx
│   └── build/            # Bundled admin UI
├── test/                  # Test files
│   ├── integration.js
│   ├── package.js
│   └── mocha.setup.js
├── docs/                  # Documentation
└── lib/                   # Type definitions

```

## Development Commands

### Building
```bash
npm run build           # Full build (TypeScript + Admin UI)
npm run build:ts        # Build TypeScript only
npm run build:react     # Build Admin UI only
npm run watch           # Watch mode for development
npm run watch:ts        # Watch TypeScript files
npm run watch:react     # Watch React admin files
```

### Testing & Quality
```bash
npm test                # Run all tests
npm run test:js         # Run unit tests
npm run test:package    # Validate package files
npm run test:integration # Run integration tests
npm run lint            # Check code style
npm run lint -- --fix   # Auto-fix lint issues
npm run check           # TypeScript type checking
```

### Development Server
```bash
dev-server watch        # Start dev server on http://localhost:8081
```

## Coding Standards

### TypeScript
- Use TypeScript for all new code (`.ts` for logic, `.tsx` for React)
- Strict mode enabled - no `any` types without justification
- Prefer interfaces over types for object shapes
- Use const assertions for literal types

### Code Style
- 4 spaces indentation (enforced by ESLint)
- Single quotes for strings
- No semicolons (except where required)
- Max line length: 120 characters
- File naming: kebab-case for files, PascalCase for components

### Naming Conventions
```typescript
// Files
graphql-client.ts       // kebab-case
unraid-domains.ts

// Classes/Interfaces
class GraphQLClient     // PascalCase
interface DomainNode

// Functions/Variables
const pollInterval      // camelCase
function buildQuery()

// Constants
const DEFAULT_TIMEOUT   // UPPER_SNAKE_CASE

// ioBroker States
'metrics.cpu.percentTotal'     // dot notation
'server.status'
```

## Testing Guidelines

### Unit Tests
- Place in `*.test.ts` files alongside source
- Use descriptive test names
- Mock external dependencies
- Test edge cases and error conditions

```typescript
describe('GraphQLClient', () => {
    it('should handle connection errors gracefully', () => {
        // test implementation
    })
})
```

### Integration Tests
- Located in `test/integration.js`
- Test adapter lifecycle
- Verify state creation
- Check configuration handling

### Running Tests
```bash
npm test                    # All tests
npm run test:js -- --grep "CPU"  # Specific tests
```

## Git Workflow

### Branch Strategy
```bash
master              # Stable releases
feature/*           # New features
fix/*              # Bug fixes
docs/*             # Documentation updates
```

### Commit Messages
Use conventional commits format:
```
feat: add Docker container monitoring
fix: handle null temperature values
docs: update API documentation
chore: update dependencies
test: add CPU metrics tests
```

### Pull Request Process
1. Create feature branch from master
2. Make changes with clear commits
3. Run tests and linting
4. Update documentation if needed
5. Create PR with description
6. Link related issues

## Configuration Management

### Adapter Configuration
Configuration fields defined in `io-package.json`:
- `baseUrl` - Unraid server URL
- `apiToken` - API authentication token
- `pollIntervalSeconds` - Update frequency
- `allowSelfSigned` - Certificate validation
- `enabledDomains` - Selected data domains

### Secrets Handling
- Never commit API tokens or passwords
- Use environment variables for local testing
- Encrypt sensitive fields in io-package.json:
```json
"apiToken": {
    "type": "string",
    "encrypted": true
}
```

## Adding New Features

### Adding a New Domain

1. **Define in `unraid-domains.ts`:**
```typescript
// Add to DomainNode tree
{
    id: 'docker.containers',
    label: 'Docker Containers',
    defaultSelected: false
}

// Add DomainDefinition
{
    id: 'docker.containers',
    selection: [/* GraphQL fields */],
    states: [/* State mappings */]
}
```

2. **Update GraphQL Query:**
- Add selection builder logic
- Handle response mapping

3. **Create States:**
- Define object structure
- Add transformation functions

4. **Update Admin UI:**
- Domain appears automatically in tree

### Adding New Metrics

1. Check Unraid GraphQL schema for available fields
2. Add to appropriate domain definition
3. Define state mapping with proper role and unit
4. Add transformation if needed (e.g., bytes to GB)

## Debugging

### Enable Debug Logging
```javascript
this.log.debug('Detailed message');
this.log.silly('Very detailed message');
```

Set log level in ioBroker admin or:
```bash
iobroker set unraid.0 --loglevel debug
```

### Common Issues

**Connection Refused**
- Check baseUrl format (include https://)
- Verify API token is valid
- Check firewall settings

**GraphQL Errors**
- Enable debug logging to see full query
- Test query in Unraid GraphQL playground
- Check for schema changes in Unraid version

**State Not Updating**
- Verify domain is enabled
- Check polling interval
- Look for transformation errors

## Performance Optimization

### Efficient Polling
- Batch related metrics in single query
- Use appropriate polling intervals
- Cache static data

### State Updates
- Only update changed values
- Use bulk operations where possible
- Clean up unused objects

### Memory Management
- Reuse client instances
- Clear timers on shutdown
- Limit response data size

## Release Process

### Version Bumping
```bash
npm version patch  # 0.1.0 -> 0.1.1
npm version minor  # 0.1.0 -> 0.2.0
npm version major  # 0.1.0 -> 1.0.0
```

### Creating Release
```bash
npm run release
```

### Publishing
1. Push tags to GitHub
2. Create GitHub release
3. Publish to npm (if applicable)
4. Update ioBroker repository

## Resources

### Documentation
- [ioBroker Adapter Development](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterdev.md)
- [GraphQL Specification](https://spec.graphql.org/)
- [Apollo Client Docs](https://www.apollographql.com/docs/react/)

### Tools
- [GraphQL Playground](https://github.com/graphql/graphql-playground)
- [ioBroker CLI](https://github.com/ioBroker/ioBroker.cli)
- [TypeScript Playground](https://www.typescriptlang.org/play)

### Support
- GitHub Issues: Report bugs and request features
- ioBroker Forum: Community support
- Unraid Forum: Unraid-specific questions