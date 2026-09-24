// Pure helpers of the maintenance-window page (roadmap 4).
import { t } from '../../i18n/index.ts'

/** Display order Monday … Sunday; values are JavaScript/.NET weekday numbers (0 = Sunday). */
export const weekdays = [
  { value: 1, short: t('admin.maintenanceModel.mon'), long: t('admin.maintenanceModel.monday') },
  { value: 2, short: t('admin.maintenanceModel.tue'), long: t('admin.maintenanceModel.tuesday') },
  { value: 3, short: t('admin.maintenanceModel.wed'), long: t('admin.maintenanceModel.wednesday') },
  { value: 4, short: t('admin.maintenanceModel.thu'), long: t('admin.maintenanceModel.thursday') },
  { value: 5, short: t('admin.maintenanceModel.fri'), long: t('admin.maintenanceModel.friday') },
  { value: 6, short: t('admin.maintenanceModel.sat'), long: t('admin.maintenanceModel.saturday') },
  { value: 0, short: t('admin.maintenanceModel.sun'), long: t('admin.maintenanceModel.sunday') },
]

export const dayPresets = [
  { label: t('admin.maintenanceModel.weekdays'), days: [1, 2, 3, 4, 5] },
  { label: t('admin.maintenanceModel.weekend'), days: [6, 0] },
  { label: t('admin.maintenanceModel.daily'), days: [0, 1, 2, 3, 4, 5, 6] },
]

export const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d))

/** "Mo–Fr", "Sa, So", "Täglich" … */
export function describeDays(days: number[]) {
  if (days.length === 7) return t('admin.maintenanceModel.daily')
  const ordered = weekdays.filter((d) => days.includes(d.value))
  // Consecutive runs (in Monday-first order) become ranges.
  const idx = ordered.map((d) => weekdays.indexOf(d))
  const parts: string[] = []
  for (let i = 0; i < idx.length; ) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++
    parts.push(j - i >= 2 ? `${weekdays[idx[i]].short}–${weekdays[idx[j]].short}` : idx.slice(i, j + 1).map((k) => weekdays[k].short).join(', '))
    i = j + 1
  }
  return parts.join(', ')
}

export function describeTimes(from: string, to: string) {
  if (from === to) return t('admin.maintenanceModel.allDayFromFrom', { from })
  return to < from ? t('admin.maintenanceModel.timesOvernight', { from, to }) : t('admin.maintenanceModel.times', { from, to })
}
