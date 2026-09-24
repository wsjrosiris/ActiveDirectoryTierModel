import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban, Check, Copy, KeySquare, Plus, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { opsApi, type ApiToken, type CreatedToken } from '@/api/ops'
import type { Role } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { Page, PageHeader } from '@/components/shared/page-header'
import { useCan, useUser } from '@/features/auth/auth'
import { hasRole, roleDescriptions, roleLabels, roles } from '@/lib/roles'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'

const expiryOptions = [
  { value: '30', label: '30 Tage' },
  { value: '90', label: '90 Tage' },
  { value: '180', label: '180 Tage' },
  { value: '365', label: '1 Jahr' },
]

const stateBadge: Record<ApiToken['state'], React.ReactNode> = {
  Active: <Badge variant="success">Aktiv</Badge>,
  Expired: <Badge variant="muted">Abgelaufen</Badge>,
  Revoked: <Badge variant="danger">Widerrufen</Badge>,
  Inactive: <Badge variant="muted">Konto deaktiviert</Badge>,
}

export function Component() {
  const me = useUser()
  const isAdmin = useCan('Admin')
  const [scope, setScope] = React.useState<'mine' | 'all'>('mine')
  const all = isAdmin && scope === 'all'
  const q = useQuery({ queryKey: ['api-tokens', all], queryFn: () => opsApi.tokens.list(all) })
  const [creating, setCreating] = React.useState(false)
  const qc = useQueryClient()
  const confirm = useConfirm()
  const revoke = useMutation({
    mutationFn: (t: ApiToken) => opsApi.tokens.revoke(t.id),
    onSuccess: (t) => {
      toast.success(`Token „${t.name}“ widerrufen`, { description: 'Skripte mit diesem Token werden ab sofort abgewiesen.' })
      qc.invalidateQueries({ queryKey: ['api-tokens'] })
    },
  })

  return (
    <Page>
      <PageHeader
        icon={<KeySquare />}
        title="API-Tokens"
        description="Persönliche Zugangsschlüssel für Skripte und Automatisierung, z. B. mit dem PowerShell-Modul TierModel.Service.Client."
        actions={<Button onClick={() => setCreating(true)}><Plus /> Token erstellen</Button>}
      />
      {isAdmin && (
        <Segmented<'mine' | 'all'>
          aria-label="Anzeige"
          className="mb-3"
          value={scope}
          onValueChange={setScope}
          options={[{ value: 'mine', label: 'Meine Tokens' }, { value: 'all', label: 'Alle Benutzer' }]}
        />
      )}
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !q.data?.length ? (
          <EmptyState
            icon={<KeySquare />}
            title="Keine API-Tokens"
            description="Mit einem Token können Skripte Audits starten, Läufe abfragen oder geprüfte Planungen anwenden – mit höchstens Ihrer eigenen Rolle."
            action={<Button size="sm" onClick={() => setCreating(true)}><Plus /> Token erstellen</Button>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Rolle</TH>
                <TH className="hidden md:table-cell">Zuletzt benutzt</TH>
                <TH className="hidden sm:table-cell">Gültig bis</TH>
                <TH>Status</TH>
                <TH className="w-10"><span className="sr-only">Aktionen</span></TH>
              </TR>
            </THead>
            <TBody>
              {q.data.map((t) => (
                <TR key={t.id} className={cn(t.state !== 'Active' && 'text-muted-foreground')}>
                  <TD>
                    <p className="font-medium text-foreground">{t.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      tmk_{t.prefix}…{all && <span className="font-sans"> · {t.username}{t.userId === me.id && ' (Sie)'}</span>}
                    </p>
                  </TD>
                  <TD>
                    <Badge variant="outline">{roleLabels[t.role]}</Badge>
                    {t.effectiveRole !== t.role && (
                      <Tooltip content={`Die Rolle des Kontos wurde herabgestuft: das Token wirkt nur noch als ${roleLabels[t.effectiveRole]}.`}>
                        <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">wirkt als {roleLabels[t.effectiveRole]}</p>
                      </Tooltip>
                    )}
                  </TD>
                  <TD className="hidden text-[13px] md:table-cell" title={formatDateTime(t.lastUsedAt)}>{t.lastUsedAt ? formatRelative(t.lastUsedAt) : 'Nie'}</TD>
                  <TD className="hidden text-[13px] sm:table-cell" title={formatDateTime(t.expiresAt)}>{formatDateTime(t.expiresAt)}</TD>
                  <TD>
                    {t.state === 'Revoked' ? (
                      <Tooltip content={`Widerrufen ${formatDateTime(t.revokedAt)}${t.revokedBy ? ` von ${t.revokedBy}` : ''}`}>{stateBadge.Revoked}</Tooltip>
                    ) : stateBadge[t.state]}
                  </TD>
                  <TD>
                    {t.state !== 'Revoked' && (
                      <Tooltip content="Widerrufen">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Token ${t.name} widerrufen`}
                          onClick={async () => {
                            if (await confirm({
                              title: `Token „${t.name}“ widerrufen?`,
                              description: 'Skripte, die dieses Token verwenden, werden sofort abgewiesen. Das lässt sich nicht rückgängig machen.',
                              confirmText: 'Widerrufen',
                              destructive: true,
                            }))
                              revoke.mutate(t)
                          }}
                        >
                          <Ban />
                        </Button>
                      </Tooltip>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <UsageHint />
      <CreateTokenDialog open={creating} onClose={() => setCreating(false)} ownRole={me.role} />
    </Page>
  )
}

function UsageHint() {
  return (
    <Card className="mt-6 grid gap-2 p-5">
      <p className="flex items-center gap-2 text-sm font-medium"><Terminal className="size-4 text-muted-foreground" /> Verwendung in PowerShell</p>
      <pre className="overflow-x-auto rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-xs leading-5">
        {`Import-Module TierModel.Service.Client
Connect-TierModelService -Uri ${location.origin} -Token (Read-Host -AsSecureString 'Token')
Start-TierModelAudit -PreferredDc dc01.contoso.local -Scope FullDeployment | Wait-TierModelRun`}
      </pre>
      <p className="text-xs text-muted-foreground">
        Tokens werden nur im Header <span className="font-mono">Authorization: Bearer …</span> akzeptiert. Die Rolle eines Tokens ist nie höher als die aktuelle Rolle
        des Kontos; wird das Konto deaktiviert, funktioniert auch das Token nicht mehr.
      </p>
    </Card>
  )
}

function CreateTokenDialog({ open, onClose, ownRole }: { open: boolean; onClose: () => void; ownRole: Role }) {
  const [name, setName] = React.useState('')
  const [role, setRole] = React.useState<Role>('Viewer')
  const [days, setDays] = React.useState('90')
  const [created, setCreated] = React.useState<CreatedToken | null>(null)
  const [copied, setCopied] = React.useState(false)
  const qc = useQueryClient()

  React.useEffect(() => {
    if (!open) return
    setName('')
    setRole(ownRole === 'Admin' ? 'Operator' : ownRole)
    setDays('90')
    setCreated(null)
    setCopied(false)
  }, [open, ownRole])

  const create = useMutation({
    mutationFn: () => opsApi.tokens.create({ name: name.trim(), role, expiresInDays: Number(days) }),
    onSuccess: (r) => {
      setCreated(r)
      qc.invalidateQueries({ queryKey: ['api-tokens'] })
    },
  })

  const copy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
      toast.success('Token kopiert')
    } catch {
      toast.error('Kopieren nicht möglich', { description: 'Bitte das Token markieren und manuell kopieren.' })
    }
  }

  const error = !name.trim() ? 'Name ist erforderlich.' : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Token „{created.info.name}“ erstellt</DialogTitle>
              <DialogDescription>Rolle {roleLabels[created.info.role]}, gültig bis {formatDateTime(created.info.expiresAt)}.</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-px size-4 shrink-0" />
              <p>
                <span className="font-medium">Das Token wird nur jetzt angezeigt.</span> Kopieren Sie es in einen sicheren Speicher (z. B. einen Passwort-Tresor
                oder SecretManagement). Wer das Token kennt, handelt mit Ihren Rechten bis zur gewählten Rolle.
              </p>
            </div>
            <div className="flex min-w-0 gap-2">
              <Input readOnly value={created.token} aria-label="API-Token" className="min-w-0 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} data-testid="new-token" />
              <Button type="button" variant="outline" onClick={copy} aria-label="Token kopieren">
                {copied ? <Check /> : <Copy />} {copied ? 'Kopiert' : 'Kopieren'}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Fertig</Button>
            </DialogFooter>
          </>
        ) : (
          <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); if (!error) create.mutate() }}>
            <DialogHeader>
              <DialogTitle>API-Token erstellen</DialogTitle>
              <DialogDescription>Für Skripte und Automatisierung. Das Token wird nach dem Erstellen genau einmal angezeigt.</DialogDescription>
            </DialogHeader>
            <Field label="Name" htmlFor="tok-name" required hint="Wofür wird das Token verwendet? z. B. „Nächtliches Audit-Skript“">
              <Input id="tok-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus autoComplete="off" />
            </Field>
            <div className="grid gap-2">
              <p className="text-[13px] font-medium">Rolle</p>
              <div role="radiogroup" aria-label="Rolle des Tokens" className="grid gap-2 sm:grid-cols-2">
                {roles.map((r) => {
                  const allowed = hasRole(ownRole, r)
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={role === r}
                      disabled={!allowed}
                      onClick={() => setRole(r)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
                        role === r && 'border-primary/50 bg-primary/5 ring-1 ring-primary/30',
                      )}
                    >
                      <span className={cn('grid size-4 shrink-0 place-content-center rounded-full border', role === r ? 'border-primary bg-primary' : 'border-input')}>
                        {role === r && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                      </span>
                      <span className="grid min-w-0">
                        <span className="text-[13px] font-medium">{roleLabels[r]}</span>
                        <span className="text-xs text-muted-foreground">{roleDescriptions[r]}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">Höchstens Ihre eigene Rolle ({roleLabels[ownRole]}). Wählen Sie die kleinste Rolle, die das Skript braucht.</p>
            </div>
            <Field label="Gültigkeit" htmlFor="tok-days">
              <Segmented<string> aria-label="Gültigkeit" className="w-fit max-w-full" value={days} onValueChange={setDays} options={expiryOptions} />
            </Field>
            <DialogFooter>
              {error && <span className="mr-auto self-center text-xs text-muted-foreground">{error}</span>}
              <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
              <Button type="submit" disabled={!!error} loading={create.isPending}>{!create.isPending && <KeySquare />} Token erstellen</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
