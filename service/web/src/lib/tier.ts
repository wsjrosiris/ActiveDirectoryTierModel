export type Tier = 0 | 1 | 2 | 'admin' | null

/** Determines the tier by looking for "Tier 0/1/2" inside a name or DN. */
export function tierOf(text: string | null | undefined): Tier {
  if (!text) return null
  const m = /tier\s*([012])\b/i.exec(text)
  if (m) return Number(m[1]) as 0 | 1 | 2
  if (/tier model|paw/i.test(text)) return 'admin'
  return null
}

export const tierMeta = {
  0: { label: 'Tier 0', short: 'T0', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', badge: 'bg-rose-500/10 text-rose-700 border-rose-600/20 dark:text-rose-300 dark:border-rose-400/25', ring: 'ring-rose-500/30', hex: '#f43f5e' },
  1: { label: 'Tier 1', short: 'T1', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', badge: 'bg-amber-500/10 text-amber-800 border-amber-600/20 dark:text-amber-300 dark:border-amber-400/25', ring: 'ring-amber-500/30', hex: '#f59e0b' },
  2: { label: 'Tier 2', short: 'T2', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-700 border-emerald-600/20 dark:text-emerald-300 dark:border-emerald-400/25', ring: 'ring-emerald-500/30', hex: '#10b981' },
  admin: { label: 'Admin', short: 'Adm', dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', badge: 'bg-sky-500/10 text-sky-700 border-sky-600/20 dark:text-sky-300 dark:border-sky-400/25', ring: 'ring-sky-500/30', hex: '#0ea5e9' },
} as const

export type TierFilter = 'all' | '0' | '1' | '2' | 'none'

export function matchesTierFilter(t: Tier, f: TierFilter) {
  if (f === 'all') return true
  if (f === 'none') return t === null || t === 'admin'
  return t === Number(f)
}
