// Pure helpers of the maintenance-window page (roadmap 4).

/** Display order Monday … Sunday; values are JavaScript/.NET weekday numbers (0 = Sunday). */
export const weekdays = [
  { value: 1, short: 'Mo', long: 'Montag' },
  { value: 2, short: 'Di', long: 'Dienstag' },
  { value: 3, short: 'Mi', long: 'Mittwoch' },
  { value: 4, short: 'Do', long: 'Donnerstag' },
  { value: 5, short: 'Fr', long: 'Freitag' },
  { value: 6, short: 'Sa', long: 'Samstag' },
  { value: 0, short: 'So', long: 'Sonntag' },
]

export const dayPresets = [
  { label: 'Werktage', days: [1, 2, 3, 4, 5] },
  { label: 'Wochenende', days: [6, 0] },
  { label: 'Täglich', days: [0, 1, 2, 3, 4, 5, 6] },
]

export const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d))

/** "Mo–Fr", "Sa, So", "Täglich" … */
export function describeDays(days: number[]) {
  if (days.length === 7) return 'Täglich'
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
  if (from === to) return `ganztägig ab ${from} Uhr`
  return `${from}–${to} Uhr${to < from ? ' (endet am Folgetag)' : ''}`
}
