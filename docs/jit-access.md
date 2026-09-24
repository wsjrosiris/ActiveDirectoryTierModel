# Just-in-Time Admin Access

`Grant-TierModelJitAccess.ps1` adds an account to a privileged group **for a limited time**. The membership is written
with `Add-ADGroupMember -MemberTimeToLive`, so Active Directory removes it by itself when the time-to-live (TTL) runs
out, even if no tool is running at that moment. The TierModel service uses the script for its
*Befristeter Zugriff* page (request, four-eyes approval, grant, early revocation); it can also be run by hand.

## Prerequisites

Time-limited memberships need two things in the forest:

| Requirement | How to check | Notes |
|---|---|---|
| Optional feature **Privileged Access Management Feature** enabled | `Get-ADOptionalFeature -Filter "Name -eq 'Privileged Access Management Feature'"` – `EnabledScopes` is not empty | **Enabling it is irreversible.** It applies to the whole forest and cannot be disabled again. |
| Forest functional level **Windows Server 2016** or later | `(Get-ADForest).ForestMode` is `Windows2016Forest` or newer | Required before the feature can be enabled. |

The framework and the service **only check** these prerequisites (`-Mode Check`, `Test-TierModelJitPrerequisite`).
They never enable the feature. After the forest owner has reviewed the impact, an Enterprise Admin enables it with:

```powershell
Enable-ADOptionalFeature 'Privileged Access Management Feature' -Scope ForestOrConfigurationSet -Target contoso.com
```

Things to know before enabling it:

- **Irreversible**: there is no supported way back. Test it in a lab forest first.
- **Kerberos ticket lifetime**: with PAM enabled, the domain controllers issue Kerberos tickets (TGT and service
  tickets) whose lifetime is capped at the **shortest remaining TTL** of the account's time-limited group memberships.
  When the membership expires, the account has to request new tickets and no longer receives the group SID. Already
  issued tickets remain valid until they expire, and access tokens of existing logon sessions keep the group until the
  user logs off - plan short sessions (for example on a PAW) for JIT use.
- **Replication**: the TTL is evaluated on every domain controller; expiry is effective everywhere without
  replication of a removal.
- The account running the script needs the right to change the membership of the JIT groups (Grant/Revoke) and read
  access to the configuration partition (Check).

## Recommended JIT groups

- Prefer **dedicated JIT groups** with exactly the rights needed for a task (for example a group with delegated rights
  on the certificate templates, or on the Tier 0 server OU) over the built-in groups.
- If a built-in group must be used, nest a dedicated JIT group into it (for example `Tier0-JIT-DomainAdmins` as a
  member of *Domain Admins*) and grant membership in the JIT group; the permanent membership of the nested group is
  then configured once and reviewed by the privileged-group monitoring.
- Keep **Tier 0 JIT groups** small, with short maximum durations (one to four hours) and four-eyes approval.
- Put accounts that may request Tier 0 access into *Protected Users* and use them only from Tier 0 PAWs.
- Keep the JIT groups empty permanently; the monitoring reports every member without an active request as unexpected.

## Usage

```powershell
# Read-only prerequisite check
.\Grant-TierModelJitAccess.ps1 -PreferredDc DC01.contoso.com -Mode Check -OutputPath .\out\jit.json

# Grant t0-alice membership in Tier0-JIT-DomainAdmins for 60 minutes
.\Grant-TierModelJitAccess.ps1 -PreferredDc DC01.contoso.com -Group Tier0-JIT-DomainAdmins -Member t0-alice -Minutes 60 -OutputPath .\out\jit.json

# End it early
.\Grant-TierModelJitAccess.ps1 -PreferredDc DC01.contoso.com -Mode Revoke -Group Tier0-JIT-DomainAdmins -Member t0-alice

# Time-limited members with their remaining lifetime
.\Grant-TierModelJitAccess.ps1 -PreferredDc DC01.contoso.com -Mode List -Group Tier0-JIT-DomainAdmins
```

