import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Pencil, PlugZap, Plus, Server, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { Combobox } from '@/components/ui/combobox'
import { transferApi, type RemoteCheckResult, type RemoteInstance } from '@/api/transfer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useCan } from '@/features/auth/auth'
import { errorMessage } from '@/lib/query'
import { cn, formatRelative } from '@/lib/utils'
import { t } from '@/i18n'

export const instancesQuery = { queryKey: ['config', 'remote-instances'], queryFn: transferApi.instances }

export function CheckResult({ result, className }: { result: RemoteCheckResult | { ok: boolean; message: string }; className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]',
        result.ok
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
          : 'border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-200',
        className,
      )}
    >
      {result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
      <span className="min-w-0 break-words">{result.message}</span>
    </p>
  )
}

/** Choice of a saved instance plus management (add / edit / remove) for administrators. */
export function RemoteInstancePicker({
  value,
  onChange,
  remoteDomain = '',
  onRemoteDomainChange,
}: {
  value: string
  onChange: (id: string) => void
  /** Domain of the other instance to import from (roadmap 17); '' = its default domain. */
  remoteDomain?: string
  onRemoteDomainChange?: (key: string) => void
}) {
  const isAdmin = useCan('Admin')
  const q = useQuery(instancesQuery)
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = React.useState<RemoteInstance | 'new' | null>(null)
  const [check, setCheck] = React.useState<RemoteCheckResult | null>(null)
  const instances = q.data ?? []
  const selected = instances.find((i) => i.id === value)

  React.useEffect(() => {
    if (!value && instances.length) onChange(instances[0].id)
  }, [instances, value, onChange])
  React.useEffect(() => setCheck(null), [value])

  const checkMutation = useMutation({
    mutationFn: (id: string) => transferApi.checkInstance({ id }),
    onSuccess: (r) => {
      setCheck(r)
      qc.invalidateQueries({ queryKey: instancesQuery.queryKey })
    },
  })
  const remove = async (i: RemoteInstance) => {
    const ok = await confirm({
      title: t('config.import.remoteInstances.removeInstanceName', { name: i.name }),
      description: t('config.import.remoteInstances.theStoredApiTokenIs'),
      confirmText: t('common.remove'),
      destructive: true,
    })
    if (!ok) return
    try {
      await transferApi.removeInstance(i.id)
      onChange('')
      await qc.invalidateQueries({ queryKey: instancesQuery.queryKey })
      toast.success(t('config.import.remoteInstances.instanceRemoved'))
    } catch (e) {
      toast.error(t('config.import.remoteInstances.removalFailed'), { description: errorMessage(e) })
    }
  }

  return (
    <div className="grid gap-3">
      {instances.length === 0 && !q.isLoading ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
          <Server className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">{t('config.import.remoteInstances.noInstanceStoredYet')}</p>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            {isAdmin
              ? t('config.import.remoteInstances.storeTheAddressOfThe')
              : t('config.import.remoteInstances.anAdministratorMustStoreThe')}
          </p>
          {isAdmin && (
            <Button size="sm" variant="outline" className="mt-1" onClick={() => setEditing('new')}>
              <Plus /> {t('config.import.remoteInstances.addInstance')}
            </Button>
          )}
        </div>
      ) : (
        <>
          <Field label={t('config.import.remoteInstances.instance')} htmlFor="imp-instance">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1 basis-56">
                <Select
                  id="imp-instance"
                  value={value}
                  onValueChange={onChange}
                  placeholder={q.isLoading ? t('config.import.remoteInstances.loading') : t('config.import.remoteInstances.selectInstance')}
                  options={instances.map((i) => ({ value: i.id, label: i.name, description: i.url }))}
                />
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1">
                  {selected && (
                    <>
                      <Button variant="ghost" size="icon-sm" aria-label={t('config.import.remoteInstances.editInstance')} onClick={() => setEditing(selected)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={t('config.import.remoteInstances.removeInstance')} onClick={() => remove(selected)}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
                    <Plus /> {t('common.add')}
                  </Button>
                </div>
              )}
            </div>
          </Field>
          {selected && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{selected.url}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('config.import.remoteInstances.token')} {selected.tokenHint} {t('config.import.remoteInstances.createdBy')} {selected.createdBy}
                    {selected.lastCheckedAt && <> {t('config.import.remoteInstances.lastChecked')} {formatRelative(selected.lastCheckedAt)}{selected.lastCheckOk === false && t('config.import.remoteInstances.failed')}</>}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => checkMutation.mutate(selected.id)} loading={checkMutation.isPending}>
                  {!checkMutation.isPending && <PlugZap />} {t('config.import.remoteInstances.testConnection')}
                </Button>
              </div>
              {check && <CheckResult result={check} />}
              {onRemoteDomainChange && ((check?.domains?.length ?? 0) > 1 || remoteDomain) && (
                <Field label={t('config.import.remoteInstances.domainOfTheRemoteInstance')} htmlFor="imp-remote-domain" hint={t('config.import.remoteInstances.theDomainOfTheOther')}>
                  <Combobox
                    id="imp-remote-domain"
                    value={remoteDomain}
                    onChange={onRemoteDomainChange}
                    options={[
                      { value: '', label: t('config.import.remoteInstances.defaultDomainOfTheRemote') },
                      ...(check?.domains ?? []).map((d) => ({ value: d.key, label: d.displayName, hint: d.dnsName || d.key })),
                    ]}
                    placeholder={t('config.import.remoteInstances.defaultDomainOfTheRemote')}
                    searchPlaceholder={t('config.import.remoteInstances.searchDomain')}
                    allowCustom={false}
                  />
                </Field>
              )}
            </div>
          )}
        </>
      )}
      {editing && (
        <InstanceDialog
          instance={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(i) => {
            onChange(i.id)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function InstanceDialog({ instance, onClose, onSaved }: { instance: RemoteInstance | null; onClose: () => void; onSaved: (i: RemoteInstance) => void }) {
  const qc = useQueryClient()
  const [name, setName] = React.useState(instance?.name ?? '')
  const [url, setUrl] = React.useState(instance?.url ?? 'https://')
  const [token, setToken] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  const [check, setCheck] = React.useState<RemoteCheckResult | null>(null)

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      instance
        ? transferApi.updateInstance(instance.id, { name: name.trim(), url: url.trim(), token: token.trim() || undefined })
        : transferApi.createInstance({ name: name.trim(), url: url.trim(), token: token.trim() }),
    onSuccess: async (i) => {
      await qc.invalidateQueries({ queryKey: instancesQuery.queryKey })
      toast.success(instance ? t('config.import.remoteInstances.instanceSaved') : t('config.import.remoteInstances.instanceAdded'))
      onSaved(i)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors)
      else toast.error(t('config.import.remoteInstances.savingFailed'), { description: errorMessage(e) })
    },
  })
  const test = useMutation({
    mutationFn: () => transferApi.checkInstance({ id: instance?.id, url: url.trim(), token: token.trim() || undefined }),
    onSuccess: setCheck,
  })
  const err = (k: string) => errors[k]?.[0]

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{instance ? t('config.import.remoteInstances.editInstance') : t('config.import.remoteInstances.addInstance')}</DialogTitle>
          <DialogDescription>
            {t('config.import.remoteInstances.anotherTiermodelInstanceFromWhich')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setErrors({})
            save.mutate()
          }}
        >
          <Field label={t('common.name')} htmlFor="ri-name" required error={err('name')}>
            <Input id="ri-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('config.import.remoteInstances.eGTest')} autoFocus />
          </Field>
          <Field label={t('config.import.remoteInstances.address')} htmlFor="ri-url" required error={err('url')} hint={t('config.import.remoteInstances.baseAddressOfTheInstance')}>
            <Input id="ri-url" value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono" inputMode="url" autoComplete="off" />
          </Field>
          <Field
            label={t('config.import.remoteInstances.apiToken')}
            htmlFor="ri-token"
            required={!instance}
            error={err('token')}
            hint={instance ? t('config.import.remoteInstances.leaveEmptyToKeepThe', { tokenHint: instance.tokenHint }) : t('config.import.remoteInstances.createItInTheOther')}
          >
            <Input id="ri-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="tmk_…" className="font-mono" autoComplete="off" />
          </Field>
          {check && <CheckResult result={check} />}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={() => test.mutate()} loading={test.isPending} disabled={!url.trim() || (!instance && !token.trim())}>
              {!test.isPending && <PlugZap />} {t('config.import.remoteInstances.testConnection')}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
              <Button type="submit" loading={save.isPending} disabled={!name.trim() || !url.trim() || (!instance && !token.trim())}>
                {t('common.save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
