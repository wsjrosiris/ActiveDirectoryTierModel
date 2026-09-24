#!/usr/bin/env bash
# Development stand-in for pwsh: mimics the output of Deploy/Audit-TierModel.ps1
# so the run pipeline can be exercised without Active Directory.
# The service calls: pwsh ... -File <run folder>/run.ps1 — read the real call from that wrapper.
wrapper=""; prev=""; command=""
for a in "$@"; do
  [ "$prev" = "-File" ] && wrapper="$a"
  [ "$prev" = "-Command" ] && command="$a"
  prev="$a"
done
# Health page: pwsh -Command $PSVersionTable.PSVersion.ToString()
if [ -n "$command" ]; then
  case "$command" in *PSVersion*) echo "7.4.6"; exit 0 ;; esac
  echo "fake-pwsh: -Command not supported" >&2; exit 1
fi
call=$(grep -E "^& " "$wrapper")
name=$(echo "$call" | grep -oE "(Deploy|Audit)-TierModel\.ps1|Watch-TierModelPrivilegedGroups\.ps1")
# Watch-TierModelPrivilegedGroups.ps1: write a privileged.json per the contract. The content rotates through three states
# (counter file next to the run folders), so consecutive runs show added/removed members and new findings.
# A DC name containing "nomon" writes no file, "badmon" a broken one.
if [ "$name" = "Watch-TierModelPrivilegedGroups.ps1" ]; then
  out=$(echo "$call" | sed -nE "s/.*-OutputPath '([^']*)'.*/\1/p")
  dc=$(echo "$call" | sed -nE "s/.*-PreferredDc '([^']*)'.*/\1/p")
  counter="$(dirname "$(dirname "$wrapper")")/.fake-monitor-counter"
  n=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 )); echo $n > "$counter"
  state=$(( (n - 1) % 3 ))
  echo "Watch TierModel privileged groups (fake), state $state"
  echo "Reading protected groups from $dc ..."; sleep 0.3
  mkdir -p "$(dirname "$out")"
  if echo "$dc" | grep -q nomon; then echo "Snapshot skipped (fake: DC name contains 'nomon')"; echo "Script completed successfully."; exit 0; fi
  if echo "$dc" | grep -q badmon; then echo '{ "metadata": { "version": "1", ' > "$out"; echo "Script completed successfully."; exit 0; fi
  D="S-1-5-21-1004336348-1177238915-682003330"; B="DC=contoso,DC=local"
  T0="OU=Tier 0 Accounts,OU=Tier 0,OU=Tier Model Administration,$B"
  ago() { date -u -d "-$1 days" +%Y-%m-%dT%H:%M:%SZ; }
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  admin='{ "sid": "'$D'-500", "samAccountName": "Administrator", "name": "Administrator", "objectClass": "user", "distinguishedName": "CN=Administrator,CN=Users,'$B'", "direct": true, "via": [], "enabled": true }'
  alice_via='{ "sid": "'$D'-1201", "samAccountName": "t0-alice", "name": "Alice Admin (T0)", "objectClass": "user", "distinguishedName": "CN=Alice Admin (T0),'$T0'", "direct": false, "via": ["Tier 0 Admins"], "enabled": true }'
  jan='{ "sid": "'$D'-2301", "samAccountName": "helpdesk-jan", "name": "Jan Helpdesk", "objectClass": "user", "distinguishedName": "CN=Jan Helpdesk,OU=Users,OU=Tier 2,OU=Tier Model Administration,'$B'", "direct": true, "via": [], "enabled": true }'
  da_members="$admin,"'
      { "sid": "'$D'-1105", "samAccountName": "Tier0Admins", "name": "Tier 0 Admins", "objectClass": "group", "distinguishedName": "CN=Tier 0 Admins,OU=Tier 0 Groups,OU=Tier 0,OU=Tier Model Administration,'$B'", "direct": true, "via": [], "enabled": null },'"
      $alice_via"
  [ $state -eq 1 ] && da_members="$da_members, $jan"
  t0_members='{ "sid": "'$D'-1201", "samAccountName": "t0-alice", "name": "Alice Admin (T0)", "objectClass": "user", "distinguishedName": "CN=Alice Admin (T0),'$T0'", "direct": true, "via": [], "enabled": true }'
  [ $state -ne 1 ] && t0_members="$t0_members"', { "sid": "'$D'-1202", "samAccountName": "t0-bob", "name": "Bob Admin (T0)", "objectClass": "user", "distinguishedName": "CN=Bob Admin (T0),'$T0'", "direct": true, "via": [], "enabled": true }'
  [ $state -eq 2 ] && t0_members="$t0_members"', { "sid": "'$D'-1203", "samAccountName": "t0-carol", "name": "Carol Admin (T0)", "objectClass": "user", "distinguishedName": "CN=Carol Admin (T0),'$T0'", "direct": true, "via": [], "enabled": true }'
  jan_account=""; [ $state -eq 1 ] && jan_account=', { "sid": "'$D'-2301", "samAccountName": "helpdesk-jan", "distinguishedName": "CN=Jan Helpdesk,OU=Users,OU=Tier 2,OU=Tier Model Administration,'$B'", "objectClass": "user", "tier": 0, "enabled": true, "lastLogon": "'$(ago 1)'", "passwordLastSet": "'$(ago 40)'", "passwordNeverExpires": false, "accountNotDelegated": false, "protectedUsers": false, "adminCount": 1, "servicePrincipalNames": [], "memberOfPrivileged": ["Domain Admins", "Administrators"] }'
  extra_acl=""; [ $state -eq 2 ] && extra_acl=', { "objectDn": "OU=Tier 0,OU=Tier Model Administration,'$B'", "objectType": "Tier0OU", "objectName": "Tier 0", "principalSid": "'$D'-1310", "principalName": "CONTOSO\\Tier1ServerOperators", "principalClass": "group", "rights": ["WriteOwner"], "objectTypeGuid": null, "inherited": false, "memberCount": 4, "sampleMembers": ["t1-dave", "t1-erik", "t1-fatma", "t1-gregor"] }'
  cat > "$out" <<J
{
  "metadata": { "version": "1", "preferredDc": "$dc", "timestamp": "$now", "domain": "contoso.local", "domainSid": "$D", "forestRootDomain": "contoso.local", "isForestRoot": true },
  "groups": [
    { "sid": "S-1-5-32-544", "name": "Administratoren", "wellKnownName": "Administrators", "source": "builtin", "tier": 0, "distinguishedName": "CN=Administratoren,CN=Builtin,$B",
      "members": [ $admin,
        { "sid": "$D-512", "samAccountName": "Domänen-Admins", "name": "Domänen-Admins", "objectClass": "group", "distinguishedName": "CN=Domänen-Admins,CN=Users,$B", "direct": true, "via": [], "enabled": null },
        { "sid": "$D-519", "samAccountName": "Organisations-Admins", "name": "Organisations-Admins", "objectClass": "group", "distinguishedName": "CN=Organisations-Admins,CN=Users,$B", "direct": true, "via": [], "enabled": null },
        { "sid": "$D-1105", "samAccountName": "Tier0Admins", "name": "Tier 0 Admins", "objectClass": "group", "distinguishedName": "CN=Tier 0 Admins,OU=Tier 0 Groups,OU=Tier 0,OU=Tier Model Administration,$B", "direct": false, "via": ["Domänen-Admins"], "enabled": null },
        { "sid": "$D-1201", "samAccountName": "t0-alice", "name": "Alice Admin (T0)", "objectClass": "user", "distinguishedName": "CN=Alice Admin (T0),$T0", "direct": false, "via": ["Domänen-Admins", "Tier 0 Admins"], "enabled": true } ] },
    { "sid": "$D-512", "name": "Domänen-Admins", "wellKnownName": "Domain Admins", "source": "builtin", "tier": 0, "distinguishedName": "CN=Domänen-Admins,CN=Users,$B",
      "members": [ $da_members ] },
    { "sid": "$D-519", "name": "Organisations-Admins", "wellKnownName": "Enterprise Admins", "source": "builtin", "tier": 0, "distinguishedName": "CN=Organisations-Admins,CN=Users,$B", "members": [ $admin ] },
    { "sid": "$D-518", "name": "Schema-Admins", "wellKnownName": "Schema Admins", "source": "builtin", "tier": 0, "distinguishedName": "CN=Schema-Admins,CN=Users,$B", "members": [ $admin ] },
    { "sid": "$D-516", "name": "Domänencontroller", "wellKnownName": "Domain Controllers", "source": "builtin", "tier": 0, "distinguishedName": "CN=Domänencontroller,CN=Users,$B",
      "members": [
        { "sid": "$D-1001", "samAccountName": "DC01\$", "name": "DC01", "objectClass": "computer", "distinguishedName": "CN=DC01,OU=Domain Controllers,$B", "direct": true, "via": [], "enabled": true },
        { "sid": "$D-1002", "samAccountName": "DC02\$", "name": "DC02", "objectClass": "computer", "distinguishedName": "CN=DC02,OU=Domain Controllers,$B", "direct": true, "via": [], "enabled": true } ] },
    { "sid": "S-1-5-32-551", "name": "Sicherungs-Operatoren", "wellKnownName": "Backup Operators", "source": "builtin", "tier": 0, "distinguishedName": "CN=Sicherungs-Operatoren,CN=Builtin,$B",
      "members": [
        { "sid": "$D-1401", "samAccountName": "svc-backup", "name": "svc-backup", "objectClass": "user", "distinguishedName": "CN=svc-backup,OU=Tier 1 Service Accounts,OU=Tier 1,OU=Tier Model Administration,$B", "direct": true, "via": [], "enabled": true },
        { "sid": "$D-1402", "samAccountName": "t1-old", "name": "t1-old", "objectClass": "user", "distinguishedName": "CN=t1-old,OU=Tier 1 Accounts,OU=Tier 1,OU=Tier Model Administration,$B", "direct": true, "via": [], "enabled": false } ] },
    { "sid": "$D-1105", "name": "Tier 0 Admins", "wellKnownName": null, "source": "config", "tier": 0, "distinguishedName": "CN=Tier 0 Admins,OU=Tier 0 Groups,OU=Tier 0,OU=Tier Model Administration,$B",
      "members": [ $t0_members ] },
    { "sid": "$D-1111", "name": "Tier 0 Service Accounts", "wellKnownName": null, "source": "config", "tier": 0, "distinguishedName": "CN=Tier 0 Service Accounts,OU=Tier 0 Groups,OU=Tier 0,OU=Tier Model Administration,$B",
      "members": [
        { "sid": "$D-1501", "samAccountName": "svc-t0-sync", "name": "svc-t0-sync", "objectClass": "user", "distinguishedName": "CN=svc-t0-sync,OU=Tier 0 Service Accounts,OU=Tier 0,OU=Tier Model Administration,$B", "direct": true, "via": [], "enabled": true } ] }
  ],
  "accounts": [
    { "sid": "$D-500", "samAccountName": "Administrator", "distinguishedName": "CN=Administrator,CN=Users,$B", "objectClass": "user", "tier": 0, "enabled": true, "lastLogon": "$(ago 3)", "passwordLastSet": "$(ago 412)", "passwordNeverExpires": false, "accountNotDelegated": false, "protectedUsers": false, "adminCount": 1, "servicePrincipalNames": [], "memberOfPrivileged": ["Administrators", "Domain Admins", "Enterprise Admins", "Schema Admins"] },
    { "sid": "$D-1201", "samAccountName": "t0-alice", "distinguishedName": "CN=Alice Admin (T0),$T0", "objectClass": "user", "tier": 0, "enabled": true, "lastLogon": "$(ago 1)", "passwordLastSet": "$(ago 30)", "passwordNeverExpires": false, "accountNotDelegated": true, "protectedUsers": true, "adminCount": 1, "servicePrincipalNames": [], "memberOfPrivileged": ["Tier 0 Admins", "Domain Admins", "Administrators"] },
    { "sid": "$D-1202", "samAccountName": "t0-bob", "distinguishedName": "CN=Bob Admin (T0),$T0", "objectClass": "user", "tier": 0, "enabled": true, "lastLogon": "$(ago 204)", "passwordLastSet": "$(ago 210)", "passwordNeverExpires": true, "accountNotDelegated": true, "protectedUsers": true, "adminCount": 1, "servicePrincipalNames": [], "memberOfPrivileged": ["Tier 0 Admins"] },
    { "sid": "$D-1501", "samAccountName": "svc-t0-sync", "distinguishedName": "CN=svc-t0-sync,OU=Tier 0 Service Accounts,OU=Tier 0,OU=Tier Model Administration,$B", "objectClass": "user", "tier": 0, "enabled": true, "lastLogon": "$(ago 0)", "passwordLastSet": "$(ago 800)", "passwordNeverExpires": true, "accountNotDelegated": false, "protectedUsers": false, "adminCount": 1, "servicePrincipalNames": ["MSSQLSvc/sql01.contoso.local:1433"], "memberOfPrivileged": ["Tier 0 Service Accounts"] },
    { "sid": "$D-1401", "samAccountName": "svc-backup", "distinguishedName": "CN=svc-backup,OU=Tier 1 Service Accounts,OU=Tier 1,OU=Tier Model Administration,$B", "objectClass": "user", "tier": 0, "enabled": true, "lastLogon": "$(ago 2)", "passwordLastSet": "$(ago 100)", "passwordNeverExpires": false, "accountNotDelegated": true, "protectedUsers": false, "adminCount": 1, "servicePrincipalNames": ["backup/bkp01.contoso.local"], "memberOfPrivileged": ["Backup Operators"] },
    { "sid": "$D-1402", "samAccountName": "t1-old", "distinguishedName": "CN=t1-old,OU=Tier 1 Accounts,OU=Tier 1,OU=Tier Model Administration,$B", "objectClass": "user", "tier": 0, "enabled": false, "lastLogon": "$(ago 500)", "passwordLastSet": "$(ago 600)", "passwordNeverExpires": false, "accountNotDelegated": false, "protectedUsers": false, "adminCount": 1, "servicePrincipalNames": [], "memberOfPrivileged": ["Backup Operators"] },
    { "sid": "$D-1601", "samAccountName": "t1-dave", "distinguishedName": "CN=t1-dave,OU=Tier 1 Accounts,OU=Tier 1,OU=Tier Model Administration,$B", "objectClass": "user", "tier": 1, "enabled": true, "lastLogon": null, "passwordLastSet": "$(ago 20)", "passwordNeverExpires": false, "accountNotDelegated": false, "protectedUsers": false, "adminCount": null, "servicePrincipalNames": [], "memberOfPrivileged": [] },
    { "sid": "$D-1001", "samAccountName": "DC01\$", "distinguishedName": "CN=DC01,OU=Domain Controllers,$B", "objectClass": "computer", "tier": 0, "enabled": true, "lastLogon": "$(ago 0)", "passwordLastSet": "$(ago 12)", "passwordNeverExpires": false, "accountNotDelegated": false, "protectedUsers": false, "adminCount": null, "servicePrincipalNames": ["ldap/dc01.contoso.local"], "memberOfPrivileged": ["Domain Controllers"] }$jan_account
  ],
  "adminCountOrphans": [
    { "sid": "$D-1701", "samAccountName": "ehemals-admin", "distinguishedName": "CN=ehemals-admin,OU=Users,OU=Tier 2,OU=Tier Model Administration,$B", "objectClass": "user" }
  ],
  "aclFindings": [
    { "objectDn": "CN=Domänen-Admins,CN=Users,$B", "objectType": "ProtectedGroup", "objectName": "Domänen-Admins", "principalSid": "$D-1301", "principalName": "CONTOSO\\\\Helpdesk", "principalClass": "group", "rights": ["WriteDacl"], "objectTypeGuid": null, "inherited": false, "memberCount": 12, "sampleMembers": ["helpdesk-jan", "helpdesk-lea", "helpdesk-max"] },
    { "objectDn": "$B", "objectType": "DomainRoot", "objectName": "contoso.local", "principalSid": "$D-1302", "principalName": "CONTOSO\\\\svc-legacy-sync", "principalClass": "user", "rights": ["AllExtendedRights"], "objectTypeGuid": null, "inherited": false, "memberCount": null, "sampleMembers": [] },
    { "objectDn": "OU=Tier 0,OU=Tier Model Administration,$B", "objectType": "Tier0OU", "objectName": "Tier 0", "principalSid": "$D-1106", "principalName": "CONTOSO\\\\Tier0Operators", "principalClass": "group", "rights": ["GenericWrite"], "objectTypeGuid": null, "inherited": false, "memberCount": 2, "sampleMembers": ["t0-alice", "t0-bob"] }$extra_acl
  ],
  "errors": []
}
J
  echo "Snapshot written: $out"
  echo "Script completed successfully."
  exit 0
