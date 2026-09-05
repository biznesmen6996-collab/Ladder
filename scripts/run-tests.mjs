#!/usr/bin/env node
// Buduje testy przez esbuild (obsługa importów TS bez rozszerzeń) i uruchamia node:test.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'ladder-tests-'))
const files = readdirSync('tests').filter((f) => f.endsWith('.test.ts'))
if (!files.length) { console.log('Brak testów.'); process.exit(0) }

const built = files.map((f) => {
  const dest = join(out, f.replace(/\.ts$/, '.mjs'))
  execFileSync('npx', ['esbuild', join('tests', f), '--bundle', '--platform=node', '--format=esm',
    `--outfile=${dest}`, '--log-level=warning'], { stdio: 'inherit' })
  return dest
})
execFileSync(process.execPath, ['--test', ...built], { stdio: 'inherit' })
