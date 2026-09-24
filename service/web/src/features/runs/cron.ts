import cronstrue from 'cronstrue'
import { currentLanguage, t } from '../../i18n/index.ts'
import 'cronstrue/locales/de'

export const cronPresets = [
  { label: t('runs.cron.hourly'), cron: '0 * * * *' },
  { label: t('runs.cron.daily0200'), cron: '0 2 * * *' },
  { label: t('runs.cron.weekdays0600'), cron: '0 6 * * 1-5' },
  { label: t('runs.cron.weeklyMon0600'), cron: '0 6 * * 1' },
  { label: t('runs.cron.monthlyOnThe1st03'), cron: '0 3 1 * *' },
]

export function describeCron(cron: string): { text: string; error: boolean } {
  const c = cron.trim()
  if (!c) return { text: t('runs.cron.pleaseEnterACronExpression'), error: true }
  if (c.split(/\s+/).length !== 5) return { text: t('runs.cron.exactly5FieldsAreExpected'), error: true }
  try {
    return { text: cronstrue.toString(c, { locale: currentLanguage(), use24HourTimeFormat: true, verbose: false }), error: false }
  } catch (e) {
    return { text: t('runs.cron.invalidExpressionReplace', { replace: String(e).replace(/^Error:\s*/, '') }), error: true }
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
