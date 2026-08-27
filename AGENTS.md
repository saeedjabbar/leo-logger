# Repository Guidelines

## Project Structure & Module Organization

Leo Logger is a TypeScript PWA with a React/Vite client and Express backend.

- `src/`: client entry points, shared types, API helpers, offline support, and React components.
- `mobile/`: Expo/React Native client scaffold for native iOS and Android work.
- `server/`: API routes and domain modules for authentication, events, reminders, analytics, AI, speech, and storage.
- `public/`: PWA manifest, service worker, and app icons.
- `infra/`: Azure provisioning and Alexa configuration scripts.
- `alexa/`: custom skill package and setup documentation.
- Tests are colocated with implementation as `*.test.ts` in `src/` and `server/`.

Keep UI behavior in focused components under `src/components/`. Enforce validation, authorization, and persistence rules on the server.

## Build, Test, and Development Commands

Requires Node.js 22+.

- `npm install`: install dependencies locally; use `npm ci` in clean builds.
- `npm run dev`: run Vite and the watched Express server together; open `http://localhost:5173`.
- `npm run typecheck`: check client and server TypeScript projects.
- `npm run lint`: run ESLint, including React Hooks rules.
- `npm test`: run the Vitest suite once.
- `npm run test:watch`: rerun relevant tests during development.
- `npm run build`: create production client and server output in `dist/`.
- `npm start`: serve an existing production build.

## Coding Style & Naming Conventions

Use TypeScript, two-space indentation, semicolons, and single quotes. Name React components and their files in `PascalCase`; use `camelCase` for functions, variables, and utility files. Prefer small domain modules and direct imports. Do not edit generated `dist/` output.

## Testing Guidelines

Use Vitest and name tests `feature.test.ts`. Cover success, validation, authorization, and timing edge cases relevant to a change. There is no numeric coverage gate; add regression tests for behavioral changes where practical. Run `npm test`, `npm run typecheck`, and `npm run lint` before opening a pull request.

## Commit & Pull Request Guidelines

Recent commits use concise, imperative, lowercase subjects, such as `add live feeding countdown`. Keep each commit focused. Pull requests should explain user-visible behavior, note configuration or migration effects, link related issues, and include mobile screenshots for UI changes. Report the checks run and their results.

## Security & Configuration

Copy `.env.example` to `.env`; never commit credentials, real caregiver exports, or `.data/`. Use synthetic test data. Preserve server-side baby-access checks and managed-identity Azure integrations. Review `SECURITY.md` before changing authentication, secrets, AI providers, imports, or deployment scripts.
