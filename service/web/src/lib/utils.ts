import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { currentLocale, t } from '../i18n/index.ts'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Intl formatters for the active UI language (de-DE, or en-GB for English: 24-hour clock, day before month).
// Created lazily and cached per locale, so a language change needs no reload of this module.
const formatters = new Map<string, ReturnType<typeof createFormatters>>()
function createFormatters(locale: string) {
  return {
    dtf: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    dtfShort: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    tf: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    rtf: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
    nf: new Intl.NumberFormat(locale),
  }
}
function fmt() {
  const locale = currentLocale()
  let f = formatters.get(locale)
  if (!f) formatters.set(locale, (f = createFormatters(locale)))
  return f
}

export function formatDateTime(v: string | null | undefined) {
  if (!v) return '–'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '–' : fmt().dtf.format(d)
}

export function formatDateShort(v: string | null | undefined) {
  if (!v) return '–'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '–' : fmt().dtfShort.format(d)
}

export function formatTime(v: string | null | undefined) {
  if (!v) return ''
  const d = new Date(v)
  return isNaN(d.getTime()) ? '' : fmt().tf.format(d)
}

export function formatNumber(n: number | null | undefined) {
  return n === null || n === undefined ? '–' : fmt().nf.format(n)
}

export function formatRelative(v: string | null | undefined, now = Date.now()) {
  if (!v) return '–'
  const d = new Date(v).getTime()
  if (isNaN(d)) return '–'
  const diff = (d - now) / 1000
  const abs = Math.abs(diff)
  const { rtf, dtf } = fmt()
  if (abs < 45) return t('lib.utils.justNow')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return dtf.format(new Date(d))
}

export function formatDuration(start: string | null, end: string | null, now = Date.now()) {
  if (!start) return '–'
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : now
  let sec = Math.max(0, Math.round((e - s) / 1000))
  const h = Math.floor(sec / 3600)
  sec -= h * 3600
  const m = Math.floor(sec / 60)
  sec -= m * 60
  if (h) return `${h} h ${m} min`
  if (m) return `${m} min ${sec} s`
  return `${sec} s`
}

export function downloadUrl(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : t('lib.utils.ctrl')

export function deepClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

export function stableStringify(v: unknown) {
  return JSON.stringify(v, null, 2)
}
