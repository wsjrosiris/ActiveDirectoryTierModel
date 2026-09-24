// Unit tests for the configuration assistants' pure helpers. Run: npm test (node --test, type stripping).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as m from '../src/features/config/wizards/wizard-model.ts'

const cfg = (name: string) => JSON.parse(readFileSync(new URL(`../../../config/tiermodel-${name}.json`, import.meta.url), 'utf8').replace(/^﻿/, ''))
const contents: m.Contents = { ous: cfg('ous'), groups: cfg('groups'), users: cfg('users'), acls: cfg('acls'), gpos: cfg('gpos') }
const snapshot = JSON.stringify(contents)
const D = '{{DOMAIN_DN}}'

test('name suggestions', () => {
  assert.equal(m.compactName('SQL Server'), 'SQLServer')
  assert.equal(m.compactName('web-farm 2'), 'WebFarm2')
  assert.equal(m.compactName('Übergabe'), 'Uebergabe')
  assert.equal(m.suggestGroupName(1, 'SQL Server'), 'Tier 1 SQL Server Admins')
  assert.equal(m.suggestGroupSam(1, 'SQL Server'), 'Tier1SQLServerAdmins')
  assert.equal(m.suggestGroupSam(1, 'SQL Server', ['tier1sqlserveradmins']), 'Tier1SQLServerAdmins2')
  assert.equal(m.suggestGroupSam(1, ''), 'Tier1Admins')
  assert.equal(m.suggestUserSam(1, 'Max Mustermann'), 't1-mmustermann')
  assert.equal(m.suggestUserSam(0, 'Jörg Müller-Lüdenscheidt'), 't0-jmuellerluedensch')
  assert.equal(m.suggestUserSam(0, 'Jörg Müller-Lüdenscheidt').length, 20)
  assert.equal(m.suggestUserSam(2, 'admin', ['t2-admin']), 't2-admin2')
  assert.equal(m.suggestUserSam(2, '  '), '')
})

test('validation of names', () => {
  const groups = m.groupsOf(contents)
  assert.match(m.groupSamError('Tier0Admins', groups) ?? '', /bereits vergeben/)
  assert.match(m.groupSamError('tier0admins', groups) ?? '', /bereits vergeben/)
  assert.match(m.groupSamError('Tier 1 X', groups) ?? '', /unzulässige/)
  assert.equal(m.groupSamError('Tier1SQLServerAdmins', groups), null)
  assert.match(m.userSamError('t1-abcdefghijklmnopqrst', []) ?? '', /20 Zeichen/)
  assert.match(m.ouNameError('a,b') ?? '', /Sonderzeichen/)
  assert.equal(m.ouNameError('SQL Server'), null)
})

test('default OUs per tier', () => {
  const ous = m.ousOf(contents)
  assert.equal(m.defaultServerParent(ous, 0), 'OU=Tier 0 Member Servers')
  assert.equal(m.defaultServerParent(ous, 1), 'OU=Tier 1 Member Servers')
  assert.equal(m.defaultServerParent(ous, 2), 'OU=Tier 2 End-User Devices')
  assert.equal(m.defaultAccountsOu(ous, 1), `OU=Tier 1 Accounts,OU=Tier 1,OU=Tier Model Administration,${D}`)
  assert.equal(m.defaultGroupsOu(ous, 2), `OU=Tier 2 Groups,OU=Tier 2,OU=Tier Model Administration,${D}`)
})

test('sibling GPO discovery', () => {
  const sources = m.gpoSources(contents.gpos, 1, 'OU=Tier 1 Member Servers')
  assert.ok(sources.length > 0)
  assert.ok(sources.every((s) => /Tier 1/.test(s.key)))
  const def = m.defaultGpoSource(sources)!
  assert.equal(def.key, `OU=Tier 1 Member Servers,${D}`)
  assert.deepEqual(def.links.map((l) => l.linkOrder), [...def.links.map((l) => l.linkOrder)].sort((a, b) => a - b))
  assert.equal(def.links[0].kind, 'PostConfigureGpo')
  assert.equal(m.defaultGpoSource(sources, true)?.key, `OU=Tier 1 Server Staging,OU=Tier 1 Member Servers,${D}`)
  assert.ok(m.gpoSources(contents.gpos, 1, 'OU=Tier 1 Member Servers').every((s) => s.key !== 'TemplateGpos'))
})

