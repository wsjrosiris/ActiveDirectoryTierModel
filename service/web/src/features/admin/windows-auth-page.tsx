import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Info, KeyRound, Save, ShieldAlert, UsersRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import type { GroupRef, Role, WindowsAuthSettings } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth } from '@/features/auth/auth'
import { usePrincipalOptions } from '@/features/config/lookups'
import { errorMessage } from '@/lib/query'
import { roleDescriptions, roleLabels, roles } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

export function Component() {
  return (
    <RequireAuth role="Admin">
      <WindowsAuthPage />
    </RequireAuth>
  )
}

const queryKey = ['settings', 'windows-auth'] as const

/** A saved entry carries the resolved group; a new one only the text the admin typed. */
interface Entry {
  value: string
  ref?: GroupRef
  /** display name of a group picked from the AD search (value is then its SID) */
  label?: string
}

interface FormState {
  enabled: boolean
  groups: Record<Role, Entry[]>
}

function toForm(s: WindowsAuthSettings): FormState {
  const groups = {} as Record<Role, Entry[]>
  for (const r of roles) groups[r] = (s.roleGroups?.[r] ?? []).map((g) => ({ value: g.sid || g.name, ref: g }))
  return { enabled: s.enabled, groups }
}

/** What goes into the PUT body: saved entries by SID (stable across renames), new ones as typed. */
function entryValue(e: Entry) {
  return e.ref?.sid || e.ref?.name || e.value
}

function serialize(f: FormState) {
  return JSON.stringify({ enabled: f.enabled, groups: roles.map((r) => f.groups[r].map(entryValue)) })
}

/** The service could not translate the SID into a name (e.g. not running on a domain member). */
function sidOnly(g: GroupRef) {
  return !g.name || g.name.toLowerCase() === g.sid.toLowerCase()
}

const SID_RE = /^S-1-\d+(-\d+)+$/i

function entryFormatError(v: string): string | null {
  if (SID_RE.test(v)) return null
  const i = v.indexOf('\\')
  if (i > 0 && i < v.length - 1 && !v.slice(i + 1).includes('\\')) return null
  return t('admin.windowsAuth.formatDomainGroupOrSid')
}

