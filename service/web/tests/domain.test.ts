// Unit tests for the domain selection (roadmap 17): query hashes, download URLs and per-domain drafts. Run: npm test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { domainQueryKeyHash, getDomainKey, setDomainKey, withDomain } from '../src/lib/domain.ts'
import { draftStore } from '../src/features/config/draft-store.ts'

test('query hashes include the selected domain, except for global keys', () => {
  setDomainKey('contoso')
  const a = domainQueryKeyHash(['runs', { page: 1 }])
  const me = domainQueryKeyHash(['auth', 'me'])
  const list = domainQueryKeyHash(['domains'])
  setDomainKey('fabrikam')
  assert.notEqual(domainQueryKeyHash(['runs', { page: 1 }]), a)
  assert.equal(domainQueryKeyHash(['auth', 'me']), me)
  assert.equal(domainQueryKeyHash(['domains']), list)
  setDomainKey('contoso')
  assert.equal(domainQueryKeyHash(['runs', { page: 1 }]), a)
})

test('browser navigations name the domain in the query string', () => {
  setDomainKey(null)
  assert.equal(withDomain('/api/config/export'), '/api/config/export')
  setDomainKey('fabrikam-test')
  assert.equal(withDomain('/api/config/export'), '/api/config/export?domain=fabrikam-test')
  assert.equal(withDomain('/api/reports/soll-ist?format=pdf'), '/api/reports/soll-ist?format=pdf&domain=fabrikam-test')
  assert.equal(getDomainKey(), 'fabrikam-test')
})

test('drafts are kept per domain and restored when switching back', () => {
  const section = (content: unknown) => ({ key: 'ous', fileName: 'x', title: 'OUs', description: '', version: 1, itemCount: 0, updatedAt: '', updatedBy: '', content })
  draftStore.adoptDomain('contoso')
  draftStore.setBase(section({ organizationUnits: [] }))
  draftStore.apply({ ous: { organizationUnits: [{ name: 'A' }] } })
  assert.deepEqual(draftStore.dirtyKeys(), ['ous'])

  draftStore.switchDomain('fabrikam')
  assert.deepEqual(draftStore.dirtyKeys(), [])
  assert.equal(draftStore.current('ous'), undefined)
  draftStore.setBase(section({ organizationUnits: [{ name: 'F' }] }))
  assert.deepEqual(draftStore.dirtyCounts(), { contoso: 1 })

  draftStore.switchDomain('contoso')
  assert.deepEqual(draftStore.current('ous'), { organizationUnits: [{ name: 'A' }] })
  assert.equal(draftStore.undo(), true)
  assert.deepEqual(draftStore.dirtyKeys(), [])
  draftStore.switchDomain('fabrikam')
  assert.deepEqual(draftStore.current('ous'), { organizationUnits: [{ name: 'F' }] })
})
