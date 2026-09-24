// Pure helpers for the Just-in-Time page (unit-tested in tests/jit-model.test.ts).
import type { JitRequest, JitStatus } from '../../api/jit.ts'
import { t } from '../../i18n/index.ts'

/** Durations offered in the request dialog (minutes). */
export const DURATIONS = [15, 30, 60, 120, 240, 480]

/** Choices for the maximum duration of a JIT group. */
export const MAX_DURATIONS = [15, 30, 60, 120, 240, 480, 720, 1440]

/** "15 Minuten", "1 Stunde", "8 Stunden". */
export function formatMinutes(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? t('jit.jitModel.n1Hour') : t('jit.jitModel.valueHours', { value: minutes / 60 })
  return t('jit.jitModel.minutesMinutes', { minutes })
}

/** Durations up to the group's maximum; the maximum itself is always offered. */
export function durationsFor(max: number, offered: number[] = DURATIONS): number[] {
  const list = offered.filter((d) => d <= max)
  if (!list.includes(max)) list.push(max)
  return list.sort((a, b) => a - b)
}

/** Largest offered duration ≤ the preferred one (default 60 minutes). */
export function defaultDuration(max: number, preferred = 60): number {
  const options = durationsFor(max)
  return [...options].reverse().find((d) => d <= preferred) ?? options[0]
}

/** Remaining time as "1:05:09" / "04:59", or "abgelaufen". */
export function formatCountdown(untilIso: string | null, now: number): string {
  if (!untilIso) return '–'
  const ms = new Date(untilIso).getTime() - now
  if (ms <= 0) return 'abgelaufen'
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Share of the granted time that is left (0–1), for the progress bar. */
export function remainingShare(r: Pick<JitRequest, 'grantedAt' | 'expiresAt'>, now: number): number {
  if (!r.grantedAt || !r.expiresAt) return 0
  const start = new Date(r.grantedAt).getTime()
  const end = new Date(r.expiresAt).getTime()
  if (end <= start) return 0
  return Math.min(1, Math.max(0, (end - now) / (end - start)))
}

export const statusLabels: Record<JitStatus, string> = {
  Pending: t('jit.jitModel.awaitingApproval'),
  Approved: t('jit.jitModel.beingGranted'),
  Rejected: t('jit.jitModel.rejected'),
  Active: t('jit.jitModel.active'),
  Expired: t('jit.jitModel.expired'),
  Revoked: t('jit.jitModel.revoked'),
  Failed: t('jit.jitModel.failed'),
  Cancelled: t('jit.jitModel.withdrawn'),
}

export type StatusTone = 'warning' | 'info' | 'success' | 'danger' | 'muted'

export const statusTone: Record<JitStatus, StatusTone> = {
  Pending: 'warning',
  Approved: 'info',
  Rejected: 'danger',
  Active: 'success',
  Expired: 'muted',
  Revoked: 'muted',
  Failed: 'danger',
  Cancelled: 'muted',
}

/** Open requests (tab "Anfragen"), active grants (tab "Aktiv") and everything finished (tab "Verlauf"). */
export function splitRequests(items: JitRequest[]) {
  return {
    open: items.filter((r) => r.status === 'Pending' || r.status === 'Approved'),
    active: items.filter((r) => r.status === 'Active'),
    history: items.filter((r) => !['Pending', 'Approved', 'Active'].includes(r.status)),
  }
}

/** Same rule as the service: samAccountName (optionally DOMAIN\sam) or SID, no characters that are invalid in a samAccountName. */
export function accountProblem(value: string): string | null {
  const v = value.trim()
  if (!v) return t('jit.jitModel.pleaseEnterAnAdAccount')
  const bare = v.includes('\\') ? v.slice(v.lastIndexOf('\\') + 1) : v
  if (/^S-1-[0-9]+(-[0-9]+){1,14}$/i.test(bare)) return null
  if (bare.length > 256 || /["/\\[\]:;|=,+*?<>@']/.test(bare) || bare.length === 0) return t('jit.jitModel.invalidSamaccountnameEGT0')
  return null
}
