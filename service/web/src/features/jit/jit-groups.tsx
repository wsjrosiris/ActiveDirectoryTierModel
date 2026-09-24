import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Hourglass, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, Users, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import { jitApi, type JitGroup, type JitGroupInput } from '@/api/jit'
import type { Role } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Select } from '@/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TierBadge } from '@/components/shared/badges'
import { errorMessage } from '@/lib/query'
import { roleLabels, roles } from '@/lib/roles'
import type { Tier } from '@/lib/tier'
import { formatMinutes, MAX_DURATIONS } from './jit-model'

const key = ['jit', 'groups'] as const

/** Administration of the groups that may be requested (tab „JIT-Gruppen“). */
export function JitGroupsAdmin() {
  const q = useQuery({ queryKey: key, queryFn: jitApi.groups.list })
  const [edit, setEdit] = React.useState<JitGroup | 'new' | null>(null)
  const qc = useQueryClient()
  const confirm = useConfirm()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['jit'] })
  const remove = useMutation({
    mutationFn: (g: JitGroup) => jitApi.groups.remove(g.id),
    meta: { silent: true },
    onSuccess: () => { toast.success('JIT-Gruppe gelöscht'); invalidate() },
    onError: (e) => toast.error('Löschen nicht möglich', { description: e instanceof ApiError ? e.detail ?? e.title : errorMessage(e) }),
  })
  const toggle = useMutation({
    mutationFn: (g: JitGroup) => jitApi.groups.update(g.id, { ...toInput(g), enabled: !g.enabled }),
    onSuccess: invalidate,
  })

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          Nur diese Gruppen können befristet beantragt werden. Empfohlen sind eigene JIT-Gruppen (z. B. mit Rechten auf Tier-0-Objekte) statt der integrierten Administratorgruppen.
        </p>
        <Button onClick={() => setEdit('new')}><Plus /> JIT-Gruppe hinzufügen</Button>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-32" />
      ) : !q.data?.length ? (
        <Card>
          <EmptyState icon={<UsersRound />} title="Noch keine JIT-Gruppen" description="Legen Sie fest, welche Gruppen mit welcher Höchstdauer beantragt werden dürfen." action={<Button variant="outline" onClick={() => setEdit('new')}><Plus /> JIT-Gruppe hinzufügen</Button>} />
        </Card>
      ) : (
        <Card className="divide-y">
          {q.data.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5" data-testid={`jit-group-${g.id}`}>
              <div className="grid min-w-0 flex-1 basis-64 gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <TierBadge tier={(g.tier ?? null) as Tier} short />
                  <span className="truncate font-medium">{g.displayName}</span>
                  {!g.enabled && <Badge variant="muted">Deaktiviert</Badge>}
                </div>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-mono">{g.group}</span>
                  <span>max. {formatMinutes(g.maxMinutes)}</span>
                  <span className="flex items-center gap-1">{g.requiresApproval ? <><Hourglass className="size-3" /> mit Freigabe</> : <><ShieldCheck className="size-3" /> ohne Freigabe</>}</span>
                  <span>ab {roleLabels[g.minimumRole]}</span>
                  {g.eligibleUsers.length > 0 && <span className="flex items-center gap-1"><Users className="size-3" /> {g.eligibleUsers.join(', ')}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={g.enabled} onCheckedChange={() => toggle.mutate(g)} aria-label={`${g.displayName} aktiv`} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Aktionen"><MoreHorizontal /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEdit(g)}><Pencil /> Bearbeiten</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={async () => {
                        if (await confirm({ title: `JIT-Gruppe „${g.displayName}“ löschen?`, description: 'Bisherige Anträge bleiben im Verlauf erhalten.', confirmText: 'Löschen', destructive: true }))
                          remove.mutate(g)
                      }}
                    >
                      <Trash2 /> Löschen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </Card>
      )}
      <GroupSheet value={edit} onClose={() => setEdit(null)} />
    </div>
  )
}

function toInput(g: JitGroup): JitGroupInput {
  return {
    group: g.group, groupSid: g.groupSid, displayName: g.displayName, tier: g.tier, maxMinutes: g.maxMinutes,
    requiresApproval: g.requiresApproval, minimumRole: g.minimumRole, eligibleUsers: g.eligibleUsers, enabled: g.enabled,
  }
}

const emptyInput: JitGroupInput = {
  group: '', groupSid: null, displayName: '', tier: 0, maxMinutes: 60, requiresApproval: true, minimumRole: 'Operator', eligibleUsers: [], enabled: true,
}

function useGroupCandidates(search: string) {
  const [q, setQ] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const query = useQuery({ queryKey: ['jit', 'lookup', 'groups', q], queryFn: ({ signal }) => jitApi.lookup.groups(q, signal), staleTime: 60_000 })
  return { items: query.data ?? [], loading: query.isFetching }
}

