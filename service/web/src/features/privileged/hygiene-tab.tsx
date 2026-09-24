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
import { t } from '@/i18n'

/** What each rule means, shown under the rule name. */
const ruleHints: Record<string, string> = {
  NotInProtectedUsers: t('privileged.hygieneTab.tier0AccountsBelongIn'),
  DelegationAllowed: t('privileged.hygieneTab.accountIsSensitiveAndCannot'),
  PasswordOld: t('privileged.hygieneTab.passwordOlderThanAllowed'),
  Stale: t('privileged.hygieneTab.enabledButHasNotSigned'),
  HasSpn: t('privileged.hygieneTab.withAnSpnAnyoneCan'),
  PasswordNeverExpires: t('privileged.hygieneTab.passwordNeverExpires'),
  OrphanedAdminCount: t('privileged.hygieneTab.formerlyPrivilegedPermissionsStillRestricted'),
  DisabledButPrivileged: t('privileged.hygieneTab.disabledButStillAMember'),
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
  const tt = data.thresholds

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<'all' | Severity>
          aria-label={t('privileged.hygieneTab.severity')}
          value={severity}
          onValueChange={setSeverity}
          options={[
            { value: 'all', label: t('privileged.hygieneTab.allLength', { length: findings.length }) },
            { value: 'High', label: t('privileged.hygieneTab.highValue', { value: count('High') }) },
            { value: 'Medium', label: t('privileged.hygieneTab.mediumValue', { value: count('Medium') }) },
            { value: 'Low', label: t('privileged.hygieneTab.lowValue', { value: count('Low') }) },
          ]}
        />
        <div className="w-full sm:w-60">
          <Select size="sm" aria-label={t('privileged.hygieneTab.rule')} value={rule} onValueChange={setRule} options={[{ value: 'all', label: t('privileged.hygieneTab.allRules') }, ...rules.map(([value, label]) => ({ value, label }))]} />
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('privileged.hygieneTab.searchAccount')} className="h-8 pl-8 text-[13px]" aria-label={t('privileged.hygieneTab.searchHygieneFindings')} />
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{t('privileged.hygieneTab.thresholds', { stale: tt.staleDays, maxAge: tt.passwordMaxAgeDays })}</span>
        {canAdmin && <Link to="/admin/einstellungen" className="inline-flex items-center gap-1 text-primary hover:underline"><Settings2 className="size-3" /> {t('privileged.hygieneTab.changeInTheSettings')}</Link>}
      </p>
      <Card className="overflow-hidden">
        {findings.length === 0 ? (
          <EmptyState icon={<CheckCircle2 />} title={t('privileged.hygieneTab.noHygieneFindings')} description={t('privileged.hygieneTab.allPrivilegedAccountsComplyWith')} />
        ) : filtered.length === 0 ? (
          <EmptyState compact icon={<Search />} title={t('common.noMatches')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH className="w-24">{t('privileged.hygieneTab.severity')}</TH>
                <TH>{t('privileged.hygieneTab.rule')}</TH>
                <TH>{t('privileged.hygieneTab.account')}</TH>
                <TH className="hidden lg:table-cell">{t('privileged.hygieneTab.finding')}</TH>
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
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><HeartPulse className="size-3.5" /> {t('privileged.hygieneTab.accountsInTier01')}</p>
      )}
    </div>
  )
}
