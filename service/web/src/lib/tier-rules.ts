// Tier-model rules, identical to TierRules.cs on the server: control must never flow from a less
// privileged tier to a more privileged one. Used for live hints while editing.

export type TierIssue = { severity: 'Error' | 'Warning'; message: string }

/** Tier 3 stands for broad groups such as "Authenticated Users" – below every tier. */
export const BROAD = 3

const TIER0_PRINCIPALS = new Set(
  [
    'Domain Admins', 'Enterprise Admins', 'Schema Admins', 'Administrators', 'Administrator', 'Account Operators',
    'Server Operators', 'Backup Operators', 'Print Operators', 'Domain Controllers', 'Read-only Domain Controllers',
    'Enterprise Domain Controllers', 'Enterprise Read-only Domain Controllers', 'Group Policy Creator Owners',
    'Key Admins', 'Enterprise Key Admins', 'Cert Publishers', 'DnsAdmins', 'SYSTEM',
  ].map((s) => s.toLowerCase()),
)

const BROAD_PRINCIPALS = new Set(
  ['Everyone', 'Authenticated Users', 'Domain Users', 'Domain Computers', 'Users', 'Guests', 'Domain Guests', 'ANONYMOUS LOGON', 'Interactive', 'Network'].map((s) =>
    s.toLowerCase(),
  ),
)

const WRITE_RIGHTS = new Set(
  ['GenericAll', 'GenericWrite', 'WriteProperty', 'WriteDacl', 'WriteOwner', 'CreateChild', 'DeleteChild', 'Delete', 'DeleteTree', 'ExtendedRight', 'Self'].map((s) =>
    s.toLowerCase(),
  ),
)

const DOMAIN_DN = '{{DOMAIN_DN}}'

/** Tier found in a name or DN ("Tier 1 Servers", "Tier0Admins"); null if none. */
export function numericTier(text: unknown): number | null {
  if (typeof text !== 'string') return null
  const m = /tier\s*([012])(?![0-9])/i.exec(text)
  return m ? Number(m[1]) : null
}

/** Tier of a link or delegation target; the domain root and the DC OU are Tier 0. */
export function targetTier(dn: unknown): number | null {
  if (typeof dn !== 'string') return null
  if (dn.toLowerCase() === DOMAIN_DN.toLowerCase() || /^OU=Domain Controllers,/i.test(dn)) return 0
  return numericTier(dn)
}

export type GroupTierMap = Map<string, number>

/** Tier of each configured group, addressable by samAccountName and name (lower case). */
export function buildGroupTierMap(groups: Record<string, unknown>[]): GroupTierMap {
  const map: GroupTierMap = new Map()
  for (const g of groups) {
    const tier = numericTier(g.name) ?? numericTier(g.samaccountname) ?? numericTier(g.path)
    if (tier === null) continue
    if (typeof g.samaccountname === 'string') map.set(g.samaccountname.toLowerCase(), tier)
    if (typeof g.name === 'string') map.set(g.name.toLowerCase(), tier)
  }
  return map
}

export function principalTier(principal: unknown, groups: GroupTierMap): number | null {
  if (typeof principal !== 'string' || !principal.trim()) return null
  const bare = principal.slice(principal.lastIndexOf('\\') + 1).toLowerCase()
  if (TIER0_PRINCIPALS.has(bare)) return 0
  if (BROAD_PRINCIPALS.has(bare)) return BROAD
  return groups.get(bare) ?? numericTier(bare)
}

const tierLabel = (t: number) => (t === BROAD ? 'eine breite Gruppe' : `Tier ${t}`)

/** ACL/MSA/gMSA/dMSA delegation: write rights only on OUs of the principal's own or a less privileged tier. */
export function aclTierIssues(acl: Record<string, unknown>, groups: GroupTierMap): TierIssue[] {
  if (String(acl.accesscontroltype ?? '').toLowerCase() === 'deny') return []
  const rights = Array.isArray(acl.activedirectoryrights) ? acl.activedirectoryrights.map((r) => String(r).toLowerCase()) : []
  if (!rights.some((r) => WRITE_RIGHTS.has(r))) return []
  const t = targetTier(acl.targetOUPath)
  const p = principalTier(acl.identityreference, groups)
  if (t === null || p === null || p <= t) return []
  return [
    {
      severity: 'Error',
      message: `Tier-Verstoß: „${acl.identityreference}“ (${tierLabel(p)}) erhält Schreibrechte auf eine Tier-${t}-OU. Damit könnte ein weniger geschütztes Tier ein höheres übernehmen.`,
    },
  ]
}

/** Accounts: never in a group of a more privileged tier, and preferably only in their own tier. */
export function userTierIssues(user: Record<string, unknown>, groups: GroupTierMap): TierIssue[] {
  const u = numericTier(user.ouPath)
  if (u === null || !Array.isArray(user.memberOf)) return []
  const out: TierIssue[] = []
  for (const g of user.memberOf) {
    const t = principalTier(g, groups)
    if (t === null || t === BROAD || t === u) continue
    out.push(
      t < u
        ? { severity: 'Error', message: `Tier-Verstoß: Konto aus Tier ${u} wird Mitglied der Tier-${t}-Gruppe „${g}“.` }
        : { severity: 'Warning', message: `Konto aus Tier ${u} ist Mitglied der Tier-${t}-Gruppe „${g}“ – Konten sollten nur in ihrem eigenen Tier verwendet werden.` },
    )
  }
  return out
}

const LAPS_FIELDS: [string, string][] = [
  ['readGroup', 'Lesegruppe'],
  ['resetGroup', 'Zurücksetzen-Gruppe'],
  ['decryptorGroup', 'Entschlüsselungsgruppe'],
]

/** Windows LAPS: reading or resetting passwords of a tier is administration of that tier. */
export function lapsTierIssues(w: Record<string, unknown>, groups: GroupTierMap): TierIssue[] {
  const t = targetTier(w.ouDn)
  if (t === null) return []
  const out: TierIssue[] = []
  for (const [field, label] of LAPS_FIELDS) {
    const p = principalTier(w[field], groups)
    if (p !== null && p > t) out.push({ severity: 'Error', message: `Tier-Verstoß: ${label} „${w[field]}“ (${tierLabel(p)}) für eine Tier-${t}-OU.` })
  }
  return out
}

/** GPOs of one tier linked to an OU of another tier are almost always a mistake. */
export function gpoLinkTierIssues(gpoName: unknown, target: string): TierIssue[] {
  const t = numericTier(target)
  const g = numericTier(gpoName)
  if (t === null || g === null || t === g) return []
  return [{ severity: 'Warning', message: `GPO „${gpoName}“ gehört zu Tier ${g}, ist aber mit einer Tier-${t}-OU verknüpft.` }]
}
