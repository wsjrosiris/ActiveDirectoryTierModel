import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { AlertTriangle, ArrowRight, FlaskConical, Info, Lock, Rocket, ShieldAlert, UsersRound, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { PlanCandidate, RunRequest } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import { Page, PageHeader } from '@/components/shared/page-header'
import { useCan } from '@/features/auth/auth'
import { useDirtyKeys } from '@/features/config/draft-store'
import { scopeLabels } from '@/lib/labels'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { emptyRunRequest, includesFromRequest, RunRequestFields, runRequestError, settingsQuery } from './run-request-form'
import { useApplyPlan } from './plan-apply'
import { MaintenanceNotice } from './maintenance-notice'
import { planCountsText } from './plan-model'
import { t } from '@/i18n'
import { rich } from '@/i18n/rich'

type Mode = 'plan' | 'apply'

export function Component() {
  const canEdit = useCan('Editor')
  const canApply = useCan('Operator')
  const [req, setReq] = React.useState<RunRequest>(emptyRunRequest)
  const [mode, setMode] = React.useState<Mode>('plan')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const dirty = useDirtyKeys()
  const error = runRequestError(req)
  const settings = useQuery(settingsQuery)
  const needsApproval = mode === 'apply' && !!settings.data?.requireApproval

  const requirePlan = settings.data?.requirePlanBeforeApply ?? true
  const applyPlan = useApplyPlan()
  // Apply only via a reviewed planning run with the same parameters: look for one whenever they change.
  const candidates = useQuery({
    queryKey: ['plan-candidates', req],
    queryFn: () => api.runs.planCandidates(req),
    enabled: mode === 'apply' && requirePlan && !error && canApply,
    staleTime: 10_000,
    meta: { silent: true },
  })
  const candidate = requirePlan ? candidates.data?.candidate ?? null : null
  const blockedByPlan = mode === 'apply' && requirePlan && !candidate

  const deploy = useMutation({
    mutationFn: () => api.runs.deploy({ ...req, preferredDc: req.preferredDc.trim(), confirmApply: false }),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['plan-candidates'] })
      toast.success(t('runs.deploy.deploymentIdQueued', { id: run.id }), { description: t('runs.deploy.planRunWhatif') })
      navigate(`/laeufe/${run.id}`)
    },
  })

  const submit = () => {
    if (error) return
    if (mode === 'plan') deploy.mutate()
    else if (!requirePlan) applyPlan.start(req, null)
    else if (candidate) applyPlan.start(req, candidate.id, candidate.changes)
  }

  return (
    <Page>
      <PageHeader
        icon={<Rocket />}
        title={t('runs.deploy.deploy')}
        description={t('runs.deploy.transferTheDesiredConfigurationTo')}
      />
      {!canEdit && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          <Info className="size-4" /> {t('runs.deploy.yourRoleViewerDoesNot')}
        </div>
      )}
      {dirty.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-900 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" /> {t('runs.deploy.thereAreUnsavedConfigurationChanges')}
        </div>
      )}
      <form
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t('runs.deploy.mode')}</CardTitle>
                <CardDescription>{t('runs.deploy.aPlanRunShowsWhat')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div role="radiogroup" aria-label={t('runs.deploy.mode')} className="grid gap-3 sm:grid-cols-2">
                <ModeCard
                  checked={mode === 'plan'}
                  onSelect={() => setMode('plan')}
                  icon={<FlaskConical />}
                  title={t('runs.deploy.planWhatif')}
                  description={t('runs.deploy.simulationNoChangesToAd')}
                  tone="sky"
                  disabled={!canEdit}
                />
                <Tooltip content={canApply ? undefined : t('runs.deploy.requiresTheOperatorRole')} disabled={canApply}>
                  <div>
                    <ModeCard
                      checked={mode === 'apply'}
                      onSelect={() => setMode('apply')}
                      icon={<Zap />}
                      title={t('runs.deploy.apply')}
                      description={
                        !canApply
                          ? t('runs.deploy.operatorsOnly')
                          : requirePlan
                            ? t('runs.deploy.writeTheResultOfA')
                            : settings.data?.requireApproval
                              ? t('runs.deploy.writeToAdAfterApproval')
                              : t('runs.deploy.changesAreWrittenToAd')
                      }
                      tone="rose"
                      disabled={!canApply}
                    />
                  </div>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t('runs.deploy.parameters')}</CardTitle>
                <CardDescription>{t('runs.deploy.targetDcScopeAndOptional')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <RunRequestFields value={req} onChange={setReq} idPrefix="deploy" disabled={!canEdit} />
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card className={cn('overflow-hidden', mode === 'apply' && 'border-rose-500/40')}>
            <div className={cn('h-1', mode === 'apply' ? 'bg-gradient-to-r from-rose-500 to-orange-500' : 'bg-gradient-to-r from-sky-500 to-indigo-500')} />
            <CardHeader>
              <CardTitle>{t('runs.deploy.summary')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <dl className="grid gap-2.5 text-[13px]">
                <Row label={t('runs.deploy.mode')}>{mode === 'apply' ? <span className="font-medium text-rose-600 dark:text-rose-400">{t('runs.deploy.apply')}</span> : t('runs.deploy.planWhatif')}</Row>
                <Row label={t('runs.deploy.domainController')}><span className="font-mono">{req.preferredDc || '–'}</span></Row>
                <Row label={t('runs.deploy.scope')}>{req.scope ? scopeLabels[req.scope] : t('runs.deploy.noScope')}</Row>
                <Row label={t('runs.deploy.addOns')}>{includesFromRequest(req).join(', ') || '–'}</Row>
                {req.admlLanguage && <Row label={t('runs.deploy.admlLanguage')}><span className="font-mono">{req.admlLanguage}</span></Row>}
              </dl>
              {mode === 'apply' && requirePlan && canApply && (
                <PlanCandidateBox
                  loading={candidates.isLoading && !error}
                  invalid={!!error}
                  candidate={candidate}
                  reason={candidates.data?.reason ?? null}
                  latestPlanRunId={candidates.data?.latestPlanRunId ?? null}
                  maxAgeHours={candidates.data?.maxAgeHours ?? settings.data?.planMaxAgeHours ?? 24}
                  onPlan={() => setMode('plan')}
                />
              )}
              {mode === 'apply' && <MaintenanceNotice />}
              {needsApproval ? (
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                  <UsersRound className="size-4 shrink-0" />
                  <span>
                    <span className="font-medium">{t('runs.deploy.twoPersonRuleActive')}</span> {t('runs.deploy.theDeploymentIsSubmittedFor')}
                  </span>
                </div>
              ) : mode === 'apply' ? (
                <div className="flex gap-2 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-xs text-rose-800 dark:text-rose-200">
                  <ShieldAlert className="size-4 shrink-0" />
                  {t('runs.deploy.thisRunChangesActiveDirectory')}
                </div>
              ) : null}
              {error && canEdit && <p className="text-xs text-muted-foreground">{error}</p>}
              <Button
                type="submit"
                size="lg"
                variant={mode === 'apply' && !needsApproval ? 'destructive' : 'default'}
                disabled={!canEdit || !!error || blockedByPlan || (mode === 'apply' && applyPlan.frozen)}
                loading={deploy.isPending || applyPlan.isPending}
                className="h-auto min-h-10 w-full py-2 whitespace-normal"
              >
                {!(deploy.isPending || applyPlan.isPending) && (blockedByPlan ? <Lock /> : needsApproval ? <UsersRound /> : mode === 'apply' ? <Zap /> : <FlaskConical />)}
                {blockedByPlan || (mode === 'apply' && applyPlan.frozen)
                  ? t('runs.deploy.applyLocked')
                  : needsApproval
                    ? candidate ? t('runs.deploy.submitPlanIdForApproval', { id: candidate.id }) : t('runs.deploy.submitForApproval')
                    : mode === 'apply'
                      ? candidate ? t('runs.deploy.applyPlanId', { id: candidate.id }) : t('runs.deploy.applyDeployment')
                      : t('runs.deploy.startPlanRun')}
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>
    </Page>
  )
}

