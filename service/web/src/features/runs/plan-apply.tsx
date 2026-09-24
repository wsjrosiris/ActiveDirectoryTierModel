import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { RunRequest } from '@/api/types'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { scopeLabels } from '@/lib/labels'
import { errorMessage } from '@/lib/query'
import { formatDateTime } from '@/lib/utils'
import { includesFromRequest, settingsQuery } from './run-request-form'
import { applyTimingText, maintenanceStatusQuery } from './maintenance-notice'
import { useOptionalDomains } from '@/features/domains/domain-context'
import { t } from '@/i18n'
import { rich } from '@/i18n/rich'

/** Request of a run as shown on its detail page (includes as names). */
export function requestFromRun(r: { preferredDc: string; scope: RunRequest['scope']; includes: string[]; admlLanguage?: string }): RunRequest {
  return {
    preferredDc: r.preferredDc,
    scope: r.scope,
    includeMsa: r.includes.includes('Msa'),
    includeGmsa: r.includes.includes('Gmsa'),
    includeDmsa: r.includes.includes('Dmsa'),
    includeWinLaps: r.includes.includes('WinLaps'),
    admlLanguage: r.admlLanguage,
  }
}

/**
 * Starts an apply run from a reviewed planning run – after the same confirmation as the deploy page
 * (four-eyes submission, or typing ANWENDEN).
 */
export function useApplyPlan() {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const settings = useQuery(settingsQuery)
  const maintenance = useQuery(maintenanceStatusQuery)
  const domains = useOptionalDomains()

  const deploy = useMutation({
    // domain: the plan's domain (roadmap 17) – an apply always runs where its plan was made.
    mutationFn: ({ req, planRunId, domain }: { req: RunRequest; planRunId: number | null; domain?: string }) =>
      api.runs.deploy({ ...req, preferredDc: req.preferredDc.trim(), confirmApply: true, planRunId }, domain),
    meta: { silent: true },
    onError: (e, { planRunId }) => {
      // Usually the plan went stale in the meantime (configuration saved, plan expired): show why and refresh.
      toast.error(t('runs.planApply.applyNotPossible'), { description: errorMessage(e) })
      qc.invalidateQueries({ queryKey: ['plan-candidates'] })
      if (planRunId !== null) qc.invalidateQueries({ queryKey: ['run', planRunId] })
    },
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['plan-candidates'] })
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      if (run.status === 'AwaitingApproval') {
        toast.success(t('runs.planApply.deploymentIdSubmittedForApproval', { id: run.id }), { description: t('runs.planApply.aSecondOperatorMustApprove') })
      } else if (run.status === 'Scheduled') {
        toast.success(t('runs.planApply.deploymentIdScheduled', { id: run.id }), { description: t('runs.planApply.startsAutomaticallyInTheMaintenance', { scheduledFor: formatDateTime(run.scheduledFor) }) })
      } else {
        toast.success(t('runs.planApply.deploymentIdQueued', { id: run.id }), { description: t('runs.planApply.changesAreBeingApplied') })
      }
      navigate(`/laeufe/${run.id}`)
    },
  })

  const start = async (req: RunRequest, planRunId: number | null, changes?: number, domain?: string) => {
    const needsApproval = !!settings.data?.requireApproval
    const timing = applyTimingText(maintenance.data)
    const target = domains?.multiple ? (domain ? domains.domains.find((d) => d.key === domain) : domains.current) : null
    const scope = (
      <p className="text-foreground">
        {target && <>{t('runs.planApply.domainLabel')} <strong>{target.displayName}</strong>{target.dnsName ? ` (${target.dnsName})` : ''} · </>}
        {t('runs.planApply.scopeLabel')} <strong>{req.scope ? scopeLabels[req.scope] : t('runs.planApply.addOnsOnly')}</strong>
        {includesFromRequest(req).length > 0 && <> · {t('runs.planApply.addOnsLabel')} <strong>{includesFromRequest(req).join(', ')}</strong></>}
        {planRunId !== null && (
          <>
            {' '}· {t('runs.planApply.planLabel')} <strong>#{planRunId}</strong>
            {changes !== undefined && <> ({t('runs.planApply.changesCount', { count: changes })})</>}
          </>
        )}
      </p>
    )
    const ok = needsApproval
      ? await confirm({
          title: t('runs.planApply.submitDeploymentForApproval'),
          description: (
            <div className="grid gap-2">
              <p>
                {settings.data?.approvalTimeoutHours
                  ? rich(t('runs.planApply.approvalWithin'), { hours: <strong className="text-foreground">{t('runs.planApply.hours', { count: settings.data.approvalTimeoutHours })}</strong> })
                  : t('runs.planApply.approvalNeeded')}
                {planRunId !== null
                  ? t('runs.planApply.exactlyTheConfigurationVersionsOf')
                  : t('runs.planApply.theCurrentlySavedConfigurationVersions')}
              </p>
              <p>
                {rich(t('runs.planApply.afterApproval'), { dc: <span className="font-mono font-medium text-foreground">{req.preferredDc}</span> })}
              </p>
              {scope}
              {timing && <p className="text-sky-800 dark:text-sky-200">{timing}</p>}
            </div>
          ),
          confirmText: t('runs.planApply.submitForApproval'),
        })
      : await confirm({
          title: t('runs.planApply.applyChangesToActiveDirectory'),
          description: (
            <div className="grid gap-2">
              <p>
                {rich(t('runs.planApply.changesProduction'), { dc: <span className="font-mono font-medium text-foreground">{req.preferredDc}</span> })}
                {planRunId !== null
                  ? t('runs.planApply.exactlyTheConfigurationVersionsOf2')
                  : t('runs.planApply.runAPlanFirstAnd')}
              </p>
              {scope}
              {timing && <p className="text-sky-800 dark:text-sky-200">{timing}</p>}
            </div>
          ),
          confirmText: maintenance.data && !maintenance.data.allowedNow ? t('runs.planApply.scheduleForMaintenanceWindow') : t('runs.planApply.applyNow'),
          destructive: true,
          typeToConfirm: t('runs.planApply.confirmWord'),
        })
    if (ok) deploy.mutate({ req, planRunId, domain })
  }

  return { start, isPending: deploy.isPending, needsApproval: !!settings.data?.requireApproval, frozen: !!maintenance.data?.activeFreeze }
}
