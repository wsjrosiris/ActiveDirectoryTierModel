import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CircleDashed, GitBranch, GitCommitHorizontal, Loader2, RefreshCw, Save, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { transferApi, type GitSettings, type GitSettingsInput, type GitStatus } from '@/api/transfer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { errorMessage } from '@/lib/query'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'

export const gitQuery = { queryKey: ['settings', 'git'], queryFn: transferApi.git }

type Form = Omit<GitSettingsInput, 'password' | 'clearPassword'> & { password: string; clearPassword: boolean }

const toForm = (s: GitSettings): Form => ({
  enabled: s.enabled,
  repositoryUrl: s.repositoryUrl,
  branch: s.branch,
  username: s.username,
  password: '',
  clearPassword: false,
  authorName: s.authorName,
  authorEmail: s.authorEmail,
  pathInRepo: s.pathInRepo,
  pushOnSave: s.pushOnSave,
})

const stateMeta: Record<GitStatus['state'], { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'info'; icon: React.ReactNode }> = {
  disabled: { label: 'Aus', variant: 'muted', icon: <CircleDashed /> },
  never: { label: 'Noch nicht synchronisiert', variant: 'info', icon: <CircleDashed /> },
  ok: { label: 'Synchron', variant: 'success', icon: <CheckCircle2 /> },
  pending: { label: 'Ausstehend', variant: 'info', icon: <Loader2 /> },
  busy: { label: 'Synchronisiert …', variant: 'info', icon: <Loader2 className="animate-spin" /> },
  error: { label: 'Fehler – wird wiederholt', variant: 'warning', icon: <AlertTriangle /> },
  conflict: { label: 'Konflikt', variant: 'danger', icon: <XCircle /> },
}

