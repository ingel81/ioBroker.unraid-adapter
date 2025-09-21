# CLAUDE.md

Claude Code guidance for the ioBroker Unraid adapter repository.

## Quick Reference

### Key Commands
```bash
npm run build          # Build everything
npm run check          # TypeScript checking
npm run lint           # Code style check
npm test               # Run all tests
dev-server watch       # Dev server on :8081
```

### Project Structure
- `src/` - TypeScript sources (main.ts, apollo-client.ts)
- `admin/src/` - React admin UI
- `docs/` - Technical documentation
  - `architecture.md` - System design & components
  - `unraid-api.md` - GraphQL API reference
  - `development.md` - Development guide

### Recent Changes (2025-09-21)
- Migrated to Apollo Client for all GraphQL operations
- Dynamic CPU core detection implemented
- Extended memory metrics (swap, available, buffcache)
- Subscriptions disabled due to Unraid API issues

## Important Notes

- **Documentation**: Use `docs/` folder or this file, never modify README.md (it's public)
- **Apollo Client**: All GraphQL operations use Apollo (src/apollo-client.ts)
- **Polling Mode**: Subscriptions disabled, using polling with configurable intervals
- **Dynamic States**: CPU cores detected and created at runtime

## Claude-Specific Instructions

### When Adding Features
1. Check existing patterns in codebase
2. Update domain definitions in `unraid-domains.ts`
3. Test with `npm run check` and `npm run lint`
4. Document in `docs/` if significant

### When Fixing Issues
1. Enable debug logging to understand the problem
2. Test fix locally with dev-server
3. Update tests if applicable
4. Keep changes focused and minimal

### Important Reminders
- Don't create unnecessary files - prefer editing existing ones
- Don't auto-commit without user request ("bitte nichts einchecken ungefragt")
- Don't add emojis unless explicitly requested
- Always check if libraries exist before using them