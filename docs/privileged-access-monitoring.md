# Privileged Access Monitoring

`Watch-TierModelPrivilegedGroups.ps1` takes a **read-only** snapshot of privileged access in a domain and writes it
as JSON. The TierModel service runs it on a schedule (run kind *Monitor*), compares consecutive snapshots and
reports new or removed Tier 0 members, hygiene problems of admin accounts and attack paths to Tier 0. The script can
also be run by hand; it never changes Active Directory and does not use `-ConfirmApply`.

## Usage

```powershell
.\Watch-TierModelPrivilegedGroups.ps1 -PreferredDc DC01.contoso.com -OutputPath C:\Reports\privileged.json

# Explicit configuration directory, partial failures shown as verbose output
.\Watch-TierModelPrivilegedGroups.ps1 -PreferredDc DC01.contoso.com -OutputPath .\out\privileged.json -ConfigPath .\config -Verbose
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `-PreferredDc` | yes | Domain controller used for every query of the current domain. |
| `-OutputPath` | yes | JSON file to write (UTF-8 without BOM). The directory is created if needed. |
| `-ConfigPath` | no | Configuration directory; defaults to `config` next to the script. Used for the Tier 0 groups and the Tier 0 / Tier 1 OUs. |

Exit code `0` means the snapshot was written, even if it contains findings or partial failures. Exit code `1` means
the snapshot could not be taken (PowerShell older than 7, modules not loadable, or the domain itself unreadable).
The console shows a few short progress lines.

The logic lives in the module functions `Get-TierModelPrivilegedSnapshot` (collects the data and returns an ordered
dictionary) and `Export-TierModelPrivilegedSnapshot` (writes the JSON file), so it can be reused and unit tested.

## What is collected

### Groups

- **Protected built-in groups**, resolved by SID via the well-known principal table, so localized names such as
  *Domänen-Admins* are found: Domain Admins, Enterprise Admins, Schema Admins, Administrators, Account Operators,
  Server Operators, Backup Operators, Print Operators, Domain Controllers, Read-only Domain Controllers, Enterprise
  Read-only Domain Controllers, Group Policy Creator Owners, Key Admins, Enterprise Key Admins, Cert Publishers,
  Replicator and DnsAdmins (by name, it has no fixed RID; skipped silently if it does not exist).
- **Tier 0 groups from the configuration**: every group in `tiermodel-groups.json` whose name, sAMAccountName or path
  (in this order) matches `tier\s*([012])(?![0-9])` with tier 0, the same rule the service uses. For example
  *PAW Domain Join* is Tier 0 because of its path.
- In a **child domain** the forest-wide groups (Enterprise Admins, Schema Admins, Enterprise Key Admins, Enterprise
  Read-only Domain Controllers) are read from a forest root DC found with
  `Get-ADDomainController -Discover -DomainName <root>`. If none can be discovered, the root domain name is used as
  server and an entry is added to `errors`; if the forest root cannot be read at all, those groups are skipped.

Membership is expanded recursively (breadth-first, so the shortest nesting path is reported), deduplicated by SID
and protected against cycles. Members whose *primary group* is the group (for example domain controllers in
*Domain Controllers*) are included. `direct` is `true` for direct members; otherwise `via` lists the nested groups,
outermost first. Foreign security principals are reported with `objectClass: foreignSecurityPrincipal`; their SID
is translated to a name when possible (well-known SIDs such as *Authenticated Users* always).

### Accounts

Every user, computer and (group) managed service account that is a recursive member of one of the groups above,
plus every account below a configured **account OU** of Tier 0 or Tier 1. Rule: an OU from `tiermodel-ous.json`
whose resolved DN contains Tier 0 or Tier 1 and whose own name contains `Accounts` (for example *Tier 0 Accounts*,
*Tier 1 Service Accounts*); the whole subtree is read. The account tier is 0 when it is in any group above,
otherwise the tier of the OU.

Per account: `enabled`, `lastLogon` (`lastLogonTimestamp`), `passwordLastSet` (`pwdLastSet`), `passwordNeverExpires`
(UAC `0x10000`), `accountNotDelegated` (UAC `0x100000`), `protectedUsers` (recursive member of `<domain SID>-525`),
`adminCount`, `servicePrincipalNames` and `memberOfPrivileged` (well-known or configured names of the groups).

> `lastLogonTimestamp` is replicated but only updated when the previous value is older than about 14 days
> (`msDS-LogonTimeSyncInterval`). Treat `lastLogon` as accurate to roughly two weeks; it is `null` if the account
> never logged on.

### adminCount orphans

Users and groups with `adminCount=1` that are not a recursive member of any protected built-in group. The protected
groups themselves, `krbtgt`, BUILTIN groups and other built-in domain principals (RID below 1000) are skipped. Such
objects keep the AdminSDHolder ACL with inheritance disabled although they are no longer privileged.

### ACL findings

The owner and DACL of these Tier 0 objects are read (`nTSecurityDescriptor` via `Get-ADObject` on the preferred DC):

| objectType | Objects |
|------------|---------|
| `DomainRoot` | the domain naming context |
| `AdminSDHolder` | `CN=AdminSDHolder,CN=System,<domain>` |
| `ProtectedGroup` | every protected built-in group found above |
| `DomainControllersOU` | `OU=Domain Controllers` |
| `Tier0OU` | every configured OU whose resolved DN matches Tier 0 (missing OUs are listed in `errors`) |
| `Tier0GPO` | GPOs linked (gPLink) to the domain root, the Domain Controllers OU or a Tier 0 OU |

Only allow ACEs with these rights are reported: `GenericAll`, `GenericWrite`, `WriteDacl`, `WriteOwner`,
`AllExtendedRights` (extended right with an empty GUID), `ResetPassword` (extended right
`00299570-246d-11d0-a768-00aa006e0529`), `WriteMember` (write property or the Self validated write on `member`
`bf9679c0-0de6-11d0-a285-00aa003049e2`, or on the Group-Membership property set), `WriteProperty` (all properties, or
`msDS-KeyCredentialLink`) and `Owner` (object owner). Read-only rights, deny ACEs and other extended rights or
properties are ignored.

Never reported (expected Tier 0 principals): SYSTEM, Administrators, Domain Admins, Enterprise Admins and Schema
Admins (forest root), Enterprise Domain Controllers, Domain Controllers, SELF, CREATOR OWNER, every Tier 0 group from
the configuration, and Key Admins / Enterprise Key Admins for `msDS-KeyCredentialLink`. For group principals the
finding contains the number of recursive (non-group) members and up to ten sample names.

## Output

The file follows the contract read by the service: camelCase keys, arrays are always arrays (also with zero or one
element), timestamps are ISO-8601 UTC (`2026-09-24T10:00:00Z`) and unknown values are `null`.

```json
{
  "metadata": { "version": "1", "preferredDc": "dc01.contoso.com", "timestamp": "2026-09-24T10:00:00Z",
                "domain": "contoso.com", "domainSid": "S-1-5-21-...", "forestRootDomain": "contoso.com", "isForestRoot": true },
  "groups": [ { "sid": "S-1-5-21-...-512", "name": "Domänen-Admins", "wellKnownName": "Domain Admins", "source": "builtin",
                "tier": 0, "distinguishedName": "CN=...", "members": [ { "sid": "...", "samAccountName": "bob", "name": "Bob",
                "objectClass": "user", "distinguishedName": "CN=...", "direct": false, "via": [ "G-Nested" ], "enabled": true } ] } ],
  "accounts": [ { "sid": "...", "samAccountName": "t0-alice", "distinguishedName": "CN=...", "objectClass": "user", "tier": 0,
                  "enabled": true, "lastLogon": "2026-09-20T08:00:00Z", "passwordLastSet": null, "passwordNeverExpires": false,
                  "accountNotDelegated": true, "protectedUsers": true, "adminCount": 1, "servicePrincipalNames": [],
                  "memberOfPrivileged": [ "Domain Admins" ] } ],
  "adminCountOrphans": [ { "sid": "...", "samAccountName": "frank", "distinguishedName": "CN=...", "objectClass": "user" } ],
  "aclFindings": [ { "objectDn": "DC=contoso,DC=com", "objectType": "DomainRoot", "objectName": "contoso.com",
                     "principalSid": "...", "principalName": "CONTOSO\\Helpdesk", "principalClass": "group",
                     "rights": [ "WriteMember" ], "objectTypeGuid": "bf9679c0-0de6-11d0-a285-00aa003049e2", "inherited": false,
                     "memberCount": 2, "sampleMembers": [ "bob", "t1-erin" ] } ],
  "errors": [ "Tier 0 group 'PAW Domain Join' (PAWDomainJoin) from the configuration was not found." ]
}
```

Every AD call is wrapped individually: an unreadable group, OU or ACL adds a message to `errors` and the snapshot
continues. Lookups are cached by DN and SID, so each object is read once per run.

## Required permissions

- **Read-only.** Any authenticated domain account can take the snapshot; no Domain Admin rights, no elevation and no
  English-language domain are required (the script does not run `Test-TierModelPrerequisites`).
- Reading group membership, `adminCount`, `userAccountControl`, `lastLogonTimestamp`, `pwdLastSet` and SPNs needs the
  default authenticated read access.
- Reading the owner and DACL of the domain root, AdminSDHolder, protected groups, OUs and GPOs needs normal
  authenticated read access (Read Permissions is granted to Authenticated Users by default). The SACL is not read.
- In a child domain the account must be able to read the forest root domain (default within a forest).
- PowerShell 7 and the ActiveDirectory module (RSAT) are required.

## Tests

`tests/Unit.PrivilegedSnapshot.Tests.ps1` covers membership recursion with nesting and cycles, SID deduplication,
foreign security principals, localized group names, child domains, account flag and timestamp parsing, adminCount
orphans, ACL mapping and exclusions, the JSON shape and the script's exit codes, with all AD cmdlets mocked.
