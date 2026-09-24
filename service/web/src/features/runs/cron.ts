import cronstrue from 'cronstrue'
import 'cronstrue/locales/de'

export const cronPresets = [
  { label: 'Stündlich', cron: '0 * * * *' },
  { label: 'Täglich 02:00', cron: '0 2 * * *' },
  { label: 'Werktags 06:00', cron: '0 6 * * 1-5' },
  { label: 'Wöchentlich Mo 06:00', cron: '0 6 * * 1' },
  { label: 'Monatlich am 1., 03:00', cron: '0 3 1 * *' },
]

export function describeCron(cron: string): { text: string; error: boolean } {
  const c = cron.trim()
  if (!c) return { text: 'Bitte einen Cron-Ausdruck eingeben.', error: true }
  if (c.split(/\s+/).length !== 5) return { text: 'Erwartet werden genau 5 Felder: Minute Stunde Tag Monat Wochentag.', error: true }
  try {
    return { text: cronstrue.toString(c, { locale: 'de', use24HourTimeFormat: true, verbose: false }), error: false }
  } catch (e) {
    return { text: `Ungültiger Ausdruck: ${String(e).replace(/^Error:\s*/, '')}`, error: true }
  }
}

export function timeZones(): string[] {
  try {
    const list = Intl.supportedValuesOf('timeZone')
    if (!list.includes('UTC')) list.unshift('UTC')
    return list
  } catch {
    return ['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'UTC']
  }
}