fi
logpath=$(echo "$call" | sed -nE "s/.*-LogPath '([^']*)'.*/\1/p")
base=$(echo "$call" | sed -nE "s/.*-OutputFileBase ([A-Za-z]+).*/\1/p")
echo "Deploy TierModel orchestration starting." ; echo "Call: $call"
echo "Umlaute: Domänen-Admins ✓"
for i in 1 2 3 4 5; do echo "[$i/5] Processing step $i ..."; sleep 0.4; done
echo "WARNING: OU 'Tier 1 Accounts' has unexpected ACE"
echo "Failed to resolve principal 'Foo'" >&2
if [ "$name" = "Audit-TierModel.ps1" ] && echo "$call" | grep -q -- "-AuthSilosOnly"; then
  mkdir -p "$logpath"
  cat > "$logpath/$base-$(date +%m%d%y-%H%M).json" <<J
{ "auditSummary": { "TotalChecked": 24, "DriftCount": 3, "MissingCount": 2, "UnexpectedCount": 0, "MismatchCount": 1, "OrphanedGpoLinkCount": 0, "SecurityDeltaCount": 0 },
  "driftFindings": [
    { "Type": "Mismatch", "ResourceType": "AuthenticationPolicy", "Identifier": "Tier 0 Authentication Policy", "Property": "enforce, allowedToAuthenticateFrom", "ExpectedValue": "Member_of_any Tier0PAWDevices, Tier0MemberServers", "ActualValue": "Member_of Tier0PAWDevices && Tier0MemberServers", "Details": "Device condition uses && instead of ||", "Area": "authsilos", "Tier": 0, "Severity": "High" },
    { "Type": "Missing", "ResourceType": "AuthenticationPolicySiloMember", "Identifier": "t0-carol -> Tier 0 Authentication Silo", "Details": "Account is not permitted in the silo", "Area": "authsilos", "Tier": 0, "Severity": "High" },
    { "Type": "Missing", "ResourceType": "DeviceGroupMember", "Identifier": "T1-SRV07 -> Tier1MemberServers", "Details": "Computer from source OU is not in the device group", "Area": "authsilos", "Tier": 1, "Severity": "Medium" } ],
  "metadata": { "scope": "AuthSilosOnly" } }
