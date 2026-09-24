// Ship the SDK's <script> bundle with the dashboard so every deployment serves
// it at /sdk/analytics.global.js.
import { execSync } from 'node:child_process'
import { copyFile, mkdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const sdk = fileURLToPath(new URL('../../../packages/sdk/', import.meta.url))
const bundle = `${sdk}dist/analytics.global.js`
await access(bundle).catch(() => execSync('pnpm run build', { cwd: sdk, stdio: 'inherit' }))
const out = fileURLToPath(new URL('../dist/sdk/', import.meta.url))
await mkdir(out, { recursive: true })
await copyFile(bundle, `${out}analytics.global.js`)
console.log('Copied SDK bundle to dist/sdk/analytics.global.js')
