// Roadmap 25: completeness of the German/English texts and locale-aware formatting. Run: npm test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { de } from '../src/i18n/de.ts'
import { en } from '../src/i18n/en.ts'
import { i18n, t, currentLocale, lazyRecord, toLanguage } from '../src/i18n/index.ts'
import { formatDateTime, formatNumber, formatRelative } from '../src/lib/utils.ts'
import { scan } from './i18n-scan.ts'

type Tree = { [k: string]: string | Tree }
function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out.set(prefix + k, v)
    else for (const [k2, v2] of leaves(v, `${prefix}${k}.`)) out.set(k2, v2)
  }
  return out
}
const holes = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}|\[\[(\w+)\]\]/g)].map((m) => m[1] ?? m[2]).sort().join(',')

test('no hard-coded German text outside src/i18n', () => {
  const findings = scan()
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line} ${f.text}`), [])
})

test('German and English have the same keys and placeholders', () => {
  const d = leaves(de as unknown as Tree)
  const e = leaves(en as unknown as Tree)
  assert.ok(d.size > 1000, `only ${d.size} keys`)
  assert.deepEqual([...d.keys()].filter((k) => !e.has(k)), [], 'missing in en.ts')
  assert.deepEqual([...e.keys()].filter((k) => !d.has(k)), [], 'only in en.ts')
  const mismatched = [...d].filter(([k, v]) => holes(v) !== holes(e.get(k)!)).map(([k]) => k)
  assert.deepEqual(mismatched, [], 'placeholders differ')
  const empty = [...e].filter(([, v]) => !v.trim()).map(([k]) => k)
  assert.deepEqual(empty, [], 'empty English texts')
})

test('browser languages map to supported languages, German otherwise', () => {
  assert.equal(toLanguage('en-US'), 'en')
  assert.equal(toLanguage('de-AT'), 'de')
  assert.equal(toLanguage('fr-FR'), null)
})

test('texts, plurals and formats follow the active language', async () => {
  const at = '2026-03-05T12:00:00Z'
  const now = new Date(at).getTime() + 2 * 3600 * 1000
  try {
    await i18n.changeLanguage('de')
    assert.equal(currentLocale(), 'de-DE')
    assert.equal(t('layout.appLayout.approvalsPendingTooltip', { count: 1 }), '1 Freigabe ausstehend')
    assert.equal(t('layout.appLayout.approvalsPendingTooltip', { count: 3 }), '3 Freigaben ausstehend')
    assert.match(formatDateTime(at), /05\.03\.2026/)
    assert.equal(formatNumber(1234567.5), '1.234.567,5')
    assert.equal(formatRelative(at, now), 'vor 2 Stunden')
    assert.equal(formatRelative(at, new Date(at).getTime()), 'gerade eben')

    await i18n.changeLanguage('en')
    assert.equal(currentLocale(), 'en-GB')
    assert.equal(t('layout.appLayout.approvalsPendingTooltip', { count: 1 }), '1 approval pending')
    assert.equal(t('layout.appLayout.approvalsPendingTooltip', { count: 3 }), '3 approvals pending')
    assert.match(formatDateTime(at), /5 Mar 2026/)
    assert.equal(formatNumber(1234567.5), '1,234,567.5')
    assert.equal(formatRelative(at, now), '2 hours ago')
    assert.equal(formatRelative(at, new Date(at).getTime()), 'just now')

    // Label maps read the active language on every access.
    const labels = lazyRecord<Record<string, string>>('layout.appLayout')
    assert.equal(labels.light, 'Light')
    await i18n.changeLanguage('de')
    assert.equal(labels.light, 'Hell')
  } finally {
    await i18n.changeLanguage('de')
  }
})
