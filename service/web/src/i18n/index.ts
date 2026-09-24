// i18n setup (i18next). German is the default and fallback language; English is complete.
// Texts live in de.ts / en.ts (nested per feature); de.ts is the source of truth for the key types.
// `t` is a plain function so it also works outside React (labels, plan sentences, wizard texts); the
// app remounts its tree when the language changes (see app.tsx), so render-time calls pick up the new language.
import i18next from 'i18next'
import { de } from './de.ts'
import { en } from './en.ts'

export type Language = 'de' | 'en'
export const LANGUAGES: Language[] = ['de', 'en']
export const DEFAULT_LANGUAGE: Language = 'de'

export const i18n = i18next.createInstance()
void i18n.init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES,
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
})

export const t = i18n.t.bind(i18n) as typeof i18n.t

export function currentLanguage(): Language {
  return i18n.language === 'en' ? 'en' : 'de'
}

/** Intl locale for dates and numbers: de-DE, or en-GB for English (24-hour clock, day-month-year). */
export function currentLocale(): string {
  return currentLanguage() === 'en' ? 'en-GB' : 'de-DE'
}

/** Normalizes "en-US", "de-AT", … to a supported language (null if none). */
export function toLanguage(v: string | null | undefined): Language | null {
  const l = (v ?? '').toLowerCase().slice(0, 2)
  return l === 'en' ? 'en' : l === 'de' ? 'de' : null
}

/**
 * A read-only record whose values come from the active language on every access – for label maps
 * (`statusLabels[status]`, `Object.entries(areaLabels)`) that are defined once at module level.
 */
export function lazyRecord<T extends Record<string, string>>(key: string): T {
  const src = () =>
    (i18n.getResource(currentLanguage(), 'translation', key) ?? i18n.getResource(DEFAULT_LANGUAGE, 'translation', key) ?? {}) as Record<string, string>
  return new Proxy({} as T, {
    get: (_, p) => (typeof p === 'string' ? src()[p] : undefined),
    has: (_, p) => typeof p === 'string' && p in src(),
    ownKeys: () => Reflect.ownKeys(src()),
    getOwnPropertyDescriptor: (_, p) =>
      typeof p === 'string' && p in src() ? { value: src()[p], enumerable: true, configurable: true, writable: false } : undefined,
  })
}
