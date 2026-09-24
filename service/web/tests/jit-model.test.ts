// Unit tests for the Just-in-Time page helpers. Run: npm test (node --test, type stripping).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountProblem, defaultDuration, durationsFor, formatCountdown, formatMinutes, remainingShare, splitRequests } from '../src/features/jit/jit-model.ts'
import type { JitRequest } from '../src/api/jit.ts'

test('durations stay within the group maximum and always offer the maximum', () => {
  assert.deepEqual(durationsFor(60), [15, 30, 60])
  assert.deepEqual(durationsFor(90), [15, 30, 60, 90])
  assert.deepEqual(durationsFor(480), [15, 30, 60, 120, 240, 480])
  assert.deepEqual(durationsFor(10), [10])
  assert.equal(defaultDuration(480), 60)
  assert.equal(defaultDuration(30), 30)
})

test('minutes are written in German', () => {
  assert.equal(formatMinutes(15), '15 Minuten')
  assert.equal(formatMinutes(60), '1 Stunde')
  assert.equal(formatMinutes(480), '8 Stunden')
})

test('countdown', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  assert.equal(formatCountdown('2026-09-24T12:04:59Z', now), '04:59')
  assert.equal(formatCountdown('2026-09-24T13:05:09Z', now), '1:05:09')
  assert.equal(formatCountdown('2026-09-24T11:59:00Z', now), 'abgelaufen')
  assert.equal(formatCountdown(null, now), '–')
})

test('remaining share of the granted time', () => {
  const now = Date.parse('2026-09-24T12:30:00Z')
  assert.equal(remainingShare({ grantedAt: '2026-09-24T12:00:00Z', expiresAt: '2026-09-24T13:00:00Z' }, now), 0.5)
  assert.equal(remainingShare({ grantedAt: null, expiresAt: null }, now), 0)
})

test('requests are split into open, active and history', () => {
  const r = (status: JitRequest['status']) => ({ status }) as JitRequest
  const s = splitRequests([r('Pending'), r('Approved'), r('Active'), r('Expired'), r('Rejected'), r('Cancelled')])
  assert.equal(s.open.length, 2)
  assert.equal(s.active.length, 1)
  assert.equal(s.history.length, 3)
})

test('account validation mirrors the service', () => {
  assert.equal(accountProblem('t0-alice'), null)
  assert.equal(accountProblem('CONTOSO\\t0-alice'), null)
  assert.equal(accountProblem('S-1-5-21-1-2-3-1201'), null)
  assert.notEqual(accountProblem("x' -or 1"), null)
  assert.notEqual(accountProblem('a@b'), null)
  assert.notEqual(accountProblem(''), null)
})
