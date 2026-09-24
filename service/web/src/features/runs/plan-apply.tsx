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
      toast.error('Anwenden nicht möglich', { description: errorMessage(e) })
      qc.invalidateQueries({ queryKey: ['plan-candidates'] })
      if (planRunId !== null) qc.invalidateQueries({ queryKey: ['run', planRunId] })
    },
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['plan-candidates'] })
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      if (run.status === 'AwaitingApproval') {
        toast.success(`Deploy #${run.id} zur Freigabe eingereicht`, { description: 'Ein zweiter Operator muss den Deploy freigeben, bevor er ausgeführt wird.' })
      } else if (run.status === 'Scheduled') {
        toast.success(`Deploy #${run.id} geplant`, { description: `Startet automatisch im Wartungsfenster: ${formatDateTime(run.scheduledFor)}.` })
      } else {
        toast.success(`Deploy #${run.id} eingereiht`, { description: 'Änderungen werden angewendet.' })
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
        {target && <>Domäne: <strong>{target.displayName}</strong>{target.dnsName ? ` (${target.dnsName})` : ''} · </>}
        Bereich: <strong>{req.scope ? scopeLabels[req.scope] : 'Nur Add-ons'}</strong>
        {includesFromRequest(req).length > 0 && <> · Add-ons: <strong>{includesFromRequest(req).join(', ')}</strong></>}
        {planRunId !== null && (
          <>
            {' '}· Planung <strong>#{planRunId}</strong>
            {changes !== undefined && <> ({changes === 1 ? '1 Änderung' : `${changes} Änderungen`})</>}
          </>
        )}
      </p>
    )
    const ok = needsApproval
      ? await confirm({
          title: 'Deploy zur Freigabe einreichen?',
          description: (
            <div className="grid gap-2">
              <p>
                Der Deploy wird erst ausgeführt, wenn ein zweiter Operator ihn freigibt
                {settings.data?.approvalTimeoutHours ? <> (innerhalb von <strong className="text-foreground">{settings.data.approvalTimeoutHours} Stunden</strong>, danach verfällt der Antrag)</> : null}.
                {planRunId !== null
                  ? ' Angewendet werden genau die Konfigurationsversionen der Planung.'
                  : ' Die aktuell gespeicherten Konfigurationsversionen werden dabei festgeschrieben.'}
              </p>
              <p>
                Nach der Freigabe verändert er das Active Directory über <span className="font-mono font-medium text-foreground">{req.preferredDc}</span>.
              </p>
              {scope}
              {timing && <p className="text-sky-800 dark:text-sky-200">{timing}</p>}
            </div>
          ),
          confirmText: 'Zur Freigabe einreichen',
        })
      : await confirm({
          title: 'Änderungen im Active Directory anwenden?',
          description: (
            <div className="grid gap-2">
              <p>
                Dieser Lauf verändert das produktive Active Directory über <span className="font-mono font-medium text-foreground">{req.preferredDc}</span>.
                {planRunId !== null
                  ? ' Angewendet werden genau die Konfigurationsversionen der geprüften Planung.'
                  : ' Führen Sie vorher einen Planungslauf aus und prüfen Sie dessen Ausgabe.'}
              </p>
              {scope}
              {timing && <p className="text-sky-800 dark:text-sky-200">{timing}</p>}
            </div>
          ),
          confirmText: maintenance.data && !maintenance.data.allowedNow ? 'Für Wartungsfenster planen' : 'Jetzt anwenden',
          destructive: true,
          typeToConfirm: 'ANWENDEN',
        })
    if (ok) deploy.mutate({ req, planRunId, domain })
  }

  return { start, isPending: deploy.isPending, needsApproval: !!settings.data?.requireApproval, frozen: !!maintenance.data?.activeFreeze }
}