J
elif [ "$name" = "Audit-TierModel.ps1" ]; then
  mkdir -p "$logpath"
  cat > "$logpath/$base-$(date +%m%d%y-%H%M).json" <<J
{ "auditSummary": { "TotalChecked": 158, "DriftCount": 2, "MissingCount": 1, "UnexpectedCount": 0, "MismatchCount": 1, "OrphanedGpoLinkCount": 0, "SecurityDeltaCount": 0 },
  "driftFindings": [
    { "Type": "Missing", "ResourceType": "OU", "Identifier": "OU=Tier 1 Accounts,OU=Tier 1,OU=Tier Model Administration,DC=contoso,DC=local", "Details": "OU does not exist", "Area": "ous", "Severity": "Medium" },
    { "Type": "Mismatch", "ResourceType": "Group", "Identifier": "Tier0Admins", "Details": "groupscope: expected Universal, actual Global", "Area": "groups", "Severity": "High" } ],
  "metadata": { "scope": "FullDeployment" } }
J
fi
# Deploy in plan mode (no -ConfirmApply): write out/deploy-plan.json like Deploy-TierModel.ps1 does.
# A DC name containing "noplan" skips the file, "badplan" writes a broken one (to exercise the service's fallbacks).
if [ "$name" = "Deploy-TierModel.ps1" ] && ! echo "$call" | grep -q -- "-ConfirmApply"; then
  mkdir -p "$logpath"
  dc=$(echo "$call" | sed -nE "s/.*-PreferredDc '([^']*)'.*/\1/p")
  scope=$(echo "$call" | grep -oE -- "-(FullDeployment|OuOnly|GroupOnly|UserOnly|GposOnly|OuAclsOnly|AdmxOnly|AuthSilosOnly)" | head -1 | tr -d -)
  includes=""; for i in Msa Gmsa Dmsa WinLaps; do echo "$call" | grep -q -- "-Include$i" && includes="$includes${includes:+,}\"$i\""; done
  [ -z "$scope" ] && scope="IncludeOnly"
  want() { [ "$scope" = "FullDeployment" ] || [ "$scope" = "$1" ]; }
  base="DC=contoso,DC=local"
  actions=(); phases=()
  add() { actions+=("$1"); }
  if want OuOnly; then
    add '{"phase":1,"area":"ous","action":"CreateOU","resourceType":"OrganizationalUnit","name":"Tier 1 Server Staging","path":"OU=Tier 1 Member Servers,'"$base"'","details":{"protectFromAccidentalDeletion":true,"blockGpoInheritance":true,"description":"Tier 1: Staging server objects"}}'
    add '{"phase":1,"area":"ous","action":"CreateOU","resourceType":"OrganizationalUnit","name":"Tier 2 PAW Devices","path":"OU=Tier 2 End-User Accounts,'"$base"'","details":{"protectFromAccidentalDeletion":true,"blockGpoInheritance":false}}'
    phases+=('{"phase":1,"name":"Organizational Units","area":"ous","actionCount":2,"existingCount":14}')
  fi
  if want GroupOnly; then
    add '{"phase":2,"area":"groups","action":"CreateGroup","resourceType":"Group","name":"Tier1ServerOperators","path":"OU=Groups,OU=Tier 1 Member Servers,'"$base"'","details":{"groupScope":"Universal","groupCategory":"Security","description":"Tier 1 server operators"}}'
    add '{"phase":2,"area":"groups","action":"CreateGroup","resourceType":"Group","name":"Tier2HelpdeskOperators","path":"OU=Groups,OU=Tier 2 End-User Accounts,'"$base"'","details":{"groupScope":"Global","groupCategory":"Security"}}'
    phases+=('{"phase":2,"name":"Groups","area":"groups","actionCount":2,"existingCount":21}')
  fi
  if want UserOnly; then
    add '{"phase":3,"area":"users","action":"CreateUser","resourceType":"User","name":"svc-tier1-backup","path":"OU=Service Accounts,OU=Tier 1 Member Servers,'"$base"'","details":{"enabled":false,"memberOf":["Tier1ServiceAccounts"]}}'
    add '{"phase":3,"area":"users","action":"UpdateUserMembership","resourceType":"User","name":"svc-tier0-sync","path":"OU=Service Accounts,OU=Tier 0 Member Servers,'"$base"'","details":{"group":"Tier0ServiceAccounts","addGroups":["Tier0ServiceAccounts","Protected Users"]}}'
    phases+=('{"phase":3,"name":"Users","area":"users","actionCount":2,"existingCount":6}')
  fi
  if want OuAclsOnly; then
    add '{"phase":4,"area":"acls","action":"CreateAcl","resourceType":"AccessRule","name":"Tier1ServerOperators","path":"OU=Tier 1 Member Servers,'"$base"'","details":{"principal":"CONTOSO\\Tier1ServerOperators","rights":["CreateChild","DeleteChild"],"objectType":"computer","inheritance":"Descendents","accessControlType":"Allow"}}'
    add '{"phase":4,"area":"acls","action":"CreateAcl","resourceType":"AccessRule","name":"Tier2HelpdeskOperators","path":"OU=Tier 2 End-User Accounts,'"$base"'","details":{"principal":"CONTOSO\\Tier2HelpdeskOperators","rights":["ReadProperty","WriteProperty"],"objectType":"user","inheritedObjectType":"user","inheritance":"Descendents","accessControlType":"Allow"}}'
    phases+=('{"phase":4,"name":"OU ACL Delegations","area":"acls","actionCount":2,"existingCount":37}')
  fi
  if want GposOnly; then
    add '{"phase":5,"area":"gpos","action":"CreateGPO","resourceType":"GroupPolicy","name":"CONTOSO - Tier 1 Servers SOE - Computer","path":null,"details":{"gpoStatus":"UserSettingsDisabled","comment":"Standard operating environment for Tier 1 servers"}}'
    add '{"phase":5,"area":"gpos","action":"ImportGPO","resourceType":"GroupPolicy","name":"CONTOSO - Tier Model Account Restrictions","path":null,"details":{"backupId":"{7B2C1E0D-4E5F-4A1B-9C3D-2E1F0A9B8C7D}","importPath":"GPOs\\Tier Model Account Restrictions"}}'
    add '{"phase":5,"area":"gpos","action":"LinkGPO","resourceType":"GPLink","name":"CONTOSO - Tier 1 Servers SOE - Computer","path":"OU=Tier 1 Member Servers,'"$base"'","details":{"linkOrder":1,"linkEnabled":true,"enforced":false}}'
    add '{"phase":5,"area":"gpos","action":"LinkGPO","resourceType":"GPLink","name":"CONTOSO - Tier Model Account Restrictions","path":"'"$base"'","details":{"linkOrder":2,"linkEnabled":true}}'
    phases+=('{"phase":5,"name":"Group Policy Objects","area":"gpos","actionCount":4,"existingCount":18}')
  fi
  if want AdmxOnly; then
    add '{"phase":6,"area":"admx","action":"CopyAdmx","resourceType":"AdmxFile","name":"MSEdge.admx","path":"\\\\contoso.local\\SYSVOL\\contoso.local\\Policies\\PolicyDefinitions","details":{"language":"en-US","files":["MSEdge.admx","en-US\\MSEdge.adml"]}}'
    phases+=('{"phase":6,"name":"ADMX Templates","area":"admx","actionCount":1,"existingCount":42}')
  fi
  case "$includes" in *WinLaps*)
    add '{"phase":7,"area":"winlaps","action":"ConfigureLapsDecryptor","resourceType":"GroupPolicy","name":"CONTOSO - Tier 0 LAPS Decryptor - Computer","path":"OU=Tier 0 Member Servers,'"$base"'","details":{"decryptorGroup":"Tier0Admins","ouDn":"OU=Tier 0 Member Servers,'"$base"'"}}'
    phases+=('{"phase":7,"name":"Windows LAPS","area":"winlaps","actionCount":1,"existingCount":3}') ;;
  esac
  case "$includes" in *\"Gmsa\"*)
    add '{"phase":8,"area":"gmsa","action":"CreateAcl","resourceType":"AccessRule","name":"Tier1ServiceAccounts","path":"OU=Service Accounts,OU=Tier 1 Member Servers,'"$base"'","details":{"principal":"CONTOSO\\Tier1ServerOperators","rights":["CreateChild"],"objectType":"msDS-GroupManagedServiceAccount"}}'
    phases+=('{"phase":8,"name":"gMSA Delegations","area":"gmsa","actionCount":1,"existingCount":2}') ;;
  esac
  if want AuthSilosOnly; then
    add '{"phase":11,"area":"authsilos","action":"AddDeviceGroupMember","resourceType":"DeviceGroupMember","name":"T0-PAW03","path":"CN=T0-PAW03,OU=Tier 0 PAW Devices,OU=Tier 0,OU=Tier Model Administration,'"$base"'","details":{"group":"Tier0PAWDevices","computer":"CN=T0-PAW03,OU=Tier 0 PAW Devices,OU=Tier 0,OU=Tier Model Administration,'"$base"'","sourceOU":"OU=Tier 0 PAW Devices,OU=Tier 0,OU=Tier Model Administration,'"$base"'","tier":0}}'
    add '{"phase":11,"area":"authsilos","action":"CreateAuthPolicy","resourceType":"AuthenticationPolicy","name":"Tier 0 Authentication Policy","path":null,"details":{"description":"Tier 0 accounts may only sign in from domain controllers, Tier 0 PAW devices and Tier 0 member servers","enforce":false,"userTgtLifetimeMins":240,"includeDomainControllers":true,"deviceGroups":["Tier0PAWDevices","Tier0MemberServers"],"deviceGroupSids":["S-1-5-21-1004336348-1177238915-682003330-1105","S-1-5-21-1004336348-1177238915-682003330-1106"],"sddl":"O:SYG:SYD:(XA;OICI;CR;;;WD;((Member_of {SID(ED)}) || (Member_of_any {SID(S-1-5-21-1004336348-1177238915-682003330-1105), SID(S-1-5-21-1004336348-1177238915-682003330-1106)})))","tier":0}}'
    add '{"phase":11,"area":"authsilos","action":"UpdateAuthPolicy","resourceType":"AuthenticationPolicy","name":"Tier 1 Authentication Policy","path":"CN=Tier 1 Authentication Policy,CN=AuthN Policies,CN=AuthN Policy Configuration,CN=Services,CN=Configuration,'"$base"'","details":{"enforce":false,"userTgtLifetimeMins":240,"includeDomainControllers":false,"deviceGroups":["Tier1PAWDevices","Tier1MemberServers"],"changes":["allowedToAuthenticateFrom"],"currentEnforce":false,"currentUserTgtLifetimeMins":240,"tier":1}}'
    add '{"phase":11,"area":"authsilos","action":"CreateAuthSilo","resourceType":"AuthenticationPolicySilo","name":"Tier 0 Authentication Silo","path":null,"details":{"description":"Tier 0 administrative accounts","enforce":false,"userAuthenticationPolicy":"Tier 0 Authentication Policy","computerAuthenticationPolicy":"","serviceAuthenticationPolicy":"","tier":0}}'
    add '{"phase":11,"area":"authsilos","action":"GrantSiloAccess","resourceType":"AuthenticationPolicySiloMember","name":"t0-alice","path":"CN=Alice Admin (T0),OU=Tier 0 Accounts,OU=Tier 0,OU=Tier Model Administration,'"$base"'","details":{"silo":"Tier 0 Authentication Silo","samAccountName":"t0-alice","accountType":"User","tier":0}}'
    add '{"phase":11,"area":"authsilos","action":"AssignSilo","resourceType":"AuthenticationPolicySiloAssignment","name":"t0-alice","path":"CN=Alice Admin (T0),OU=Tier 0 Accounts,OU=Tier 0,OU=Tier Model Administration,'"$base"'","details":{"silo":"Tier 0 Authentication Silo","samAccountName":"t0-alice","accountType":"User","currentSilo":"","tier":0}}'
    phases+=('{"phase":11,"name":"Authentication Policies and Silos","area":"authsilos","actionCount":6,"existingCount":4}')
  fi
  n=${#actions[@]}
  count() { local c=0; for a in "${actions[@]}"; do echo "$a" | grep -qE "\"action\":\"$1" && c=$((c+1)); done; echo $c; }
  create=$(( $(count Create) + $(count Import) + $(count Copy) )); update=$(( $(count Update) + $(count AddDeviceGroupMember) )); link=$(count Link); configure=$(( $(count Configure) + $(count GrantSiloAccess) + $(count AssignSilo) ))
  join() { local IFS=,; echo "$*"; }
  file="$logpath/deploy-plan.json"
  if echo "$dc" | grep -q noplan; then
    echo "Plan file skipped (fake: DC name contains 'noplan')"
  elif echo "$dc" | grep -q badplan; then
    echo '{ "metadata": { "version": "1", ' > "$file"
  else
    cat > "$file" <<J
{ "metadata": { "version": "1", "scope": "$scope", "preferredDc": "$dc", "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "includes": [$includes] },
  "summary": { "totalActions": $n, "create": $create, "update": $update, "link": $link, "configure": $configure, "existing": 141 },
  "phases": [$(join "${phases[@]}")],
  "actions": [$(join "${actions[@]}")],
  "warnings": ["OU 'Tier 1 Accounts' has an unexpected ACE for 'CONTOSO\\\\Helpdesk' – not managed by the Tier Model"],
  "errors": [] }
J
    echo "Plan written: $file ($n actions)"
  fi
fi
echo "Total Errors: 0"
echo "Script completed successfully."
exit 0
