import * as React from 'react'
import { Link } from 'react-router'
import { CheckCircle2, HeartPulse, Search, Settings2 } from 'lucide-react'
import type { PrivilegedOverview, Severity } from '@/api/types'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { SeverityBadge, TierBadge } from '@/components/shared/badges'
import { useCan } from '@/features/auth/auth'
import { objectClassLabels } from '@/lib/labels'

/** What each rule means, shown under the rule name. */
const ruleHints: Record<string, string> = {
  NotInProtectedUsers: 'Tier-0-Konten gehören in „Protected Users“ (kein NTLM, keine Delegierung, kurze Tickets).',
  DelegationAllowed: '„Konto ist vertraulich und kann nicht delegiert werden“ fehlt.',
  PasswordOld: 'Passwort älter als erlaubt.',
  Stale: 'Aktiviert, aber lange nicht angemeldet.',
  HasSpn: 'Mit SPN lässt sich ein Ticket anfordern und das Passwort offline raten (Kerberoasting).',
  PasswordNeverExpires: 'Passwort läuft nie ab.',
  OrphanedAdminCount: 'Früher privilegiert, Berechtigungen weiterhin eingeschränkt.',
  DisabledButPrivileged: 'Deaktiviert, aber noch Mitglied einer privilegierten Gruppe.',
}

export function HygieneTab({ data }: { data: PrivilegedOverview }) {
  const canAdmin = useCan('Admin')
  const [severity, setSeverity] = React.useState<'all' | Severity>('all')
  const [rule, setRule] = React.useState('all')
  const [q, setQ] = React.useState('')
  const findings = data.hygiene
  const rules = React.useMemo(() => [...new Map(findings.map((f) => [f.rule, f.title])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'de')), [findings])
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length
  const needle = q.trim().toLowerCase()
  const filtered = findings.filter(
    (f) => (severity === 'all' || f.severity === severity) && (rule === 'all' || f.rule === rule) && (!needle || `${f.account} ${f.value} ${f.title}`.toLowerCase().includes(needle)),
  )
  const t = data.thresholds

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<'all' | Severity>
          aria-label="Schweregrad"
          value={severity}
          onValueChange={setSeverity}
          options={[
            { value: 'all', label: `Alle (${findings.length})` },
            { value: 'High', label: `Hoch (${count('High')})` },
            { value: 'Medium', label: `Mittel (${count('Medium')})` },
            { value: 'Low', label: `Niedrig (${count('Low')})` },
          ]}
        />
        <div className="w-full sm:w-60">
          <Select size="sm" aria-label="Regel" value={rule} onValueChange={setRule} options={[{ value: 'all', label: 'Alle Regeln' }, ...rules.map(([value, label]) => ({ value, label }))]} />
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Konto suchen …" className="h-8 pl-8 text-[13px]" aria-label="Hygiene-Befunde durchsuchen" />
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>Schwellwerte: {t.staleDays} Tage ohne Anmeldung, Passwort höchstens {t.passwordMaxAgeDays} Tage alt.</span>
        {canAdmin && <Link to="/admin/einstellungen" className="inline-flex items-center gap-1 text-primary hover:underline"><Settings2 className="size-3" /> In den Einstellungen ändern</Link>}
      </p>
      <Card className="overflow-hidden">
        {findings.length === 0 ? (
          <EmptyState icon={<CheckCircle2 />} title="Keine Hygiene-Befunde" description="Alle privilegierten Konten erfüllen die Regeln." />
        ) : filtered.length === 0 ? (
          <EmptyState compact icon={<Search />} title="Keine Treffer" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH className="w-24">Schweregrad</TH>
                <TH>Regel</TH>
                <TH>Konto</TH>
                <TH className="hidden lg:table-cell">Befund</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((f, i) => (
                <TR key={`${f.rule}-${f.sid}-${i}`}>
                  <TD className="align-top"><SeverityBadge severity={f.severity} /></TD>
                  <TD className="align-top">
                    <p className="text-[13px] font-medium">{f.title}</p>
                    <p className="hidden max-w-sm text-xs text-muted-foreground sm:block">{ruleHints[f.rule]}</p>
                    <p className="mt-1 text-xs text-muted-foreground lg:hidden">{f.value}</p>
                  </TD>
                  <TD className="align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[12px] break-all">{f.account}</span>
                      {(f.tier === 0 || f.tier === 1 || f.tier === 2) && <TierBadge tier={f.tier} short />}
                    </div>
                    <p className="text-xs text-muted-foreground">{objectClassLabels[f.objectClass] ?? f.objectClass}</p>
                  </TD>
                  <TD className="hidden text-[13px] text-muted-foreground lg:table-cell">{f.value}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {findings.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><HeartPulse className="size-3.5" /> Geprüft werden Konten in Tier-0/1-Gruppen und in den Tier-0/1-Konten-OUs.</p>
      )}
    </div>
  )
}