| Parameter | Modes | Description |
|---|---|---|
| `-PreferredDc` | all | Domain controller used for every operation. |
| `-Mode` | – | `Grant` (default), `Revoke`, `Check` (read-only) or `List` (read-only). |
| `-Group` | Grant, Revoke, List | Group as sAMAccountName or SID. |
| `-Member` | Grant, Revoke | User, computer or group as sAMAccountName (a `DOMAIN\` prefix is accepted) or SID. |
| `-Minutes` | Grant | Lifetime, 1 to 10080 (one week). |
| `-OutputPath` | all, optional | JSON result file (UTF-8 without BOM). |

Exit code `0` means the operation succeeded (for `Check` also when the prerequisites are not met - see `ready`).
Exit code `1` means it failed; the result file then contains `success: false` and `error`.

### Behaviour

- **Grant** refuses to run when the prerequisites are not met, when the account is already a permanent member (a
  permanent membership is never silently turned into a temporary one) or already has a time-limited membership.
  After adding the member, the group is read back with `Get-ADGroup -Properties member -ShowMemberTimeToLive`;
  time-limited members appear as `<TTL=3587>,CN=…` (remaining seconds). The grant fails when the member is missing or
  was stored without a TTL. `expiresAt` is computed from the TTL that was read back.
- **Revoke** removes the membership with `Remove-ADGroupMember` and verifies the removal. When the membership has
  already expired, nothing is changed (`wasMember: false`). A permanent membership is only removed with the module
  function's `-IncludePermanent` switch, never by the script.
- Identities are validated before they are used in a filter (sAMAccountName characters or a SID only).

### Result file

```json
{ "mode": "grant", "success": true, "group": "Tier0-JIT-DomainAdmins", "member": "t0-alice",
  "sids": { "group": "S-1-5-21-…-3105", "member": "S-1-5-21-…-1201" },
  "groupDn": "CN=Tier0-JIT-DomainAdmins,…", "memberDn": "CN=Alice,…",
  "ttlSeconds": 3598, "expiresAt": "2026-09-24T11:00:00Z", "dc": "DC01.contoso.com", "timestamp": "2026-09-24T10:00:02Z" }
```

`Revoke` writes `wasMember` and `removed` instead of the TTL fields; `Check` writes `ready`, `pamEnabled`,
`enabledScopes`, `forestMode`, `forestLevelSufficient` and `messages`; `List` writes `members` (`memberDn`,
`ttlSeconds`, `expiresAt`).

## Module functions

| Function | Purpose |
|---|---|
| `Test-TierModelJitPrerequisite -Server` | Read-only check of the PAM feature and the forest functional level. |
| `Grant-TierModelJitAccess -Group -Member -Minutes -Server` | Time-limited membership with verification. |
| `Revoke-TierModelJitAccess -Group -Member -Server [-IncludePermanent]` | Early removal with verification. |
| `Get-TierModelJitMembership -Group -Server [-IncludePermanent]` | Members with TTL and remaining seconds. |

## In the TierModel service

- Administrators define the **JIT groups** (group, tier, maximum duration, approval required, minimum role, optional
  list of eligible users).
- A request names the group, the duration (up to the group's maximum) and a mandatory justification. The member is
  the requester's own AD account; only administrators can request access for another account.
- With approval required, a second person with the role *Operator* must approve (the requester cannot approve their
  own request). The grant then runs as a run of kind *Jit*. Maintenance windows and change freezes do **not** delay
  JIT runs.
- Active grants show a countdown; the requester or an operator can revoke them early. A background check marks
  elapsed grants as expired.
- Every step is written to the tamper-evident change log; the notification events *JitRequested* and *JitGranted* go to
  e-mail, Teams, webhooks and SIEM channels (event IDs `TM-500` and `TM-501`).
- The privileged-group monitoring treats a member as **expected** while a JIT grant for that account (SID) and group
  (SID, or the JIT group on the nesting path) is active, and shows "Erwartet (JIT bis …)".
