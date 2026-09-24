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
name=$(echo "$call" | grep -oE "(Deploy|Audit)-TierModel\.ps1")
logpath=$(echo "$call" | sed -nE "s/.*-LogPath '([^']*)'.*/\1/p")
base=$(echo "$call" | sed -nE "s/.*-OutputFileBase ([A-Za-z]+).*/\1/p")
echo "Deploy TierModel orchestration starting." ; echo "Call: $call"
echo "Umlaute: Domänen-Admins ✓"
for i in 1 2 3 4 5; do echo "[$i/5] Processing step $i ..."; sleep 0.4; done
echo "WARNING: OU 'Tier 1 Accounts' has unexpected ACE"
echo "Failed to resolve principal 'Foo'" >&2
if [ "$name" = "Audit-TierModel.ps1" ]; then
  mkdir -p "$logpath"
  cat > "$logpath/$base-$(date +%m%d%y-%H%M).json" <<J
{ "auditSummary": { "TotalChecked": 158, "DriftCount": 2, "MissingCount": 1, "UnexpectedCount": 0, "MismatchCount": 1, "OrphanedGpoLinkCount": 0, "SecurityDeltaCount": 0 },
  "driftFindings": [
    { "Type": "Missing", "ResourceType": "OU", "Identifier": "OU=Tier 1 Accounts,OU=Tier 1,OU=Tier Model Administration,DC=contoso,DC=local", "Details": "OU does not exist" },
    { "Type": "Mismatch", "ResourceType": "Group", "Identifier": "Tier0Admins", "Details": "groupscope: expected Universal, actual Global" } ],
  "metadata": { "scope": "FullDeployment" } }
J
fi
# Deploy in plan mode (no -ConfirmApply): write out/deploy-plan.json like Deploy-TierModel.ps1 does.
# A DC name containing "noplan" skips the file, "badplan" writes a broken one (to exercise the service's fallbacks).
if [ "$name" = "Deploy-TierModel.ps1" ] && ! echo "$call" | grep -q -- "-ConfirmApply"; then
  mkdir -p "$logpath"
  dc=$(echo "$call" | sed -nE "s/.*-PreferredDc '([^']*)'.*/\1/p")
  scope=$(echo "$call" | grep -oE -- "-(FullDeployment|OuOnly|GroupOnly|UserOnly|GposOnly|OuAclsOnly|AdmxOnly)" | head -1 | tr -d -)
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
  n=${#actions[@]}
  count() { local c=0; for a in "${actions[@]}"; do echo "$a" | grep -qE "\"action\":\"$1" && c=$((c+1)); done; echo $c; }
  create=$(( $(count Create) + $(count Import) + $(count Copy) )); update=$(count Update); link=$(count Link); configure=$(count Configure)
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
