# Authentication Policies and Silos

The Tier Model can restrict where Tier 0 and Tier 1 administrators may sign in, using Kerberos **authentication
policies** and **authentication policy silos**. For example, Tier 0 accounts may sign in only from domain controllers,
Tier 0 PAWs and Tier 0 member servers. Everything is configured in `config/tiermodel-authsilos.json` and deployed
and audited by the normal scripts:

```powershell
# Plan, then apply only the authentication policies and silos
.\Deploy-TierModel.ps1 -PreferredDc DC01.contoso.com -AuthSilosOnly
.\Deploy-TierModel.ps1 -PreferredDc DC01.contoso.com -AuthSilosOnly -ConfirmApply

# Audit them
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -AuthSilosOnly -OutputFormat Json -OutputFileBase authsilos
```

`-FullDeployment` runs this phase **last** (phase 11, after OUs, groups, users, ACLs, GPOs, ADMX and the `-Include*`
features), but only when `tiermodel-authsilos.json` exists and has at least one entry. When applying, the phase is
planned again, so device groups and accounts created by the earlier phases are already found. If an earlier phase
reported errors, this phase is skipped. `Audit-TierModel.ps1 -FullDeployment` audits the phase under the same
condition.

This replaces the scripts in `optional/TierModel-AuthSilos`. Those scripts still work, but they only created
authentication *policies* and assigned them to users directly. The config-driven implementation also creates real
silos, keeps the device groups filled and can be audited.

## What is deployed

| Step | Action (plan) | AD cmdlet |
|------|---------------|-----------|
| Device groups: add computers from the source OUs | `AddDeviceGroupMember` | `Add-ADGroupMember` |
| Create or update authentication policies | `CreateAuthPolicy` / `UpdateAuthPolicy` | `New-/Set-ADAuthenticationPolicy` |
| Create or update silos | `CreateAuthSilo` / `UpdateAuthSilo` | `New-/Set-ADAuthenticationPolicySilo` |
| Permit accounts in the silo (`msDS-AuthNPolicySiloMembers`) | `GrantSiloAccess` | `Grant-ADAuthenticationPolicySiloAccess` |
| Assign accounts to the silo (`msDS-AssignedAuthNPolicySilo`) | `AssignSilo` | `Set-ADAccountAuthenticationPolicySilo` |

The actions run in this order, so a device group is filled before a policy refers to it. All actions use the usual
plan shape `{ Action, ResourceType, Name, Path, Data }`. In the JSON plan (`-PlanOutputPath`) they appear with area
`authsilos`: `Create*` actions count as *create*, `Update*` and `AddDeviceGroupMember` as *update*, and
`GrantSiloAccess` and `AssignSilo` as *configure*.

Not changed automatically:

- Members of a device group that are not in one of its source OUs. The audit reports them as `Unexpected`; remove
  them yourself after a review.
- Accounts that leave a silo's OU. They stay permitted in and assigned to the silo until you remove them
  (`Revoke-ADAuthenticationPolicySiloAccess`, `Set-ADAccountAuthenticationPolicySilo -AuthenticationPolicySilo $null`).
