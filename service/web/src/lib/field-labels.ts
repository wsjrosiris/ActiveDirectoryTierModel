import { lazyRecord } from '../i18n/index.ts'
/* German labels for configuration keys – shared by the structured object form, the change list
 * (save dialog / versions) and the change log. Unknown keys are humanized from camelCase. */

export const fieldLabels: Record<string, string> = lazyRecord('lib.fieldLabels')

/** "protectFromAccidentalDeletion" → "Protect from accidental deletion" (fallback for unknown field names).
 *  Map keys that are data (e.g. "msDS-ManagedServiceAccount", "ActiveDirectory", file names) stay as they are. */
export function humanizeKey(key: string): string {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(key) && !/^[a-z]+(_[a-z0-9]+)+$/.test(key)) return key
  const words = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : /^[A-Z]{2,}/.test(w) ? w : w.toLowerCase())).join(' ')
}

export function fieldLabel(key: string): string {
  return fieldLabels[key] ?? humanizeKey(key)
}
