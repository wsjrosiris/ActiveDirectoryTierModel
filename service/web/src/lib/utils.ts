import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const dtf = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
const dtfShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const tf = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' })
const nf = new Intl.NumberFormat('de-DE')

export function formatDateTime(v: string | null | undefined) {
  if (!v) return '–'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '–' : dtf.format(d)
}

export function formatDateShort(v: string | null | undefined) {
  if (!v) return '–'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '–' : dtfShort.format(d)
}

export function formatTime(v: string | null | undefined) {
  if (!v) return ''
  const d = new Date(v)
  return isNaN(d.getTime()) ? '' : tf.format(d)
}

export function formatNumber(n: number | null | undefined) {
  return n === null || n === undefined ? '–' : nf.format(n)
}

export function formatRelative(v: string | null | undefined, now = Date.now()) {
  if (!v) return '–'
  const d = new Date(v).getTime()
  if (isNaN(d)) return '–'
  const diff = (d - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'gerade eben'
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

export function pluralize(n: number, one: string, many: string) {
  return `${nf.format(n)} ${n === 1 ? one : many}`
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
export const modKey = isMac ? '⌘' : 'Strg'

export function deepClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T)
}

export function stableStringify(v: unknown) {
  return JSON.stringify(v, null, 2)
}
