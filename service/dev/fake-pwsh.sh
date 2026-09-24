#!/usr/bin/env bash
# Development stand-in for pwsh: mimics the output of Deploy/Audit-TierModel.ps1
# so the run pipeline can be exercised without Active Directory.
# The service calls: pwsh ... -File <run folder>/run.ps1 — read the real call from that wrapper.
wrapper=""; prev=""
for a in "$@"; do
  [ "$prev" = "-File" ] && wrapper="$a"
  prev="$a"
done
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
echo "Total Errors: 0"
echo "Script completed successfully."
exit 0
