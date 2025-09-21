# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Recent Updates (2025-09-21)

### Apollo Client Integration
- Migrated from custom GraphQL client to Apollo Client
- All GraphQL operations now use unified Apollo Client
- WebSocket subscriptions disabled due to Unraid API issues (arraySubscription bug)
- Using polling-only approach for reliability

### Extended Metrics
- **Dynamic CPU Core Detection**: Automatically detects and creates states for all CPU cores
- **Extended Memory Metrics**: Added available, active, buffcache, and swap metrics
- See `docs/technical-notes.md` for implementation details

## Commands

### Development
- `npm run build` - Compile TypeScript sources and React admin UI
- `npm run build:ts` - Compile TypeScript sources only
- `npm run watch` - Watch and compile React sources on changes
- `npm run watch:ts` - Watch and compile TypeScript sources on changes

### Testing
- `npm test` - Run all tests (unit tests and package validation)
- `npm run test:js` - Run unit tests for JavaScript/TypeScript files
- `npm run test:package` - Validate package.json and io-package.json
- `npm run test:integration` - Run integration tests

### Code Quality
- `npm run check` - Type-check TypeScript without compiling
- `npm run lint` - Check code formatting with ESLint

### Admin UI
- `npm run build:react` - Build React admin interface
- `npm run watch:react` - Watch and rebuild React admin interface

### Utilities
- `npm run translate` - Manage adapter translations
- `npm run release` - Create a new release
- `dev-server watch` - Run development server with ioBroker admin at http://localhost:8081/

## Architecture

This is an ioBroker adapter for Unraid servers that fetches system metrics via GraphQL API.

### Core Components

**Main Adapter (`src/main.ts`)**
- Extends ioBroker Adapter base class
- Manages GraphQL polling of Unraid server
- Handles state updates and object lifecycle
- Key features:
  - Configurable polling interval
  - Dynamic domain selection
  - Automatic object tree cleanup
  - Self-signed certificate support

**GraphQL Client (`src/graphql-client.ts`)**
- Handles HTTP communication with Unraid API
- Manages authentication via API token
- Supports self-signed certificates

**Domain System (`src/shared/unraid-domains.ts`)**
- Defines available metrics domains (info, server, metrics)
- Maps GraphQL responses to ioBroker states
- Provides hierarchical domain structure with:
  - `info.time` - System time information
  - `info.os` - Operating system details
  - `server.status` - Server status
  - `metrics.cpu` - CPU usage metrics
  - `metrics.memory` - Memory usage (converts to GB)

### Admin Interface
- React-based configuration UI in `admin/src/`
- Component-based architecture with Material-UI
- Main components:
  - `app.tsx` - Main application entry
  - `components/settings.tsx` - Settings configuration

### TypeScript Migration
The project is actively being migrated to TypeScript (branch: `ts-migration`). TypeScript configuration uses separate configs for building (`tsconfig.build.json`) and type checking (`tsconfig.check.json`).

## Key Patterns

- **State Management**: All states are created with proper hierarchical channels before writing values
- **GraphQL Query Building**: Dynamic query construction based on selected domains using `GraphQLSelectionBuilder`
- **Error Handling**: Comprehensive error handling for GraphQL operations with specific error types
- **Object Lifecycle**: Automatic cleanup of removed domains and proper object tree maintenance
- nicht in die readme.md schreiben...die ist public verwenden die claude.md oder den docs ordner