function PlanCandidateBox({
  loading,
  invalid,
  candidate,
  reason,
  latestPlanRunId,
  maxAgeHours,
  onPlan,
}: {
  loading: boolean
  invalid: boolean
  candidate: PlanCandidate | null
  reason: string | null
  latestPlanRunId: number | null
  maxAgeHours: number
  onPlan: () => void
}) {
  if (invalid) return null
  if (loading) return <div className="h-20 animate-pulse rounded-lg bg-muted/60" aria-label={t('runs.deploy.searchingForAMatchingPlan')} />
  if (candidate) {
    const counts = candidate.summary ? planCountsText(candidate.summary) : ''
    return (
      <div className="grid gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <span className="min-w-0 flex-1 text-[13px] font-medium">{t('runs.deploy.reviewedPlan')}{candidate.id}</span>
          <Link to={`/laeufe/${candidate.id}`} className="inline-flex items-center gap-0.5 text-sky-700 hover:underline dark:text-sky-300">
            {t('runs.deploy.view')} <ArrowRight className="size-3" />
          </Link>
        </div>
        <p className="text-muted-foreground">
          {candidate.requestedBy} · {formatRelative(candidate.finishedAt)} ·{' '}
          <span title={formatDateTime(candidate.expiresAt)}>{t('runs.deploy.validUntil')} {formatDateTime(candidate.expiresAt)}</span>
        </p>
        <p className="text-foreground">
          {candidate.changes === 0 ? t('runs.deploy.noChangesNeeded') : <>{rich(t('runs.deploy.changesCount', { count: candidate.changes }), { n: <strong className="tabular">{candidate.changes}</strong> })}{counts && <span className="text-muted-foreground"> ({counts})</span>}</>}
        </p>
      </div>
    )
  }
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-xs">
      <p className="flex items-center gap-2 text-[13px] font-medium"><Lock className="size-4 shrink-0 text-muted-foreground" /> {t('runs.deploy.startAPlanFirst')}</p>
      <p className="text-muted-foreground">
        {t('runs.deploy.applyRequiresPlan', { hours: maxAgeHours, count: maxAgeHours })}
      </p>
      {reason && <p className="text-foreground">{reason}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="xs" variant="outline" onClick={onPlan}><FlaskConical /> {t('runs.deploy.toPlanMode')}</Button>
        {latestPlanRunId && (
          <Button type="button" size="xs" variant="ghost" asChild>
            <Link to={`/laeufe/${latestPlanRunId}`}>{t('runs.deploy.viewPlan', { id: latestPlanRunId })}</Link>
          </Button>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  )
}

function ModeCard({
  checked,
  onSelect,
  icon,
  title,
  description,
  tone,
  disabled,
}: {
  checked: boolean
  onSelect: () => void
  icon: React.ReactNode
  title: string
  description: string
  tone: 'sky' | 'rose'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border bg-card p-3.5 text-left transition-all outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked && tone === 'sky' && 'border-sky-500/50 bg-sky-500/5 ring-1 ring-sky-500/30 hover:bg-sky-500/5',
        checked && tone === 'rose' && 'border-rose-500/50 bg-rose-500/5 ring-1 ring-rose-500/30 hover:bg-rose-500/5',
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-content-center rounded-lg [&_svg]:size-4',
          tone === 'sky' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
        )}
      >
        {icon}
      </span>
      <span className="grid">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
