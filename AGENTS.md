# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

`fanqie-novel-studio`（长篇创作工作台）is a local-first Windows desktop workbench for long-form web novel writing on 番茄小说 (Fanqie). It covers market research → sample deconstruction → original project setup → rolling 300万字 planning → chapter/batch writing → state ledger → quality check → publishing schedule → data review. Each novel gets its own SQLite database and search index.

## Stack

- Electron 43 + React 19 + TypeScript 5.9 (strict) + Vite 7 + tsup
- SQLite via `node:sqlite` (WAL), Zod 4 validation
- Tests: Vitest (unit/integration/quality-benchmark/scale), Playwright (e2e + Electron smoke)

## Repo layout

- `src/shared/` — pure domain logic (no electron imports). Zero reverse dependencies: rules here must stay framework-agnostic and deterministic.
- `src/pages/`, `src/lib/`, `src/components/` — renderer UI.
- `electron/` — main process: `handlers/` (IPC), `repositories/` (data access), `ai-service.ts`, `worker.ts` (document parsing / quality rules / health checks).
- `tests/` — all test files.

## Critical rules

1. **Human-in-the-loop gates are sacred.** AI only produces candidates/drafts; finalizing, outline changes, and publishing are always human-confirmed. Do not weaken these gates (`src/shared/chapter-lifecycle.ts`, `contract-service.ts`, `change-request-service.ts`).
2. **Local-first privacy.** API keys go to Windows Credential Manager only. Semantic deconstruction uploads only desensitized fragments. Research data and creation data are physically isolated. Do not upload full text or ledgers.
3. **Security boundary.** All outbound HTTP goes through `electron/netguard.ts` (`fetchPublicHttpResponse`; local model endpoints use the explicit `fetchLocalEndpointResponse` exemption). URL/IP validation and manual redirect handling stay there; the optional outbound proxy only swaps the dispatcher inside netguard and never relaxes destination validation. Never add a raw `fetch` for remote URLs.
4. **Shared code must stay pure.** `src/shared/` must never import from `electron/` or React. Deterministic rules are reused by both renderer and main process.
5. **State transitions are transactional.** Multi-statement writes wrap in `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`. Approved content edits require an approved change request first.
6. **Prompt/quality changes need evidence.** Before touching quality prompts, add a reproducible benchmark case (`src/shared/quality-benchmark-corpus.ts`) and compare against baseline (`npm run test:quality`).
7. **Prompts guide, they do not gate.** Generation prompts are briefs, not checklists. Keep prohibitions rare and always paired with a positive alternative. Genre knowledge is retrieved **on demand only** (`compileChapterGuidance` + `guidance-retrieval.ts`): nothing is injected unless a signal fires — repeated mechanism fatigue, a key/climax/reveal chapter, or no approved stage/volume structure at all — and the full reference (`compileCommercialGuidance`) is reserved for planning/concept/review tasks and the explicit 严谨 mode. Statistics (length, temperature, density) are observations, never issues. Hard gates stay limited to contract rules, fact conflicts, knowledge boundaries, originality, and privacy. See `PROMPT_GUIDANCE_OPTIMIZATION_PLAN.md`.

## Commands

- `npm test` — unit + integration
- `npm run test:quality` — prompt structure + novel-quality fixed benchmark
- `npm run test:scale` — capacity (10 books × 1500 chapters × 3M chars)
- `npm run test:e2e` / `npm run test:electron` — Playwright UI / packaged-app smoke
- `npm run build` — typecheck + vite + tsup
- `npm run dist:win` — Windows NSIS installer

## Commit conventions

- Conventional Commits (feat/fix/refactor/test/docs/chore).
- Never mix security fixes, algorithm changes, and pure code moves in one commit.
- Before pushing, run at least `npm run build` and `npm test`.
