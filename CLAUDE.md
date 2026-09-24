# Working agreements

## Commits

- Commit in small, staged steps — one logical change per commit (e.g. schema → repository → API route → dashboard page → docs). Never bundle a whole feature into one large commit.
- Each commit should build, typecheck and pass tests on its own (`pnpm typecheck && pnpm test`).
- Commit messages: short imperative subject; body explains why when it isn't obvious.

## Checks

- `pnpm typecheck`, `pnpm test`, `pnpm build`
- Worker bundle: `pnpm --filter @serverless-analytics/cloudflare check`
- Vercel output: `pnpm build:vercel`
