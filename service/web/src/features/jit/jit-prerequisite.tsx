import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { AlertTriangle, Info, Loader2, RefreshCw, SearchCheck, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { jitApi, type JitOverview } from '@/api/jit'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/label'
import { useDomainControllerOptions } from '@/features/config/lookups'
import { errorMessage } from '@/lib/query'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { t } from '@/i18n'
import { rich } from '@/i18n/rich'

/** State of the forest prerequisite (Privileged Access Management feature) with an explanation when it is missing. */
export function PrerequisiteCard({ overview }: { overview: JitOverview }) {
  const p = overview.prerequisite
  const [checkOpen, setCheckOpen] = React.useState(false)
  const checkButton = overview.canCheck && (
    <Button variant="outline" size="sm" onClick={() => setCheckOpen(true)} disabled={p.status === 'Running'}>
      {p.status === 'Running' ? <Loader2 className="animate-spin" /> : p.status === 'Unknown' ? <SearchCheck /> : <RefreshCw />}
      {p.status === 'Unknown' ? t('jit.jitPrerequisite.checkNow') : t('jit.jitPrerequisite.checkAgain')}
    </Button>
  )
  const checked = p.checkedAt && (
    <span title={formatDateTime(p.checkedAt)}>{t('jit.jitPrerequisite.checkedAt', { when: formatRelative(p.checkedAt) })}{p.dc && <> {t('jit.jitPrerequisite.via')} <span className="font-mono">{p.dc}</span></>}</span>
  )

  let body: React.ReactNode
  if (p.status === 'Ready') {
    body = (
      <Row tone="emerald" icon={<ShieldCheck />} title={t('jit.jitPrerequisite.prerequisitesMet')} action={checkButton}>
        {t('jit.jitPrerequisite.privilegedAccessManagementFeatureIs')}{p.forestMode && <>{t('jit.jitPrerequisite.functionalLevel')} {p.forestMode}</>} – {checked}{t('jit.jitPrerequisite.activeDirectoryRemovesTimeLimited')}
      </Row>
    )
  } else if (p.status === 'NotReady') {
    body = (
      <div className="grid gap-4 p-5">
        <Row tone="rose" icon={<ShieldOff />} title={t('jit.jitPrerequisite.privilegedAccessManagementFeatureIs2')} action={checkButton} bare>
          {t('jit.jitPrerequisite.timeLimitedGroupMembershipsTime')} {checked}{t('jit.jitPrerequisite.untilANewCheckSucceeds')}
        </Row>
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-4 py-3 text-[13px]">
          <p className="font-medium">{t('jit.jitPrerequisite.theServiceDoesNotTurn')}</p>
          <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-muted-foreground marker:text-rose-500">
            <li><span className="text-foreground">{t('jit.jitPrerequisite.enablingItIsPermanent')}</span> {t('jit.jitPrerequisite.andCannotBeUndoneIt')}</li>
            <li>
              {t('jit.jitPrerequisite.theForestFunctionalLevelMust')}
              {p.forestMode && <> {t('jit.jitPrerequisite.currently')} <span className="font-mono text-foreground">{p.forestMode}</span>{p.forestLevelSufficient === false ? t('jit.jitPrerequisite.tooLow') : ''})</>}.
            </li>
            <li>
              {t('jit.jitPrerequisite.anEnterpriseAdministratorEnablesThe')}
              <code className="mt-1 block rounded-md border bg-muted/60 px-2 py-1.5 font-mono text-[12px] break-all text-foreground">
                Enable-ADOptionalFeature 'Privileged Access Management Feature' -Scope ForestOrConfigurationSet -Target contoso.com
              </code>
            </li>
            <li>{t('jit.jitPrerequisite.kerberosTicketsOfMembersOf')}</li>
          </ul>
          {p.messages.length > 0 && (
            <div className="mt-3 border-t border-rose-500/20 pt-2">
              <p className="text-xs font-medium text-muted-foreground">{t('jit.jitPrerequisite.checkMessages')}</p>
              <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
                {p.messages.map((m) => <li key={m} className="break-words">{m}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    )
  } else if (p.status === 'Running') {
    body = (
      <Row tone="sky" icon={<Loader2 className="animate-spin" />} title={t('jit.jitPrerequisite.checkingPrerequisites')} action={checkButton}>
        {rich(t('jit.jitPrerequisite.readOnlyCheck'), { dc: <span className="font-mono">{p.dc}</span> })}
        {p.runId && <> <Link to={`/laeufe/${p.runId}`} className="text-primary hover:underline">{t('jit.jitPrerequisite.run')}{p.runId}</Link></>}
      </Row>
    )
  } else if (p.status === 'Error') {
    body = (
      <Row tone="rose" icon={<AlertTriangle />} title={t('jit.jitPrerequisite.checkFailed')} action={checkButton}>
        {p.error} {p.runId && <Link to={`/laeufe/${p.runId}`} className="text-primary hover:underline">{t('jit.jitPrerequisite.logOfRun')}{p.runId}</Link>}
      </Row>
    )
  } else {
    body = (
      <Row tone="sky" icon={<Info />} title={t('jit.jitPrerequisite.prerequisitesNotCheckedYet')} action={checkButton}>
        {t('jit.jitPrerequisite.timeLimitedMembershipsRequireThe')} <span className="text-foreground">{t('jit.jitPrerequisite.privilegedAccessManagementFeature')}</span> {t('jit.jitPrerequisite.andTheWindowsServer2016')}
      </Row>
    )
  }

  return (
    <>
      <Card className={cn('mb-6 overflow-hidden', p.status === 'NotReady' && 'border-rose-500/30')}>{body}</Card>
      <CheckDialog open={checkOpen} onOpenChange={setCheckOpen} defaultDc={p.dc ?? overview.defaultDc ?? ''} />
    </>
  )
}

const tones = {
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
}

function Row({ tone, icon, title, action, children, bare }: {
  tone: keyof typeof tones; icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode; bare?: boolean
}) {
  return (
    <div className={cn('flex flex-wrap items-start gap-x-4 gap-y-3', !bare && 'p-4 sm:px-5')}>
      <span className={cn('grid size-9 shrink-0 place-content-center rounded-lg [&_svg]:size-[18px]', tones[tone])}>{icon}</span>
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{children}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function CheckDialog({ open, onOpenChange, defaultDc }: { open: boolean; onOpenChange: (o: boolean) => void; defaultDc: string }) {
  const qc = useQueryClient()
  const dcOptions = useDomainControllerOptions()
  const [dc, setDc] = React.useState(defaultDc)
  React.useEffect(() => { if (open) setDc(defaultDc) }, [open, defaultDc])
  const check = useMutation({
    mutationFn: () => jitApi.check(dc.trim()),
    meta: { silent: true },
    onSuccess: () => {
      toast.success(t('jit.jitPrerequisite.checkStarted'), { description: t('jit.jitPrerequisite.theResultAppearsInA') })
      qc.invalidateQueries({ queryKey: ['jit'] })
      onOpenChange(false)
    },
    onError: (e) => toast.error(t('jit.jitPrerequisite.checkNotPossible'), { description: errorMessage(e) }),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (dc.trim()) check.mutate() }}>
          <DialogHeader>
            <DialogTitle>{t('jit.jitPrerequisite.checkPrerequisites')}</DialogTitle>
            <DialogDescription>
              {t('jit.jitPrerequisite.readsWhetherThePrivilegedAccess')}
            </DialogDescription>
          </DialogHeader>
          <Field label={t('jit.jitPrerequisite.domainController')} htmlFor="jit-check-dc" required>
            <Combobox id="jit-check-dc" value={dc} onChange={setDc} options={dcOptions} placeholder={t('jit.jitPrerequisite.eGDc01ContosoCom')} searchPlaceholder={t('jit.jitPrerequisite.searchOrEnterDomainController')} mono />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={check.isPending} disabled={!dc.trim()}>{!check.isPending && <SearchCheck />} {t('jit.jitPrerequisite.check')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
