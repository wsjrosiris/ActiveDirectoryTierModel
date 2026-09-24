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
import { t } from '@/i18n'

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
    onSuccess: () => { toast.success(t('jit.jitGroups.jitGroupDeleted')); invalidate() },
    onError: (e) => toast.error(t('jit.jitGroups.deletionNotPossible'), { description: e instanceof ApiError ? e.detail ?? e.title : errorMessage(e) }),
  })
  const toggle = useMutation({
    mutationFn: (g: JitGroup) => jitApi.groups.update(g.id, { ...toInput(g), enabled: !g.enabled }),
    onSuccess: invalidate,
  })

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          {t('jit.jitGroups.onlyTheseGroupsCanBe')}
        </p>
        <Button onClick={() => setEdit('new')}><Plus /> {t('jit.jitGroups.addJitGroup')}</Button>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-32" />
      ) : !q.data?.length ? (
        <Card>
          <EmptyState icon={<UsersRound />} title={t('jit.jitGroups.noJitGroupsYet')} description={t('jit.jitGroups.defineWhichGroupsMayBe')} action={<Button variant="outline" onClick={() => setEdit('new')}><Plus /> {t('jit.jitGroups.addJitGroup')}</Button>} />
        </Card>
      ) : (
        <Card className="divide-y">
          {q.data.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5" data-testid={`jit-group-${g.id}`}>
              <div className="grid min-w-0 flex-1 basis-64 gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <TierBadge tier={(g.tier ?? null) as Tier} short />
                  <span className="truncate font-medium">{g.displayName}</span>
                  {!g.enabled && <Badge variant="muted">{t('jit.jitGroups.disabled')}</Badge>}
                </div>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-mono">{g.group}</span>
                  <span>{t('jit.jitGroups.max')} {formatMinutes(g.maxMinutes)}</span>
                  <span className="flex items-center gap-1">{g.requiresApproval ? <><Hourglass className="size-3" /> {t('jit.jitGroups.withApproval')}</> : <><ShieldCheck className="size-3" /> {t('jit.jitGroups.withoutApproval')}</>}</span>
                  <span>{t('jit.jitGroups.from')} {roleLabels[g.minimumRole]}</span>
                  {g.eligibleUsers.length > 0 && <span className="flex items-center gap-1"><Users className="size-3" /> {g.eligibleUsers.join(', ')}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={g.enabled} onCheckedChange={() => toggle.mutate(g)} aria-label={t('common.nameActive', { name: g.displayName })} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={t('common.actions')}><MoreHorizontal /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEdit(g)}><Pencil /> {t('common.edit')}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={async () => {
                        if (await confirm({ title: t('jit.jitGroups.deleteJitGroupDisplayname', { displayName: g.displayName }), description: t('jit.jitGroups.previousRequestsRemainInThe'), confirmText: t('common.delete'), destructive: true }))
                          remove.mutate(g)
                      }}
                    >
                      <Trash2 /> {t('common.delete')}
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
    const tt = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(tt)
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
      toast.success(value === 'new' ? t('jit.jitGroups.jitGroupCreated') : t('jit.jitGroups.jitGroupSaved'))
      qc.invalidateQueries({ queryKey: ['jit'] })
      onClose()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors)
      toast.error(t('jit.jitGroups.savingNotPossible'), { description: errorMessage(e) })
    },
  })
  const err = (k: string) => errors[k]?.[0]

  return (
    <Sheet open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <form className="flex h-full min-h-0 flex-col" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <SheetHeader>
            <SheetTitle>{value === 'new' ? t('jit.jitGroups.addJitGroup') : t('jit.jitGroups.editJitGroup')}</SheetTitle>
            <SheetDescription>{t('jit.jitGroups.whichGroupMayBeRequested')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="grid content-start gap-5">
            <Field label={t('jit.jitGroups.group')} htmlFor="jit-g-group" required error={err('group')} hint={t('jit.jitGroups.fromTheConfigurationTheBuilt')}>
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
                placeholder={t('jit.jitGroups.selectGroup')}
                searchPlaceholder={t('jit.jitGroups.searchOrEnterGroup')}
                mono
                invalid={!!err('group')}
              />
            </Field>
            <Field label={t('jit.jitGroups.displayName')} htmlFor="jit-g-name" error={err('displayName')}>
              <Input id="jit-g-name" value={form.displayName} maxLength={128} onChange={(e) => set('displayName', e.target.value)} placeholder={t('jit.jitGroups.eGDomainAdminsTime')} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t('jit.jitGroups.tier')} htmlFor="jit-g-tier" error={err('tier')}>
                <Select
                  id="jit-g-tier"
                  value={form.tier === null ? 'none' : String(form.tier)}
                  onValueChange={(v) => set('tier', v === 'none' ? null : Number(v))}
                  options={[{ value: '0', label: t('jit.jitGroups.tier0') }, { value: '1', label: t('jit.jitGroups.tier1') }, { value: '2', label: t('jit.jitGroups.tier2') }, { value: 'none', label: t('jit.jitGroups.noTier') }]}
                />
              </Field>
              <Field label={t('jit.jitGroups.maximumDuration')} htmlFor="jit-g-max" error={err('maxMinutes')}>
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
                <span className="text-[13px] font-medium">{t('jit.jitGroups.approvalRequired')}</span>
                <span className="text-xs text-muted-foreground">{t('jit.jitGroups.aSecondPersonWithThe')}</span>
              </span>
              <Switch id="jit-g-approval" checked={form.requiresApproval} onCheckedChange={(v) => set('requiresApproval', v)} />
            </label>
            <Field label={t('jit.jitGroups.requestFromRole')} htmlFor="jit-g-role" error={err('minimumRole')}>
              <Select id="jit-g-role" value={form.minimumRole} onValueChange={(v) => set('minimumRole', v as Role)} options={roles.map((r) => ({ value: r, label: roleLabels[r] }))} />
            </Field>
            <Field label={t('jit.jitGroups.onlyTheseUsersOptional')} htmlFor="jit-g-users" error={err('eligibleUsers')} hint={t('jit.jitGroups.emptyAllUsersWithThe')}>
              <MultiCombobox id="jit-g-users" values={form.eligibleUsers} onChange={(v) => set('eligibleUsers', v)} options={userOptions} placeholder={t('jit.jitGroups.searchUsers')} allowCustom={false} />
            </Field>
            <label className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3" htmlFor="jit-g-enabled">
              <span className="text-[13px] font-medium">{t('common.active')}</span>
              <Switch id="jit-g-enabled" checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
            </label>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
