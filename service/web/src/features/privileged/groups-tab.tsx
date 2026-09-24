import * as React from 'react'
import { useSearchParams } from 'react-router'
import { CheckCircle2, CornerDownRight, Search, UserX, Users } from 'lucide-react'
import type { PrivilegedGroup, PrivilegedOverview } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { TierBadge } from '@/components/shared/badges'
import { objectClassLabels } from '@/lib/labels'
import { cn, pluralize } from '@/lib/utils'

export function GroupsTab({ data }: { data: PrivilegedOverview }) {
  const [params, setParams] = useSearchParams()
  const onlyUnexpected = params.get('nur') === 'unerwartet'
  const [q, setQ] = React.useState('')
  const needle = q.trim().toLowerCase()

  const groups = data.groups
    .map((g) => ({
      ...g,
      members: g.members.filter(
        (m) =>
          (!onlyUnexpected || m.unexpected) &&
          (!needle || `${m.name} ${m.samAccountName ?? ''} ${m.via.join(' ')} ${g.name} ${g.wellKnownName ?? ''}`.toLowerCase().includes(needle)),
      ),
    }))
    .filter((g) => (!onlyUnexpected && !needle) || g.members.length > 0)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mitglied oder Gruppe suchen …" className="h-8 pl-8 text-[13px]" aria-label="Mitglieder durchsuchen" />
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <Switch
            checked={onlyUnexpected}
            onCheckedChange={(v) => {
              const p = new URLSearchParams(params)
              if (v) p.set('nur', 'unerwartet')
              else p.delete('nur')
              setParams(p, { replace: true })
            }}
            aria-label="Nur nicht erwartete Mitglieder"
          />
          Nur nicht erwartete Mitglieder
        </label>
      </div>
      {groups.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={onlyUnexpected ? <CheckCircle2 /> : <Search />}
            title={onlyUnexpected && !needle ? 'Alle Mitglieder sind erwartet' : 'Keine Treffer'}
            description={onlyUnexpected && !needle ? 'Jedes Mitglied ist in der Soll-Konfiguration als Tier 0 hinterlegt oder gehört zur Standardausstattung.' : undefined}
          />
        </Card>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {groups.map((g) => <GroupCard key={g.sid} group={g} total={data.groups.find((x) => x.sid === g.sid)?.memberCount ?? g.memberCount} />)}
        </div>
      )}
    </div>
  )
}

function GroupCard({ group: g, total }: { group: PrivilegedGroup; total: number }) {
  const unexpected = g.members.filter((m) => m.unexpected).length
  const showWellKnown = g.wellKnownName && g.wellKnownName.toLowerCase() !== g.name.toLowerCase()
  return (
    <Card className={cn('min-w-0 overflow-hidden', unexpected > 0 && 'border-rose-500/30')}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">{g.name}</h3>
            {g.tier === 0 && <TierBadge tier={0} short />}
            <Badge variant={g.source === 'config' ? 'info' : 'muted'}>{g.source === 'config' ? 'Aus der Konfiguration' : 'Geschützte Gruppe'}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {showWellKnown && <>{g.wellKnownName} · </>}
            {pluralize(total, 'Mitglied', 'Mitglieder')} · {pluralize(g.directCount, 'direkt', 'direkt')}
          </p>
        </div>
        {unexpected > 0 ? (
          <Badge variant="danger"><UserX /> {unexpected} nicht erwartet</Badge>
        ) : (
          g.members.length > 0 && <Badge variant="success"><CheckCircle2 /> Wie erwartet</Badge>
        )}
      </div>
      {g.members.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground"><Users className="size-4" /> Keine Mitglieder</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Mitglied</TH>
              <TH className="hidden sm:table-cell">Mitgliedschaft</TH>
              <TH className="hidden md:table-cell">Konto</TH>
              <TH>Bewertung</TH>
            </TR>
          </THead>
          <TBody>
            {g.members.map((m) => (
              <TR key={m.sid} className={cn(m.unexpected && 'bg-rose-500/[0.04]')}>
                <TD className="max-w-0 min-w-0 sm:max-w-none">
                  <p className="truncate text-[13px] font-medium" title={m.distinguishedName ?? undefined}>{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {objectClassLabels[m.objectClass] ?? m.objectClass}
                    {m.samAccountName && m.samAccountName !== m.name && <> · <span className="font-mono">{m.samAccountName}</span></>}
                  </p>
                  <p className="text-xs text-muted-foreground sm:hidden">{m.direct ? 'Direkt' : `über ${m.via.join(' › ')}`}</p>
                </TD>
                <TD className="hidden text-[13px] sm:table-cell">
                  {m.direct ? (
                    <span>Direkt</span>
                  ) : (
                    <span className="inline-flex items-start gap-1 text-muted-foreground"><CornerDownRight className="mt-0.5 size-3.5 shrink-0" /> über {m.via.join(' › ')}</span>
                  )}
                </TD>
                <TD className="hidden md:table-cell">
                  {m.objectClass === 'group' ? <span className="text-xs text-muted-foreground">–</span>
                    : m.enabled === false ? <Badge variant="muted">Deaktiviert</Badge>
                    : m.enabled === true ? <Badge variant="outline">Aktiv</Badge>
                    : <span className="text-xs text-muted-foreground">–</span>}
                </TD>
                <TD className="w-[1%] whitespace-nowrap sm:w-auto sm:whitespace-normal">
                  {m.unexpected ? (
                    <Badge variant="danger">Nicht erwartet</Badge>
                  ) : (
                    <>
                      <CheckCircle2 className="size-4 text-emerald-600 sm:hidden dark:text-emerald-400" aria-label={m.note ?? 'Erwartet'} />
                      <span className="hidden text-xs text-muted-foreground sm:inline">{m.note ?? 'Erwartet'}</span>
                    </>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  )
}
