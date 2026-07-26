# Nupo — Claude Instructions

## Préférences utilisateur
Appeler l'utilisateur "mon chaton".

## Règles principales
**Ne jamais coder sans permission explicite.** Quand une question ou une demande est posée, d'abord réfléchir et discuter (approche, impacts, alternatives). Ne commencer à écrire du code que quand l'utilisateur le dit explicitement.

**Esprit critique et honnêteté.** Ne pas valider une approche juste pour faire plaisir. Si une demande a un problème, un risque, ou qu'il existe une meilleure solution, le dire clairement avant de coder. Proposer des alternatives quand c'est pertinent, même si ça va à l'encontre de la demande initiale.

**Ne faire que ce qui est demandé.** Pas de refactoring, pas d'améliorations non sollicitées, pas de commentaires ajoutés, pas de gestion d'erreurs supplémentaire. Si une tâche semble petite, la faire petite.

## Git
- Never commit automatically
- Never push automatically
- Only commit **or** push when the user explicitly asks

## Responses
- Always end responses with a short summary of what was done

## Code
- All code, UI strings, labels, and comments must be in English

## Validation

- Run `npm run build` (`tsc`) — must complete with zero errors before any change is considered done
- No automated tests; verify behavior manually in the terminal with `npm run dev`

## Stack

- **Language**: TypeScript, compiled to `dist/` via `tsc`
- **UI**: React + [Ink](https://github.com/vadimdemedes/ink) (terminal renderer); `ink-text-input` for text fields
- **Runtime**: Node.js; `child_process.spawn` for Odoo processes; `clipboardy` + OSC 52 fallback for clipboard
- **Source layout**:
  - `src/screens/` — one file per screen, phase-based state machines (`useInput` with `isActive` guards)
  - `src/services/` — config, database, system, updater, git, python, checks, manifest, ide, python
  - `src/data/` — static data (e.g. `changelog.ts`)
  - `src/types/index.ts` — all shared types and helpers
  - `src/components/` — shared UI components (Header, LeftPanel, etc.)
  - `src/hooks/` — custom hooks (useConfig, useTerminalSize)
- **Dev**: `npm run dev` runs `tsx src/index.tsx` directly (no build step)
- **Publish**: bump `version` in `package.json` → commit → `git tag vX.Y.Z` → `git push && git push --tags` → GitHub Actions (`.github/workflows/publish.yml`) runs on `v*` tags and publishes to npm automatically
- **Before publishing**: add a changelog entry in `src/data/changelog.ts` summarizing the new features and fixes for that version. Only include changes to the app itself — ignore `.md` files, config files, and other non-functional changes.
