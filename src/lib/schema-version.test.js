import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { expect, test } from 'vitest'

/**
 * The deploy workflow refuses to publish unless the hosted database reports the newest migration's
 * timestamp from app_schema_version(). A migration that forgets to bump it would block every deploy.
 */
test('app_schema_version() reports the newest migration', () => {
  // Tests run from the project root; jsdom gives import.meta.url an http scheme.
  const dir = join(cwd(), 'supabase', 'migrations')
  const migrations = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const newest = migrations.at(-1).split('_')[0]
  const definitions = migrations
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .flatMap((sql) => [...sql.matchAll(/app_schema_version\(\)[\s\S]*?select '(\d{14})'::text/g)])
  expect(definitions.at(-1)?.[1]).toBe(newest)
})