/** Git mirror of the configuration (roadmap 16) on the settings page. Own form and save button. */
export function GitSettingsCard() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const q = useQuery({
    ...gitQuery,
    // Poll while something is in flight so the status follows the worker.
    refetchInterval: (query) => {
      const st = query.state.data?.status
      return st && (st.busy || st.pending > 0 || st.state === 'never' || st.state === 'error') && st.state !== 'disabled' ? 3000 : false
    },
  })
  const [form, setForm] = React.useState<Form | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  React.useEffect(() => {
    if (q.data && !form) setForm(toForm(q.data))
  }, [q.data, form])

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (f: Form) =>
      transferApi.updateGit({ ...f, password: f.password || undefined, clearPassword: f.clearPassword || undefined }),
    onSuccess: (s) => {
      qc.setQueryData(gitQuery.queryKey, s)
      setForm(toForm(s))
      setErrors({})
      toast.success('Git-Anbindung gespeichert', { description: s.enabled ? 'Die Synchronisierung läuft im Hintergrund.' : undefined })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors)
      else toast.error('Speichern fehlgeschlagen', { description: errorMessage(e) })
    },
  })
  const sync = useMutation({
    mutationFn: transferApi.syncGit,
    onSuccess: () => {
      toast.success('Synchronisierung angestoßen')
      setTimeout(() => qc.invalidateQueries({ queryKey: gitQuery.queryKey }), 500)
    },
  })
  const resolve = useMutation({
    mutationFn: transferApi.resolveGit,
    onSuccess: () => {
      toast.success('Remote wird übernommen')
      setTimeout(() => qc.invalidateQueries({ queryKey: gitQuery.queryKey }), 500)
    },
  })

  if (!q.data || !form) return <Skeleton className="h-96" />
  const s = q.data
  const st = s.status
  const base = toForm(s)
  const dirty = JSON.stringify(form) !== JSON.stringify(base)
  const err = (k: string) => errors[k]?.[0]
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch })
  const meta = stateMeta[st.state]

  const takeRemote = async () => {
    const ok = await confirm({
      title: 'Remote übernehmen?',
      description:
        'Der lokale Klon wird auf den Stand des Repositorys zurückgesetzt; nicht übertragene lokale Commits werden verworfen. Danach wird der aktuelle Stand aller Bereiche als neuer Commit exportiert und übertragen.',
      confirmText: 'Remote übernehmen',
      destructive: true,
    })
    if (ok) resolve.mutate()
  }

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2"><GitBranch className="size-4 text-muted-foreground" /> Git-Anbindung</CardTitle>
          <CardDescription>
            Jede gespeicherte Version wird als Commit in ein Git-Repository geschrieben – Autor ist die Person, die gespeichert hat, die Nachricht ihr Kommentar.
          </CardDescription>
        </div>
        <Badge variant={meta.variant}>{meta.icon} {meta.label}</Badge>
      </CardHeader>
      <CardContent className="grid gap-5">
        {s.enabled && <StatusPanel status={st} onSync={() => sync.mutate()} syncing={sync.isPending} onResolve={takeRemote} resolving={resolve.isPending} />}

        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(form)
          }}
        >
          <label htmlFor="git-enabled" className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
            <span className="grid">
              <span className="text-[13px] font-medium">Git-Anbindung aktiv</span>
              <span className="text-xs text-muted-foreground">Beim Einschalten werden zunächst alle Bereiche übertragen.</span>
            </span>
            <Switch id="git-enabled" checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })} />
          </label>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field
              label="Repository-Adresse"
              htmlFor="git-url"
              required={form.enabled}
              error={err('repositoryUrl')}
              hint={s.allowFileUrls ? 'https://… (in der Entwicklung auch file:// für ein lokales Repository)' : 'Nur https, z. B. https://git.contoso.com/it/tiermodel-config.git'}
            >
              <Input id="git-url" value={form.repositoryUrl} onChange={(e) => set({ repositoryUrl: e.target.value })} className="font-mono text-[13px]" placeholder="https://" autoComplete="off" inputMode="url" />
            </Field>
            <Field label="Branch" htmlFor="git-branch" required error={err('branch')}>
              <Input id="git-branch" value={form.branch} onChange={(e) => set({ branch: e.target.value })} className="font-mono text-[13px]" autoComplete="off" />
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Benutzername" htmlFor="git-user" error={err('username')} hint="Bei Token-Anmeldung oft beliebig, z. B. „git“.">
              <Input id="git-user" value={form.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" />
            </Field>
            <Field
              label="Token oder Passwort"
              htmlFor="git-password"
              error={err('password')}
              hint={s.hasPassword && !form.clearPassword ? 'Gespeichert (verschlüsselt). Leer lassen, um es zu behalten.' : 'Wird verschlüsselt gespeichert und nie angezeigt.'}
            >
              <div className="flex items-center gap-2">
                <Input
                  id="git-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => set({ password: e.target.value, clearPassword: false })}
                  placeholder={s.hasPassword && !form.clearPassword ? '••••••••' : ''}
                  autoComplete="new-password"
                  className="min-w-0"
                />
                {s.hasPassword && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => set({ clearPassword: !form.clearPassword, password: '' })} className={cn(form.clearPassword && 'text-destructive')}>
                    {form.clearPassword ? 'Wird entfernt' : 'Entfernen'}
                  </Button>
                )}
              </div>
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Ordner im Repository" htmlFor="git-path" required error={err('pathInRepo')} hint="versions.json liegt daneben.">
              <Input id="git-path" value={form.pathInRepo} onChange={(e) => set({ pathInRepo: e.target.value })} className="font-mono text-[13px]" autoComplete="off" />
            </Field>
            <Field label="Autor (Ersatz)" htmlFor="git-author" error={err('authorName')} hint="Für Commits des Dienstes selbst.">
              <Input id="git-author" value={form.authorName} onChange={(e) => set({ authorName: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="E-Mail (Ersatz)" htmlFor="git-email" error={err('authorEmail')} hint="Wenn die E-Mail der Person unbekannt ist.">
              <Input id="git-email" type="email" value={form.authorEmail} onChange={(e) => set({ authorEmail: e.target.value })} autoComplete="off" placeholder="tiermodel@contoso.com" />
            </Field>
          </div>
          <label htmlFor="git-push" className="flex items-center justify-between gap-4 rounded-lg border px-3.5 py-3">
            <span className="grid">
              <span className="text-[13px] font-medium">Bei jeder gespeicherten Version übertragen</span>
              <span className="text-xs text-muted-foreground">Aus: nur mit „Jetzt synchronisieren“ (ein Sammel-Commit ohne Personenbezug).</span>
            </span>
            <Switch id="git-push" checked={form.pushOnSave} onCheckedChange={(v) => set({ pushOnSave: v })} />
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" disabled={!dirty} onClick={() => { setForm(base); setErrors({}) }}>Zurücksetzen</Button>
            <Button type="submit" disabled={!dirty} loading={save.isPending}>{!save.isPending && <Save />} Git-Anbindung speichern</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function StatusPanel({ status: st, onSync, syncing, onResolve, resolving }: { status: GitStatus; onSync: () => void; syncing: boolean; onResolve: () => void; resolving: boolean }) {
  return (
    <div className="grid gap-3">
      {st.conflict && (
        <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-900 dark:text-rose-200">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1 basis-64">
            Im Repository wurde die Konfiguration außerhalb des Dienstes geändert{st.conflictSince && ` (seit ${formatDateTime(st.conflictSince)})`}. Bis zur Klärung wird nichts übertragen.
          </span>
          <Button size="xs" variant="destructive" onClick={onResolve} loading={resolving}>Remote übernehmen</Button>
        </div>
      )}
      {!st.conflict && st.lastError && st.state === 'error' && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">
            {st.lastError}
            {st.nextRetryAt && <span className="text-muted-foreground"> · nächster Versuch {formatRelative(st.nextRetryAt)}</span>}
          </span>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-[13px] sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Letzte Synchronisierung</dt>
          <dd className="mt-0.5 truncate font-medium" title={st.lastSyncAt ? formatDateTime(st.lastSyncAt) : undefined}>{st.lastSyncAt ? formatRelative(st.lastSyncAt) : '–'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Letzter Commit</dt>
          <dd className="mt-0.5 flex items-center gap-1 font-mono font-medium" data-testid="git-last-commit">
            {st.lastCommit ? <><GitCommitHorizontal className="size-3.5 text-muted-foreground" />{st.lastCommit.slice(0, 7)}</> : '–'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Ausstehend</dt>
          <dd className="mt-0.5 font-medium tabular">{st.pending}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Letzter Fehler</dt>
          <dd className="mt-0.5 truncate font-medium" title={st.lastError ?? undefined}>{st.lastErrorAt ? formatRelative(st.lastErrorAt) : '–'}</dd>
        </div>
      </dl>
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onSync} loading={syncing} disabled={st.conflict || st.busy}>
          {!syncing && <RefreshCw />} Jetzt synchronisieren
        </Button>
      </div>
    </div>
  )
}