const roleTone: Record<Role, string> = {
  Viewer: 'bg-muted text-muted-foreground',
  Editor: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  Operator: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  Admin: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

function WindowsAuthPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey, queryFn: api.settings.windowsAuth })
  const [form, setForm] = React.useState<FormState | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<Role, string[]>>>({})
  React.useEffect(() => {
    if (q.data) setForm(toForm(q.data))
  }, [q.data])

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const roleGroups = {} as Record<Role, string[]>
      for (const r of roles) roleGroups[r] = f.groups[r].map(entryValue)
      return api.settings.updateWindowsAuth({ enabled: f.enabled, roleGroups })
    },
    meta: { silent: true },
    onSuccess: (s) => {
      setFieldErrors({})
      qc.setQueryData(queryKey, s)
      qc.invalidateQueries({ queryKey: ['auth', 'options'] })
      toast.success(t('admin.windowsAuth.windowsSignInSaved'), { description: s.enabled ? t('admin.windowsAuth.theGroupMappingAppliesFrom') : t('admin.windowsAuth.windowsSignInIsTurned') })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 400 && e.errors) {
        const next: Partial<Record<Role, string[]>> = {}
        const rest: string[] = []
        for (const [k, msgs] of Object.entries(e.errors)) {
          const role = roles.find((r) => k.toLowerCase() === `rolegroups.${r.toLowerCase()}` || k.toLowerCase().startsWith(`rolegroups.${r.toLowerCase()}[`))
          if (role) next[role] = [...(next[role] ?? []), ...msgs]
          else rest.push(...msgs)
        }
        setFieldErrors(next)
        const first = roles.find((r) => next[r])
        if (first) requestAnimationFrame(() => document.getElementById(`wa-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
        toast.error(t('admin.windowsAuth.notSaved'), { description: rest[0] ?? t('admin.windowsAuth.someEntriesCouldNotBe') })
        return
      }
      toast.error(e instanceof ApiError ? e.title : t('admin.windowsAuth.error'), { description: e instanceof ApiError ? e.detail : errorMessage(e) })
    },
  })

  const data = q.data
  const available = data?.available ?? false
  const dirty = !!form && !!data && serialize(form) !== serialize(toForm(data))
  const total = form ? roles.reduce((n, r) => n + form.groups[r].length, 0) : 0

  const setGroups = (role: Role, entries: Entry[]) => {
    if (!form) return
    setForm({ ...form, groups: { ...form.groups, [role]: entries } })
    if (fieldErrors[role]) setFieldErrors({ ...fieldErrors, [role]: undefined })
  }

  return (
    <Page className="max-w-4xl">
      <PageHeader
        icon={<KeyRound />}
        title={t('admin.windowsAuth.windowsSignIn')}
        description={t('admin.windowsAuth.singleSignOnWithDomain')}
      />
      {!form || !data ? (
        <div className="grid gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (dirty) save.mutate(form)
          }}
        >
          {!available && (
            <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">{t('admin.windowsAuth.notAvailableOnThisServer')}</p>
                <p className="mt-0.5 opacity-90">
                  {t('admin.windowsAuth.theServiceCannotAcceptWindows')}
                </p>
              </div>
            </div>
          )}

          <Card>
            <CardContent className="pt-5">
              <label htmlFor="wa-enabled" className={cn('flex items-center justify-between gap-4', !available && 'cursor-not-allowed')}>
                <span className="flex items-center gap-3">
                  <span className={cn('grid size-10 shrink-0 place-content-center rounded-lg [&_svg]:size-5', form.enabled && available ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
                    <KeyRound />
                  </span>
                  <span className="grid">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {t('admin.windowsAuth.enableWindowsSignIn')}
                      {data.enabled && available ? <Badge variant="success">{t('common.active')}</Badge> : <Badge variant="muted">{t('common.off')}</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('admin.windowsAuth.showsSignInWithWindows')}
                    </span>
                  </span>
                </span>
                <Tooltip content={available ? undefined : t('admin.windowsAuth.notAvailableOnThisServer')} disabled={available}>
                  <span>
                    <Switch id="wa-enabled" checked={form.enabled} disabled={!available} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                  </span>
                </Tooltip>
              </label>
              {form.enabled && total === 0 && (
                <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="size-3.5 shrink-0" /> {t('admin.windowsAuth.withoutMappedGroupsNobodyCan')}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2"><UsersRound className="size-4 text-muted-foreground" /> {t('admin.windowsAuth.rolesFromAdGroups')}</CardTitle>
                <CardDescription>
                  {t('admin.windowsAuth.enterGroupsPerRoleAs')} <span className="font-mono text-foreground">{t('admin.windowsAuth.domainGroup')}</span> {t('admin.windowsAuth.orSidWithMembershipIn')}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-0 divide-y p-0">
              {roles.map((r) => (
                <RoleGroupsRow key={r} role={r} entries={form.groups[r]} onChange={(e) => setGroups(r, e)} errors={fieldErrors[r]} />
              ))}
            </CardContent>
          </Card>

          <div className="flex gap-3 rounded-xl border bg-muted/30 px-4 py-3.5 text-[13px] text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <div className="grid gap-1.5">
              <p className="font-medium text-foreground">{t('admin.windowsAuth.prerequisitesForSingleSignOn')}</p>
              <ul className="grid list-disc gap-1 pl-4">
                <li>
                  {t('admin.windowsAuth.theSpn')} <span className="font-mono text-foreground">{t('admin.windowsAuth.httpServerFqdn')}</span> {t('admin.windowsAuth.mustBeRegisteredForThe')}{' '}
                  <span className="rounded bg-card px-1 py-0.5 font-mono text-[12px] text-foreground ring-1 ring-border">setspn -S HTTP/tiermodel01.contoso.com CONTOSO\svc-tiermodel</span>{t('admin.windowsAuth.withoutAMatchingSpnSign')}
                </li>
                <li>
                  {t('admin.windowsAuth.theAddressOfTheUi')}
                </li>
                <li>{t('admin.windowsAuth.windowsAccountsAreCreatedAutomatically')}</li>
                <li>{t('admin.windowsAuth.detailsAreInTheService')}</li>
              </ul>
            </div>
          </div>

          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-card/95 px-4 py-3 shadow-lg shadow-black/5 backdrop-blur">
            <span className="mr-auto text-xs text-muted-foreground">
              {dirty ? t('admin.windowsAuth.unsavedChangesNamesAreResolved') : t('common.allChangesSaved')}
            </span>
            <Button type="button" variant="ghost" disabled={!dirty} onClick={() => { setForm(toForm(data)); setFieldErrors({}) }}>{t('common.reset')}</Button>
            <Button type="submit" disabled={!dirty} loading={save.isPending}>{!save.isPending && <Save />} {t('common.save')}</Button>
          </div>
        </form>
      )}
    </Page>
  )
}

function RoleGroupsRow({ role, entries, onChange, errors }: { role: Role; entries: Entry[]; onChange: (e: Entry[]) => void; errors?: string[] }) {
  const [hint, setHint] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const { options, loading } = usePrincipalOptions(search, { sidValues: true })
  const id = `wa-${role}`

  const add = (raw: string) => {
    const v = raw.trim()
    if (!v) return
    const bad = entryFormatError(v)
    if (bad) {
      setHint(t('admin.windowsAuth.entryHint', { value: v, problem: bad }))
      return
    }
    const known = new Set(entries.flatMap((e) => [e.value.toLowerCase(), e.ref?.name.toLowerCase(), e.ref?.sid.toLowerCase()].filter(Boolean) as string[]))
    if (known.has(v.toLowerCase())) {
      setHint(t('admin.windowsAuth.thisGroupIsAlreadyMapped'))
      return
    }
    const picked = options.find((o) => o.value.toLowerCase() === v.toLowerCase())
    onChange([...entries, { value: v, label: picked?.label }])
    setHint(null)
  }

  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
      <div>
        <label htmlFor={id} className="flex items-center gap-2 text-[13px] font-medium">
          <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-semibold', roleTone[role])}>{roleLabels[role]}</span>
          {entries.length > 0 && <span className="text-xs font-normal text-muted-foreground tabular">{entries.length}</span>}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{roleDescriptions[role]}</p>
      </div>
      <div className="grid min-w-0 gap-2">
        {entries.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t('admin.windowsAuth.groupsForValue', { value: roleLabels[role] })}>
            {entries.map((e, i) => (
              <li
                key={`${e.value}-${i}`}
                className={cn(
                  'group flex max-w-full items-center gap-2 rounded-lg border bg-card py-1 pr-1 pl-2.5 shadow-xs',
                  !e.ref && 'border-dashed border-primary/40 bg-primary/[0.03]',
                )}
              >
                <span className="grid min-w-0">
                  {e.ref && sidOnly(e.ref) ? (
                    <span className="truncate font-mono text-[12px] font-medium" title={e.ref.sid}>{e.ref.sid}</span>
                  ) : (
                    <span className="truncate text-[13px] font-medium" title={e.ref?.name || e.value}>{e.ref?.name || e.label || e.value}</span>
                  )}
                  {e.ref ? (
                    sidOnly(e.ref) ? (
                      <span className="text-[10.5px] text-muted-foreground">{t('admin.windowsAuth.sidNameNotResolved')}</span>
                    ) : (
                      <span className="truncate font-mono text-[10.5px] text-muted-foreground" title={e.ref.sid}>{e.ref.sid}</span>
                    )
                  ) : (
                    <span className="text-[10.5px] text-primary">{e.label ? t('admin.windowsAuth.valueNew', { value: e.value }) : t('admin.windowsAuth.newResolvedOnSave')}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(entries.filter((_, j) => j !== i))}
                  className="grid size-6 shrink-0 place-content-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t('common.removeName', { name: e.ref?.name || e.value })}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <MultiCombobox
          id={id}
          values={[]}
          onChange={(v) => v[0] && add(v[0])}
          options={options}
          onSearchChange={(q) => { setSearch(q); setHint(null) }}
          loading={loading}
          mono
          invalid={!!errors?.length}
          validateCustom={entryFormatError}
          placeholder={entries.length ? t('admin.windowsAuth.searchAnotherGroupOrEnter') : t('admin.windowsAuth.searchAGroupInAd')}
          emptyText={t('admin.windowsAuth.noGroupFoundEnterDomain')}
        />
        {errors?.length ? (
          <div role="alert" className="grid gap-0.5 text-xs text-destructive">
            {errors.map((m, i) => <p key={i}>{m}</p>)}
          </div>
        ) : hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('admin.windowsAuth.noGroupMapped')}</p>
        ) : null}
      </div>
    </div>
  )
}
