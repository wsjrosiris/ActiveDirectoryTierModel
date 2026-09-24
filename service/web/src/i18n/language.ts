// Language preference of the signed-in user (roadmap 25): stored server-side per user (null = browser default),
// mirrored in localStorage so the next page load (and the login page) starts in the right language.
import { currentLanguage, resolveLanguage, storePreference, storedPreference, type Language, type LanguagePreference } from './index.ts'

/** Server value (null = browser default) → preference. */
export const preferenceOf = (language: Language | null | undefined): LanguagePreference => language ?? 'auto'

/**
 * Remembers the preference and reloads the page if it changes the active language.
 * Returns true when a reload was started.
 */
export function applyPreference(pref: LanguagePreference): boolean {
  if (storedPreference() !== pref) storePreference(pref)
  if (resolveLanguage(pref) === currentLanguage()) return false
  window.location.reload()
  return true
}
