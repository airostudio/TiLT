import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runAll } from './harness.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const filter = process.argv[2]
for (const f of readdirSync(here).filter((f) => f.endsWith('.spec.mjs')).sort()) {
  await import(pathToFileURL(path.join(here, f)).href)
}
const failed = await runAll(filter)
console.log(failed ? `\n${failed} e2e test(s) FAILED` : '\nall e2e tests passed')
process.exit(failed ? 1 : 0)