- Protected Users membership, the *account is sensitive and cannot be delegated* flag, and removing out-of-tier
  users from privileged groups. The old `Update-Tier*AuthSiloUsers.ps1` scripts did these things. See
  [Protected Users](#protected-users).

The module functions are `Get-TierModelAuthSilo` (plan), `New-TierModelAuthSilo` (apply), `Test-TierModelAuthSilo`
(audit) and `New-TierModelAuthSiloSddl` (builds the SDDL; it does not access AD).

## Configuration

`config/tiermodel-authsilos.json` has three flat lists. Names and paths follow the other configuration files
(`{{DOMAIN_DN}}` is replaced with the domain DN). You never write SDDL yourself; it is generated from the fields
below.

```json
{
  "version": "1.0.0",
  "comment": "...",
  "authenticationPolicies": [
    {
      "name": "Tier 0 Authentication Policy",
      "description": "Tier 0 accounts may only sign in from domain controllers, Tier 0 PAW devices and Tier 0 member servers",
      "enforce": false,
      "userTgtLifetimeMins": 240,
      "allowedToAuthenticateFrom": {
        "includeDomainControllers": true,
        "deviceGroups": [ "Tier0PAWDevices", "Tier0MemberServers" ]
      },
      "comment": ""
    }
  ],
  "authenticationPolicySilos": [
    {
      "name": "Tier 0 Authentication Silo",
      "description": "Tier 0 administrative accounts",
      "enforce": false,
      "userAuthenticationPolicy": "Tier 0 Authentication Policy",
      "computerAuthenticationPolicy": "",
      "serviceAuthenticationPolicy": "",
      "members": {
        "userOUs": [ "OU=Tier 0 Accounts,OU=Tier 0,OU=Tier Model Administration,{{DOMAIN_DN}}" ],
        "computerGroups": [],
        "computerOUs": [],
        "excludeAccounts": []
      },
      "comment": ""
    }
  ],
  "deviceGroupSync": [
    { "group": "Tier0PAWDevices", "sourceOUs": [ "OU=Tier 0 PAW Devices,OU=Tier 0,OU=Tier Model Administration,{{DOMAIN_DN}}" ] }
  ]
}
```

### `authenticationPolicies`

| Field | Type | Meaning |
|-------|------|---------|
| `name` | string, required | Name of the policy (`CN=<name>,CN=AuthN Policies,CN=AuthN Policy Configuration,CN=Services,CN=Configuration,...`). |
| `description` | string | Description. |
| `enforce` | bool | `false` = audit mode: violations are only logged. `true` = violations are blocked. |
| `userTgtLifetimeMins` | int or null | TGT lifetime of the user accounts in minutes (at least 45). `null` leaves the AD value unchanged. |
| `allowedToAuthenticateFrom.includeDomainControllers` | bool | Users may sign in from any domain controller (*Enterprise Domain Controllers*). |
| `allowedToAuthenticateFrom.deviceGroups` | string[] | sAMAccountNames of computer groups. Users may sign in from any computer that is a member of **any** of these groups. Built-in groups (for example `Domain Controllers`) are resolved by SID, so localized names do not matter. |
| `tier` | int, optional | Tier used for the audit severity. Without it, the tier is taken from the names (`Tier 0`, `Tier0`, ...). |
| `comment` | string | Free text. |

When `includeDomainControllers` is `false` and `deviceGroups` is empty, the policy has no device condition and the
plan shows a warning.

### `authenticationPolicySilos`

| Field | Type | Meaning |
|-------|------|---------|
| `name` | string, required | Name of the silo. |
| `description` | string | Description. |
| `enforce` | bool | `false` = audit mode. `true` = the silo's policies are enforced for its members. |
| `userAuthenticationPolicy` | string | Name of the policy for user accounts in the silo (usually one of `authenticationPolicies`). |
| `computerAuthenticationPolicy` | string | Policy for computer accounts in the silo (empty = none). |
| `serviceAuthenticationPolicy` | string | Policy for managed service accounts in the silo (empty = none). |
| `members.userOUs` | string[] | All users below these OUs (subtree) are permitted in and assigned to the silo. |
| `members.computerGroups` | string[] | Computers that are direct members of these groups are added to the silo. |
| `members.computerOUs` | string[] | All computers below these OUs are added to the silo. |
| `members.excludeAccounts` | string[] | sAMAccountNames that are never added (for example an account that needs NTLM). |
| `tier` | int, optional | Tier used for the audit severity (see above). |
| `comment` | string | Free text. |

A silo only takes effect for an account that is both permitted in the silo and assigned to it. The deployment does
both.

### `deviceGroupSync`

| Field | Type | Meaning |
|-------|------|---------|
| `group` | string, required | sAMAccountName of the device group. |
| `sourceOUs` | string[], required | All computers below these OUs (subtree) are added to the group. |
| `tier` | int, optional | Tier used for the audit severity. |
| `comment` | string | Free text. |

This replaces `Update-Tier{0,1}{MemberServers,PAWDevices}.ps1`. Computers are only added, never removed; see
*Not changed automatically* above.

### Default content

The shipped file covers what the optional scripts did, using groups and OUs from `tiermodel-groups.json` and
`tiermodel-ous.json`:

| Object | Content |
|--------|---------|
| Tier 0 Authentication Policy | TGT 240 min; sign-in from domain controllers or `Tier0PAWDevices` or `Tier0MemberServers` |
| Tier 1 Authentication Policy | TGT 240 min; sign-in from `Tier1PAWDevices` or `Tier1MemberServers` |
| Tier 0 / Tier 1 Authentication Silo | user policy of the same tier; members are all users in `Tier N Accounts` |
| Device groups | `Tier0PAWDevices`, `Tier0MemberServers`, `Tier1PAWDevices`, `Tier1MemberServers` are filled from the PAW Devices and Member Servers OUs of their tier |

Every policy and silo ships with `enforce: false`.

## Generated SDDL

`msDS-UserAllowedToAuthenticateFrom` contains one conditional ACE. The condition is checked against the **device**
the user signs in from (Kerberos armoring/compound authentication), so `Member_of` means "the device is a member of".

| Configuration | Generated value |
|---------------|-----------------|
| Domain controllers only | `O:SYG:SYD:(XA;OICI;CR;;;WD;(Member_of {SID(ED)}))` |
| Device groups only | `O:SYG:SYD:(XA;OICI;CR;;;WD;(Member_of_any {SID(S-1-5-21-…-1105), SID(S-1-5-21-…-1106)}))` |
| Both | `O:SYG:SYD:(XA;OICI;CR;;;WD;((Member_of {SID(ED)}) \|\| (Member_of_any {SID(S-1-5-21-…-1105), SID(S-1-5-21-…-1106)})))` |

- `XA` is a callback (conditional) allow ACE. It grants Control Access (`CR`) to Everyone (`WD`) when the condition is
  true. Owner and group are Local System (`O:SY G:SY`).
- `ED` is the SDDL alias of *Enterprise Domain Controllers* (`S-1-5-9`), which is in the token of every DC in the
  forest.
- `Member_of_any {A, B}` is true when the device is in **at least one** of the groups. `Member_of {A, B}` would
  require membership in **all** of them. The old optional script combined the groups with `&&` (in both groups),
  which blocked sign-in from a PAW that is not also a member server. The OR form is the intended one; the optional
  script has been corrected as well.
- Group SIDs are resolved with `Get-ADGroup` against the preferred DC, and built-in groups through the well-known SID
  table. When a device group does not exist yet (for example in a `-FullDeployment` plan before phase 2 has run),
  the plan shows a warning and the SDDL is generated when the plan is applied.
- The audit and the plan compare conditions semantically: whitespace and `ED`/`S-1-5-9` do not count as drift, but a
  different set of SIDs or a `&&` condition does.

## Prerequisites

- **Domain functional level Windows Server 2012 R2 or later.** Below that, the plan contains the error
  `AuthSiloDomainFunctionalLevel` with the current level, no actions are planned, and the audit reports a
  High-severity error finding.
- **KDC support for claims, compound authentication and Kerberos armoring** must be enabled on all domain
  controllers: *Computer Configuration > Policies > Administrative Templates > System > KDC* set to *Supported*, in
  a GPO linked to the Domain Controllers OU. Without it the device condition cannot be evaluated.
- **Kerberos client support for claims, compound authentication and Kerberos armoring** must be enabled on the
  devices that users sign in from (PAWs, member servers): *System > Kerberos*. Device conditions only work with
  Kerberos armoring (FAST). A device condition cannot be checked for NTLM sign-ins,
  so plan for silo members not being able to use NTLM once the policy is enforced.
- **Permissions:** creating policies and silos writes to the configuration partition, so Enterprise Admins or
  equivalent rights are needed. Assigning accounts and filling groups needs write access to those objects.
- The target groups and OUs must exist. `-FullDeployment` creates them in the earlier phases.

### Protected Users

Tier 0 and Tier 1 administrators should also be members of **Protected Users**. The deployment does not change
this. Keep in mind:

- Members cannot use NTLM, DES or RC4, cannot be delegated, and their credentials are not cached. Test
  applications and scripts that still need NTLM before you add accounts. Use `excludeAccounts` for accounts that
  must not be in a silo.
- The default TGT lifetime of Protected Users is 4 hours (240 minutes). An authentication policy assigned through a
  silo replaces it with `userTgtLifetimeMins`, so keep the value at 240 or lower.
- Service accounts, gMSAs and computer accounts must not be added to Protected Users.

## Rollout

1. **Plan:** `Deploy-TierModel.ps1 -AuthSilosOnly` (or `-FullDeployment`). Check the warnings, especially for
   missing device groups or OUs.
2. **Apply in audit mode:** keep `enforce: false` for all policies and silos and run with `-ConfirmApply`. Nothing is
   blocked yet.
3. **Watch the audit events** for at least one full admin work cycle (including rarely used jump hosts and
   break-glass procedures). On the domain controllers, check *Applications and Services Logs > Microsoft > Windows >
   Authentication*: `AuthenticationPolicyFailures-DomainController` and `ProtectedUserFailures-DomainController`
   (enable the logs if they are disabled). Every event is a sign-in that would be blocked once the policy is
   enforced: add the missing device to the right device OU or group, or fix the user's workflow.
4. **Enforce step by step:** set `enforce: true` on the Tier 1 policy and silo first, then Tier 0. The plan warns
   about every enforced policy. Keep a break-glass account that is **not** in any silo, and do not run the deployment
   with an account that you are about to lock out.
5. **Audit regularly:** `Audit-TierModel.ps1 -AuthSilosOnly` (or the TierModel service) reports new accounts that are
   not yet in the silo, computers missing from a device group, unexpected device group members and changed policies.

## Audit findings

`Test-TierModelAuthSilo` uses the same comparison as the plan and returns one finding per difference:

| Type | ResourceType | Meaning |
|------|--------------|---------|
| `Missing` | `AuthenticationPolicy` / `AuthenticationPolicySilo` | The policy or silo does not exist. |
| `Mismatch` | `AuthenticationPolicy` / `AuthenticationPolicySilo` | Properties differ; `Property` lists the fields (for example `enforce, allowedToAuthenticateFrom`). |
| `Missing` | `AuthenticationPolicySiloMember` | The account is not permitted in the silo. |
| `Mismatch` | `AuthenticationPolicySiloAssignment` | The account is assigned to another silo or to none. |
| `Missing` | `DeviceGroupMember` | A computer from a source OU is not in the device group. |
| `Unexpected` | `DeviceGroupMember` | A group member is not in any source OU (reported only). |
| `Error` | `AuthenticationPolicy` | For example, the domain functional level is too low. |

Every finding has `Type`, `ResourceType`, `Identifier`, `Property`, `ExpectedValue`, `ActualValue`, `Details`,
`Tier`, `Area = "authsilos"` and `Severity`: **High** for Tier 0 objects and errors, **Medium** otherwise.

## Migrating from `optional/TierModel-AuthSilos`

- The old scripts created policies named `*- Tier 0 Authentication Silo` / `*- Tier 1 Authentication Silo` with the
  `&&` condition and assigned them **directly** to users (`msDS-AssignedAuthNPolicy`). They did not create silos.
- To keep the existing policy objects, set the `name` of the policies in `tiermodel-authsilos.json` to the old names.
  The next deployment then plans an `UpdateAuthPolicy` that fixes the condition.
- Remove the direct policy assignment from the users (`Set-ADUser <user> -AuthenticationPolicy $null`) once they are
  assigned to the silo. The deployment does not remove direct assignments.
- Disable the scheduled tasks (`ScheduleTask-GPO`, `ScheduleTask-Local`) after the first successful deployment.
  Instead, run `Deploy-TierModel.ps1 -AuthSilosOnly -ConfirmApply -Unattended` on a schedule (for example from the
  TierModel service) so new PAWs, servers and admin accounts are picked up.

## Tests

`tests/Unit.AuthSiloOperations.Tests.ps1` covers SDDL generation (domain controllers only, groups only, both,
invalid input), SID resolution of built-in groups independent of language, plan diffs (create, update, no-op, `&&`
drift, domain functional level, missing groups), apply (order, SDDL regenerated when applied, partial failures,
`-WhatIf`), audit findings and severity, the audit report merge, config loading and consistency with the groups/OUs
configuration, and the plan export area. The AD authentication policy cmdlets are stubbed in
`tests/helpers/ADStubs.ps1`.