test('GPO target building keeps lists and renumbers link order', () => {
  const sources = m.gpoSources(contents.gpos, 1, 'OU=Tier 1 Member Servers')
  const names = ['*- Tier 1 Servers Account Restrictions', '*- Tier 1 Servers BitLocker', '*- Tier 1 Servers Windows LAPS - Computer']
  const { target, links } = m.buildGpoTarget(names, sources, `OU=Tier 1 Member Servers,${D}`)
  assert.deepEqual(Object.keys(target), ['ImportOnlyGpo', 'PostConfigureGpo'])
  assert.deepEqual(links.map((l) => l.linkOrder), [1, 2, 3])
  assert.equal(target.PostConfigureGpo.length, 1)
  assert.equal(target.PostConfigureGpo[0].linkOrder, 1)
  assert.deepEqual(target.ImportOnlyGpo.map((g: m.Obj) => [g.name, g.linkOrder]), [[names[1], 2], [names[2], 3]])
  // copied, not shared
  const src = contents.gpos!.gpos[`OU=Tier 1 Member Servers,${D}`].ImportOnlyGpo.find((g: m.Obj) => g.name === names[1])
  assert.notEqual(target.ImportOnlyGpo[0], src)
  assert.equal(target.ImportOnlyGpo[0].importPath, src.importPath)
})

const serverInput: m.ServerAreaInput = {
  tier: 1,
  name: 'SQL Server',
  parentPath: 'OU=Tier 1 Member Servers',
  staging: true,
  groupName: 'Tier 1 SQL Server Admins',
  groupSam: 'Tier1SQLServerAdmins',
  groupDescription: '',
  groupOu: `OU=Tier 1 Groups,OU=Tier 1,OU=Tier Model Administration,${D}`,
  presetId: 'full',
  gpoNames: ['*- Tier 1 Servers Account Restrictions', '*- Tier 1 Servers BitLocker'],
  gpoSourceKey: `OU=Tier 1 Member Servers,${D}`,
}

test('server area plan builds entries in all four sections', () => {
  const plan = m.buildServerAreaPlan(contents, serverInput)
  assert.equal(JSON.stringify(contents), snapshot, 'input must not be mutated')
  assert.deepEqual(Object.keys(plan.updated).sort(), ['acls', 'gpos', 'groups', 'ous'])
  const ous = plan.updated.ous!.organizationUnits
  assert.equal(ous.length, m.ousOf(contents).length + 2)
  assert.deepEqual(ous.at(-2), { name: 'SQL Server', path: 'OU=Tier 1 Member Servers', protectFromAccidentalDeletion: true, disableInheritance: false, blockGpoInheritance: true, comment: 'Tier 1: SQL Server server objects' })
  assert.equal(ous.at(-1).name, 'SQL Server Staging')
  assert.equal(ous.at(-1).path, 'OU=SQL Server,OU=Tier 1 Member Servers')
  const g = plan.updated.groups!.groups.at(-1)
  assert.equal(g.samaccountname, 'Tier1SQLServerAdmins')
  assert.equal(g.groupscope, 'Global')
  const acls = plan.updated.acls!.aclDelegations.slice(-2)
  assert.deepEqual(acls.map((a: m.Obj) => [a.targetOUPath, a.identityreference, a.objecttype, a.activeDirectorysecurityinheritance, a.activedirectoryrights.join()]), [
    [`OU=SQL Server,OU=Tier 1 Member Servers,${D}`, 'Tier1SQLServerAdmins', 'Computer', 'Descendents', 'GenericAll,CreateChild,DeleteChild'],
    [`OU=SQL Server,OU=Tier 1 Member Servers,${D}`, 'Tier1SQLServerAdmins', 'OrganizationalUnit', 'All', 'GenericAll,CreateChild,DeleteChild'],
  ])
  assert.deepEqual(Object.keys(acls[0]), ['targetOUPath', 'identityreference', 'activedirectoryrights', 'accesscontroltype', 'objecttype', 'activeDirectorysecurityinheritance', 'resolveguid', 'comment'])
  const keys = Object.keys(plan.updated.gpos!.gpos)
  assert.equal(keys.at(-1), 'TemplateGpos', 'templates stay last')
  assert.ok(keys.includes(`OU=SQL Server,OU=Tier 1 Member Servers,${D}`))
  assert.equal(m.hasErrors(plan.issues), false, JSON.stringify(plan.issues))
  assert.equal(plan.sentences.filter((s) => s.section === 'gpos').length, 2)
  assert.equal(plan.sentences.filter((s) => s.section === 'ous').length, 2)
})

test('server area plan: join preset, no GPOs, tier checks', () => {
  const plan = m.buildServerAreaPlan(contents, { ...serverInput, staging: false, presetId: 'join', gpoNames: [] })
  assert.equal(plan.updated.gpos, undefined)
  assert.equal(plan.updated.ous!.organizationUnits.at(-1).blockGpoInheritance, false)
  const acl = plan.updated.acls!.aclDelegations.at(-1)
  assert.deepEqual([acl.objecttype, acl.activedirectoryrights.join()], ['Computer', 'CreateChild,DeleteChild'])
  // parent of another tier → error
  const wrong = m.buildServerAreaPlan(contents, { ...serverInput, parentPath: 'OU=Tier 2 End-User Devices' })
  assert.ok(wrong.issues.some((i) => i.severity === 'Error' && /Tier 2/.test(i.message)))
  // duplicate OU and group → errors
  const dup = m.buildServerAreaPlan(contents, { ...serverInput, name: 'Tier 1 Server Staging', groupSam: 'Tier1Admins' })
  assert.ok(dup.issues.filter((i) => i.severity === 'Error').length >= 2)
  // tier 0 → warning
  const t0 = m.buildServerAreaPlan(contents, { ...serverInput, tier: 0, parentPath: 'OU=Tier 0 Member Servers', groupName: 'Tier 0 SQL Admins', groupSam: 'Tier0SQLAdmins', groupOu: `OU=Tier 0 Groups,OU=Tier 0,OU=Tier Model Administration,${D}`, gpoNames: [] })
  assert.ok(t0.issues.some((i) => i.severity === 'Warning' && /Tier 0/.test(i.message)))
  assert.equal(m.hasErrors(t0.issues), false)
})