function GroupSheet({ value, onClose }: { value: JitGroup | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = React.useState<JitGroupInput>(emptyInput)
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  const [search, setSearch] = React.useState('')
  const candidates = useGroupCandidates(search)
  const users = useQuery({ queryKey: ['users'], queryFn: api.users.list, enabled: value !== null, staleTime: 60_000 })

  React.useEffect(() => {
    if (value === null) return
    setForm(value === 'new' ? emptyInput : toInput(value))
    setErrors({})
  }, [value])

  const set = <K extends keyof JitGroupInput>(k: K, v: JitGroupInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const groupOptions: ComboOption[] = candidates.items.map((c) => ({
    value: c.group,
    label: c.group,
    hint: `${c.displayName !== c.group ? `${c.displayName} · ` : ''}${c.source}`,
    icon: <TierBadge tier={(c.tier ?? null) as Tier} short />,
  }))
  const userOptions: ComboOption[] = (users.data ?? []).map((u) => ({ value: u.username, label: u.username, hint: `${u.displayName} · ${roleLabels[u.role]}` }))

  const save = useMutation({
    mutationFn: () => (value === 'new' || value === null ? jitApi.groups.create(form) : jitApi.groups.update(value.id, form)),
    meta: { silent: true },
    onSuccess: () => {
      toast.success(value === 'new' ? 'JIT-Gruppe angelegt' : 'JIT-Gruppe gespeichert')
      qc.invalidateQueries({ queryKey: ['jit'] })
      onClose()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors)
      toast.error('Speichern nicht möglich', { description: errorMessage(e) })
    },
  })
  const err = (k: string) => errors[k]?.[0]

  return (
    <Sheet open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <form className="flex h-full min-h-0 flex-col" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <SheetHeader>
            <SheetTitle>{value === 'new' ? 'JIT-Gruppe hinzufügen' : 'JIT-Gruppe bearbeiten'}</SheetTitle>
            <SheetDescription>Welche Gruppe befristet beantragt werden darf, wie lange und von wem.</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-5">
            <Field label="Gruppe" htmlFor="jit-g-group" required error={err('group')} hint="Aus der Konfiguration, den integrierten Gruppen oder – auf dem Server – aus dem Active Directory; auch samAccountName oder SID.">
              <Combobox
                id="jit-g-group"
                value={form.group}
                onChange={(v) => {
                  const c = candidates.items.find((x) => x.group === v)
                  setForm((f) => ({
                    ...f,
                    group: v,
                    groupSid: c?.sid ?? (v === f.group ? f.groupSid : null),
                    displayName: !f.displayName || f.displayName === f.group ? c?.displayName ?? v : f.displayName,
                    tier: c?.tier ?? f.tier,
                  }))
                }}
                options={groupOptions}
                onSearchChange={setSearch}
                loading={candidates.loading}
                placeholder="Gruppe wählen …"
                searchPlaceholder="Gruppe suchen oder eingeben …"
                mono
                invalid={!!err('group')}
              />
            </Field>
            <Field label="Anzeigename" htmlFor="jit-g-name" error={err('displayName')}>
              <Input id="jit-g-name" value={form.displayName} maxLength={128} onChange={(e) => set('displayName', e.target.value)} placeholder="z. B. Domänen-Admins (befristet)" />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Tier" htmlFor="jit-g-tier" error={err('tier')}>
                <Select
                  id="jit-g-tier"
                  value={form.tier === null ? 'none' : String(form.tier)}
                  onValueChange={(v) => set('tier', v === 'none' ? null : Number(v))}
                  options={[{ value: '0', label: 'Tier 0' }, { value: '1', label: 'Tier 1' }, { value: '2', label: 'Tier 2' }, { value: 'none', label: 'Ohne Tier' }]}
                />
              </Field>
              <Field label="Höchstdauer" htmlFor="jit-g-max" error={err('maxMinutes')}>
                <Select
                  id="jit-g-max"
                  value={String(form.maxMinutes)}
                  onValueChange={(v) => set('maxMinutes', Number(v))}
                  options={[...new Set([...MAX_DURATIONS, form.maxMinutes])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: formatMinutes(m) }))}
                />
              </Field>
            </div>
            <label className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3" htmlFor="jit-g-approval">
              <span className="grid gap-0.5">
                <span className="text-[13px] font-medium">Freigabe erforderlich</span>
                <span className="text-xs text-muted-foreground">Eine zweite Person mit der Rolle Operator muss den Antrag freigeben (Vier-Augen-Prinzip).</span>
              </span>
              <Switch id="jit-g-approval" checked={form.requiresApproval} onCheckedChange={(v) => set('requiresApproval', v)} />
            </label>
            <Field label="Beantragen ab Rolle" htmlFor="jit-g-role" error={err('minimumRole')}>
              <Select id="jit-g-role" value={form.minimumRole} onValueChange={(v) => set('minimumRole', v as Role)} options={roles.map((r) => ({ value: r, label: roleLabels[r] }))} />
            </Field>
            <Field label="Nur diese Benutzer (optional)" htmlFor="jit-g-users" error={err('eligibleUsers')} hint="Leer: alle Benutzer mit der Mindestrolle.">
              <MultiCombobox id="jit-g-users" values={form.eligibleUsers} onChange={(v) => set('eligibleUsers', v)} options={userOptions} placeholder="Benutzer suchen …" allowCustom={false} />
            </Field>
            <label className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3" htmlFor="jit-g-enabled">
              <span className="text-[13px] font-medium">Aktiv</span>
              <Switch id="jit-g-enabled" checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
            </label>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button type="submit" loading={save.isPending}>Speichern</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
