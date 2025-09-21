# Repository Guidelines

## Project Structure & Module Organization
- Runtime sources live in `src/` (e.g., `src/main.ts`). Compiled output is written to `build/` via `tsconfig.build.json` and should not be committed.
- Admin UI code resides under `admin/src/` with React/TypeScript components (`app.tsx`, `components/settings.tsx`). The build artefacts are generated into `admin/build/`.
- Shared typings are in `lib/`, documentation in `docs/`, and tests in the repo root (`main.test.ts`) plus the `test/` directory for integration/package checks.

## Build, Test, and Development Commands
- `npm run build:ts` — transpiles the adapter TypeScript sources into `build/`.
- `npm run build` — full build: cleans admin artefacts, runs `build:ts`, and bundles the admin UI.
- `npm run lint` — runs ESLint across `.js/.ts/.tsx` files using the configured TypeScript-aware rules.
- `npm run check` — project-wide type checking with `tsc --noEmit` (includes admin sources).
- `npm test` — executes unit tests (`mocha` + `ts-node`) and package sanity checks.

## Coding Style & Naming Conventions
- TypeScript is the default; use `.ts` for adapter code and `.tsx` for admin React components. Avoid plain `.js` for new logic.
- Follow ESLint’s 4-space indentation, single quotes, and `@typescript-eslint` rules. Run `npm run lint -- --fix` before pushing.
- Name ioBroker states and objects with clear namespaces (e.g., `array.state`, `docker.containers.<name>` as per `docs/unraid-graphql.md`).

## Testing Guidelines
- Unit tests belong in `*.test.ts` files alongside sources or in `test/`. Prefer descriptive `describe/it` names (e.g., `describe('docker polling')`).
- Integration/package tests are already wired in `test/`; extend them when adding new adapter capabilities. Ensure `npm test` passes before raising a PR.

## Commit & Pull Request Guidelines
- Commit messages follow an imperative style (`migrate project to TypeScript`, `add polling scheduler`). Scope one logical change per commit.
- Pull requests should summarize the change set, link related issues, list test commands run, and include UI screenshots when admin pages change.

## Configuration & Secrets
- Adapter credentials (`baseUrl`, `apiToken`) are configured via the admin UI and must never be hard-coded. Use ioBroker’s encrypted fields if sensitive data is stored.
