import { hashKey, type QueryKey } from '@tanstack/react-query'

/* The managed domain the UI works on (roadmap 17). Module state so the API client can send it with every request
 * (header X-TierModel-Domain) and TanStack Query can keep one cache per domain. The choice is a per-viewer convenience
 * stored in localStorage (per user); null = the service's default domain (no header). */

export const DOMAIN_HEADER = 'X-TierModel-Domain'

let current: string | null = null
const listeners = new Set<() => void>()

export function getDomainKey(): string | null {
  return current
}

export function setDomainKey(key: string | null) {
  if (key === current) return
  current = key
  listeners.forEach((l) => l())
}

export function subscribeDomain(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

const storageKey = (username: string) => `tm-domain:${username.toLowerCase()}`

export function readStoredDomain(username: string): string | null {
  try {
    return localStorage.getItem(storageKey(username))
  } catch {
    return null
  }
}

export function storeDomain(username: string, key: string | null) {
  try {
    if (key) localStorage.setItem(storageKey(username), key)
    else localStorage.removeItem(storageKey(username))
  } catch {
    /* private window, blocked storage: the choice just is not remembered */
  }
}

/** Query keys that do not depend on the domain (sign-in, the list of domains). */
const GLOBAL_KEYS = new Set(['auth', 'domains'])

/** Query hash including the domain, so the caches of different domains never mix. */
export function domainQueryKeyHash(queryKey: QueryKey): string {
  const first = queryKey[0]
  if (typeof first === 'string' && GLOBAL_KEYS.has(first)) return hashKey(queryKey)
  return hashKey([{ domain: current ?? '' }, ...queryKey])
}

/** URL for browser navigations (downloads, report preview) that cannot send the header. */
export function withDomain(url: string): string {
  if (!current) return url
  return url + (url.includes('?') ? '&' : '?') + 'domain=' + encodeURIComponent(current)
}