test('admin account plan', () => {
  const input: m.AdminAccountInput = {
    tier: 1, samAccountName: 't1-mmustermann', displayName: 'Max Mustermann (T1)', description: 'Admin', ouPath: m.defaultAccountsOu(m.ousOf(contents), 1),
    memberOf: ['Tier1Admins'], protectedUsers: true, enabled: true,
  }
  const plan = m.buildAdminAccountPlan(contents, input)
  const u = plan.updated.users!.users.at(-1)
  assert.deepEqual(u, { samAccountName: 't1-mmustermann', displayName: 'Max Mustermann (T1)', ouPath: input.ouPath, description: 'Admin', enabled: true, memberOf: ['Tier1Admins', 'Protected Users'] })
  assert.equal(m.hasErrors(plan.issues), false)
  // no duplicate Protected Users, unchecked removes it
  assert.deepEqual(m.buildAdminUser({ ...input, memberOf: ['Protected Users'], protectedUsers: false }).memberOf, [])
  // membership in a Tier 0 group → error, Tier 2 group → warning
  const bad = m.buildAdminAccountPlan(contents, { ...input, memberOf: ['Tier0Admins', 'Tier2Admins'] })
  assert.ok(bad.issues.some((i) => i.severity === 'Error' && /Tier0Admins/.test(i.message)))
  assert.ok(bad.issues.some((i) => i.severity === 'Warning' && /Tier2Admins/.test(i.message)))
  // wrong OU tier, missing Protected Users for tier 1
  const wrongOu = m.buildAdminAccountPlan(contents, { ...input, ouPath: m.defaultAccountsOu(m.ousOf(contents), 2), protectedUsers: false })
  assert.ok(wrongOu.issues.some((i) => i.severity === 'Error' && /Ziel-OU/.test(i.message)))
  assert.ok(wrongOu.issues.some((i) => i.severity === 'Warning' && /Protected Users/.test(i.message)))
  const dup = m.buildAdminAccountPlan(contents, { ...input, samAccountName: 'svc-pawdomainjoin' })
  assert.ok(dup.issues.some((i) => /bereits vergeben/.test(i.message)))
})

test('delegation plan and tier rule', () => {
  const input: m.DelegationInput = {
    principal: 'Tier2Admins', rights: ['GenericAll'], objecttype: 'Computer', inheritedObjectType: '',
    target: `OU=Tier 1 Member Servers,${D}`, inheritance: 'Descendents', allow: true, comment: '',
  }
  const plan = m.buildDelegationPlan(contents, input)
  assert.equal(plan.updated.acls!.aclDelegations.length, m.aclsOf(contents).length + 1)
  assert.ok(plan.issues.some((i) => i.severity === 'Error' && /Tier-Verstoß/.test(i.message)))
  assert.match(m.delegationTierExplanation(contents, 'Tier2Admins', input.target) ?? '', /weniger geschützten/)
  const ok = m.buildDelegationPlan(contents, { ...input, principal: 'Tier1Admins', objecttype: 'User' })
  assert.equal(m.hasErrors(ok.issues), false)
  const deny = m.buildDelegationPlan(contents, { ...input, allow: false })
  assert.equal(m.hasErrors(deny.issues), false)
  assert.equal(deny.updated.acls!.aclDelegations.at(-1).accesscontroltype, 'Deny')
  // identical to an existing entry → error
  const dup = m.delegationIssues(contents, { ...input, principal: 'Tier1Admins', rights: ['GenericAll'], objecttype: 'Computer', inheritance: 'Descendents' })
  assert.ok(dup.some((i) => /identische/.test(i.message)))
  assert.equal(m.matchPreset({ objecttype: 'Computer', activedirectoryrights: ['GenericAll'], activeDirectorysecurityinheritance: 'Descendents' }), 'computer-full')
  assert.equal(m.matchPreset({ objecttype: 'Computer', activedirectoryrights: ['DeleteChild', 'CreateChild'], activeDirectorysecurityinheritance: 'SelfAndChildren' }), 'computer-join')
  assert.equal(m.matchPreset({ objecttype: 'Computer', activedirectoryrights: ['ReadProperty'], activeDirectorysecurityinheritance: 'Descendents' }), 'custom')
})
