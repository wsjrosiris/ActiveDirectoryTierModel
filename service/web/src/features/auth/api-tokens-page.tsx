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
import { t } from '@/i18n'

const expiryOptions = [
  { value: '30', label: t('auth.apiTokens.n30Days') },
  { value: '90', label: t('auth.apiTokens.n90Days') },
  { value: '180', label: t('auth.apiTokens.n180Days') },
  { value: '365', label: t('auth.apiTokens.n1Year') },
]

const stateBadge: Record<ApiToken['state'], React.ReactNode> = {
  Active: <Badge variant="success">{t('auth.apiTokens.active')}</Badge>,
  Expired: <Badge variant="muted">{t('auth.apiTokens.expired')}</Badge>,
  Revoked: <Badge variant="danger">{t('auth.apiTokens.revoked')}</Badge>,
  Inactive: <Badge variant="muted">{t('auth.apiTokens.accountDisabled')}</Badge>,
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
    mutationFn: (tt: ApiToken) => opsApi.tokens.revoke(tt.id),
    onSuccess: (tt) => {
      toast.success(t('auth.apiTokens.revokeTokenName', { name: tt.name }), { description: t('auth.apiTokens.scriptsUsingThisTokenWill') })
      qc.invalidateQueries({ queryKey: ['api-tokens'] })
    },
  })

  return (
    <Page>
      <PageHeader
        icon={<KeySquare />}
        title={t('auth.apiTokens.apiTokens')}
        description={t('auth.apiTokens.personalAccessKeysForScripts')}
        actions={<Button onClick={() => setCreating(true)}><Plus /> {t('auth.apiTokens.createToken')}</Button>}
      />
      {isAdmin && (
        <Segmented<'mine' | 'all'>
          aria-label={t('auth.apiTokens.show')}
          className="mb-3"
          value={scope}
          onValueChange={setScope}
          options={[{ value: 'mine', label: t('auth.apiTokens.myTokens') }, { value: 'all', label: t('auth.apiTokens.allUsers') }]}
        />
      )}
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !q.data?.length ? (
          <EmptyState
            icon={<KeySquare />}
            title={t('auth.apiTokens.noApiTokens')}
            description={t('auth.apiTokens.withATokenScriptsCan')}
            action={<Button size="sm" onClick={() => setCreating(true)}><Plus /> {t('auth.apiTokens.createToken')}</Button>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('common.name')}</TH>
                <TH>{t('common.role')}</TH>
                <TH className="hidden md:table-cell">{t('auth.apiTokens.lastUsed')}</TH>
                <TH className="hidden sm:table-cell">{t('auth.apiTokens.validUntil')}</TH>
                <TH>{t('common.status')}</TH>
                <TH className="w-10"><span className="sr-only">{t('common.actions')}</span></TH>
              </TR>
            </THead>
            <TBody>
              {q.data.map((tt) => (
                <TR key={tt.id} className={cn(tt.state !== 'Active' && 'text-muted-foreground')}>
                  <TD>
                    <p className="font-medium text-foreground">{tt.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      tmk_{tt.prefix}…{all && <span className="font-sans"> · {tt.username}{tt.userId === me.id && t('auth.apiTokens.you')}</span>}
                    </p>
                  </TD>
                  <TD>
                    <Badge variant="outline">{roleLabels[tt.role]}</Badge>
                    {tt.effectiveRole !== tt.role && (
                      <Tooltip content={t('auth.apiTokens.theAccountSRoleHas', { value: roleLabels[tt.effectiveRole] })}>
                        <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">{t('auth.apiTokens.actsAs')} {roleLabels[tt.effectiveRole]}</p>
                      </Tooltip>
                    )}
                  </TD>
                  <TD className="hidden text-[13px] md:table-cell" title={formatDateTime(tt.lastUsedAt)}>{tt.lastUsedAt ? formatRelative(tt.lastUsedAt) : t('auth.apiTokens.never')}</TD>
                  <TD className="hidden text-[13px] sm:table-cell" title={formatDateTime(tt.expiresAt)}>{formatDateTime(tt.expiresAt)}</TD>
                  <TD>
                    {tt.state === 'Revoked' ? (
                      <Tooltip content={tt.revokedBy ? t('auth.apiTokens.revokedAtBy', { at: formatDateTime(tt.revokedAt), by: tt.revokedBy }) : t('auth.apiTokens.revokedAt', { at: formatDateTime(tt.revokedAt) })}>{stateBadge.Revoked}</Tooltip>
                    ) : stateBadge[tt.state]}
                  </TD>
                  <TD>
                    {tt.state !== 'Revoked' && (
                      <Tooltip content={t('auth.apiTokens.revoke')}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:text-destructive"
                          aria-label={t('auth.apiTokens.revokeTokenName2', { name: tt.name })}
                          onClick={async () => {
                            if (await confirm({
                              title: t('auth.apiTokens.revokeTokenName3', { name: tt.name }),
                              description: t('auth.apiTokens.scriptsUsingThisTokenWill2'),
                              confirmText: t('auth.apiTokens.revoke'),
                              destructive: true,
                            }))
                              revoke.mutate(tt)
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
      <p className="flex items-center gap-2 text-sm font-medium"><Terminal className="size-4 text-muted-foreground" /> {t('auth.apiTokens.usageInPowershell')}</p>
      <pre className="overflow-x-auto rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-xs leading-5">
        {`Import-Module TierModel.Service.Client
Connect-TierModelService -Uri ${location.origin} -Token (Read-Host -AsSecureString 'Token')
Start-TierModelAudit -PreferredDc dc01.contoso.local -Scope FullDeployment | Wait-TierModelRun`}
      </pre>
      <p className="text-xs text-muted-foreground">
        {t('auth.apiTokens.tokensAreOnlyAcceptedIn')} <span className="font-mono">{t('auth.apiTokens.authorizationBearer')}</span> {t('auth.apiTokens.headerATokenSRole')}
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
      toast.success(t('auth.apiTokens.tokenCopied'))
    } catch {
      toast.error(t('auth.apiTokens.copyingNotPossible'), { description: t('auth.apiTokens.pleaseSelectTheTokenAnd') })
    }
  }

  const error = !name.trim() ? t('auth.apiTokens.nameIsRequired') : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('auth.apiTokens.token')}{created.info.name}{t('auth.apiTokens.created')}</DialogTitle>
              <DialogDescription>{t('auth.apiTokens.role')} {roleLabels[created.info.role]}{t('auth.apiTokens.validUntil2')} {formatDateTime(created.info.expiresAt)}.</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-px size-4 shrink-0" />
              <p>
                <span className="font-medium">{t('auth.apiTokens.theTokenIsOnlyShown')}</span> {t('auth.apiTokens.copyItToASecure')}
              </p>
            </div>
            <div className="flex min-w-0 gap-2">
              <Input readOnly value={created.token} aria-label={t('auth.apiTokens.apiToken')} className="min-w-0 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} data-testid="new-token" />
              <Button type="button" variant="outline" onClick={copy} aria-label={t('auth.apiTokens.copyToken')}>
                {copied ? <Check /> : <Copy />} {copied ? t('auth.apiTokens.copied') : t('auth.apiTokens.copy')}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>{t('auth.apiTokens.done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); if (!error) create.mutate() }}>
            <DialogHeader>
              <DialogTitle>{t('auth.apiTokens.createApiToken')}</DialogTitle>
              <DialogDescription>{t('auth.apiTokens.forScriptsAndAutomationThe')}</DialogDescription>
            </DialogHeader>
            <Field label={t('common.name')} htmlFor="tok-name" required hint={t('auth.apiTokens.whatIsTheTokenUsed')}>
              <Input id="tok-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus autoComplete="off" />
            </Field>
            <div className="grid gap-2">
              <p className="text-[13px] font-medium">{t('common.role')}</p>
              <div role="radiogroup" aria-label={t('auth.apiTokens.tokenRole')} className="grid gap-2 sm:grid-cols-2">
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
              <p className="text-xs text-muted-foreground">{t('auth.apiTokens.atMostYourOwnRole')}{roleLabels[ownRole]}{t('auth.apiTokens.chooseTheSmallestRoleThe')}</p>
            </div>
            <Field label={t('auth.apiTokens.validity')} htmlFor="tok-days">
              <Segmented<string> aria-label={t('auth.apiTokens.validity')} className="w-fit max-w-full" value={days} onValueChange={setDays} options={expiryOptions} />
            </Field>
            <DialogFooter>
              {error && <span className="mr-auto self-center text-xs text-muted-foreground">{error}</span>}
              <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={!!error} loading={create.isPending}>{!create.isPending && <KeySquare />} {t('auth.apiTokens.createToken')}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
