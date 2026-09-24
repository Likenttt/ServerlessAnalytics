// Emits Vercel's Build Output API (v3) into .vercel/output:
//   static/              the dashboard (apps/dashboard/dist)
//   functions/api.func/  one bundled Node.js function for /api/* and /v1/*
//   config.json          routing, SPA fallback, cache headers and the retention cron
import { build } from 'esbuild'
import { cp, mkdir, rm, writeFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const out = here('./.vercel/output')
const dashboard = here('../dashboard/dist')
const fn = `${out}/functions/api.func`

await access(`${dashboard}/index.html`).catch(() => {
  throw new Error('Dashboard not built. Run `pnpm build:vercel` from the repository root.')
})

await rm(out, { recursive: true, force: true })
await mkdir(fn, { recursive: true })

await build({
  entryPoints: [here('./src/api.ts')],
  outfile: `${fn}/index.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // pg optionally requires the native addon; it's never used.
  external: ['pg-native'],
  minify: true,
  sourcemap: true,
  legalComments: 'none',
})
await writeFile(`${fn}/package.json`, JSON.stringify({ type: 'commonjs' }))
await writeFile(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    { runtime: 'nodejs22.x', handler: 'index.js', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 60 },
    null,
    2,
  ),
)

await cp(dashboard, `${out}/static`, { recursive: true })

await writeFile(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/(?:api|v1)(?:/.*)?$', dest: '/api' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
      crons: [{ path: '/api/cron/retention', schedule: '17 3 * * *' }],
    },
    null,
    2,
  ),
)

console.log(`Build output written to ${out}`)
