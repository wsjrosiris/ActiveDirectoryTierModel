// Finds hard-coded German UI text in web/src outside src/i18n (used by i18n.test.ts and runnable directly:
// `node tests/i18n-scan.ts` lists the findings). Heuristic: umlauts/ß or common German words inside string
// literals, template literals or JSX text; comments are ignored. Proper names and data values are allow-listed.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname

/** Words that only occur in German UI text (checked as whole words, case-sensitive where capitalised). */
const GERMAN_WORDS = [
  'und', 'oder', 'der', 'die', 'das', 'nicht', 'mit', 'für', 'wird', 'werden', 'ist', 'sind', 'kein', 'keine', 'eine', 'einen',
  'auf', 'aus', 'bei', 'nach', 'noch', 'nur', 'von', 'vom', 'zum', 'zur', 'Sie', 'Ihre', 'Ihr', 'bitte', 'Bitte', 'wurde', 'wurden',
  'Speichern', 'Abbrechen', 'Löschen', 'Schließen', 'Bearbeiten', 'Hinzufügen', 'Entfernen', 'Zurück', 'Weiter', 'Anlegen',
  'Suchen', 'Gruppe', 'Gruppen', 'Benutzer', 'Einstellungen', 'Konfiguration', 'Freigabe', 'Planung', 'Lauf', 'Läufe',
  'Fehler', 'Warnung', 'Hinweis', 'Ja', 'Nein', 'Neu', 'Neue', 'Neuer', 'Alle', 'Anwenden', 'Wartungsfenster', 'Zeitplan',
  'Bericht', 'Berichte', 'Domäne', 'Änderungen', 'Aktiv', 'Lädt', 'Berechtigung', 'Richtlinie', 'Vorlage', 'anlegen', 'ändern',
]
/** Allowed text that looks German but is a proper name, AD data or a technical token. */
const ALLOW = [
  /Domänen-Admins/, /Organisations-Admins/, /Schema-Admins/, /Administratoren/, /Jeder/, /Authentifizierte Benutzer/, /Domänen-Benutzer/,
  /Deutsch/, // language name in the language menu
  /de-DE/, /[äöüÄÖÜß]\]/, // character classes in regexes
  /Uebergabe|Übergabe/, // transliteration tests in wizard-model (compactName)
]
const GERMAN_CHARS = /[äöüÄÖÜß„“]/
const WORD_RE = new RegExp(`(^|[^\\p{L}])(${GERMAN_WORDS.join('|')})(?=$|[^\\p{L}])`, 'u')

export interface Finding {
  file: string
  line: number
  text: string
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === 'i18n' && dir === SRC.replace(/\/$/, '') ? [] : walk(p)
    return /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts') ? [p] : []
  })
}

/** Blanks comments (keeps line numbers), leaves strings intact. */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (quote) {
      out += c
      if (c === '\\') { out += n ?? ''; i += 2; continue }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2)
      const chunk = src.slice(i, end < 0 ? src.length : end + 2)
      out += chunk.replace(/[^\n]/g, ' ')
      i += chunk.length
      continue
    }
    if (c === '/' && n === '/' && !/[:"'`]$/.test(out.slice(-1))) {
      const end = src.indexOf('\n', i)
      i = end < 0 ? src.length : end
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    out += c
    i++
  }
  return out
}

/** Text a user could see: string/template literal contents and JSX text between tags. */
function visibleChunks(line: string): string[] {
  const chunks: string[] = []
  for (const m of line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) chunks.push(m[1] ?? m[2] ?? m[3] ?? '')
  for (const m of line.matchAll(/>([^<>{}]*[\p{L}][^<>{}]*)</gu)) chunks.push(m[1])
  // JSX text on its own line (no quotes, no code punctuation)
  const trimmed = line.trim()
  if (trimmed && !/[;=(){}'"`]|^(import|export|const|let|return|if|case|type|interface|function)\b|^[<>/.|&?:]/.test(trimmed)) chunks.push(trimmed)
  return chunks
}

export function scan(): Finding[] {
  const findings: Finding[] = []
  for (const file of walk(SRC.replace(/\/$/, ''))) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      for (const chunk of visibleChunks(line)) {
        // Code values rather than text: single lowercase tokens ('ist', 'soll-ist', entity articles) and URL paths.
        if (/^[a-z]+(-[a-z]+)*$/.test(chunk.trim()) || /^\/[\w/?=&-]*$/.test(chunk.trim())) continue
        let text = chunk.replace(/\$\{[^}]*\}/g, ' ')
        for (const a of ALLOW) text = text.replace(new RegExp(a.source, 'g'), ' ')
        if (GERMAN_CHARS.test(text) || WORD_RE.test(text)) {
          findings.push({ file: relative(SRC, file), line: i + 1, text: chunk.trim().slice(0, 120) })
          break
        }
      }
    })
  }
  return findings
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = scan()
  for (const x of f) console.log(`${x.file}:${x.line}\t${x.text}`)
  console.log(`${f.length} finding(s)`)
}
