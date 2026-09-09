# labelslot

Read `docs/SPEC.md` first. It is the contract; its "Non-negotiable" section overrides anything else, including minimalism rules.

## Stack

TypeScript run directly by Node 24+ (type stripping: no enums, namespaces or parameter properties; imports use explicit `.ts` extensions). `@cantoo/pdf-lib` for output, `pdfjs-dist` for rendering, `@napi-rs/canvas` for a Node canvas. No other dependencies; do not add any.

## Commands

- `npm test` — `node --test` over `test/**/*.test.ts`
- `npm run lint` — `tsc --noEmit`
- `npm run build:web` — esbuild bundle for the web UI (Release 2)

## Working in a slice

- Implement only the files your task names. Interfaces are in the stubs; keep the signatures.
- Do not touch `package.json` dependencies, `test/fixtures.ts` or `CHANGELOG.md` unless the task says so.
- All geometry in mm, top-left origin, y down. Points and bottom-left origin only in `geometry.pdfTranslation`.
- `src/cli.ts` is the only module that may import `node:*`. Everything else must run in a browser.
- Run `npm run lint && npm test` before you finish. Commit on your worktree branch with a clear message.
- Your final report must state: the branch name, files changed, the pasted test output, and any open question or signature you had to change.
