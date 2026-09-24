// Unit tests for the maintenance-window texts. Run: npm test (node --test, type stripping).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeDays, describeTimes, sameDays } from '../src/features/admin/maintenance-model.ts'

test('weekdays are summarised Monday first, with ranges', () => {
  assert.equal(describeDays([1, 2, 3, 4, 5]), 'Mo–Fr')
  assert.equal(describeDays([6, 0]), 'Sa, So')
  assert.equal(describeDays([0, 1, 2, 3, 4, 5, 6]), 'Täglich')
  assert.equal(describeDays([1, 3, 5]), 'Mo, Mi, Fr')
  assert.equal(describeDays([1, 2, 4, 5, 6]), 'Mo, Di, Do–Sa')
  assert.equal(describeDays([]), '')
})

test('times: overnight and whole-day windows', () => {
  assert.equal(describeTimes('22:00', '04:00'), '22:00–04:00 Uhr (endet am Folgetag)')
  assert.equal(describeTimes('01:00', '02:30'), '01:00–02:30 Uhr')
  assert.equal(describeTimes('00:00', '00:00'), 'ganztägig ab 00:00 Uhr')
})

test('day presets compare as sets', () => {
  assert.ok(sameDays([0, 6], [6, 0]))
  assert.ok(!sameDays([1, 2], [1, 2, 3]))
})
