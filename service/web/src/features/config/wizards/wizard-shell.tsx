import * as React from 'react'
import { useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, FolderTree, Loader2, ScrollText, ShieldCheck, User, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog as D } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DialogOverlay } from '@/components/ui/dialog'
import { cn, modKey } from '@/lib/utils'
import { sectionFallbackTitles } from '@/lib/labels'
import { draftStore, useSectionContent } from '../draft-store'
import { sectionQuery } from '../queries'
import { TierRuleAlerts } from '../tier-rule-alerts'
import { hasErrors, type Contents, type Plan, type SectionKey } from './wizard-model'
import { t } from '@/i18n'

/* Stepper dialog shared by the configuration assistants. */

const WIZARD_SECTIONS = ['ous', 'groups', 'users', 'acls', 'gpos', 'guid-mappings'] as const

/** Draft-aware contents of every section an assistant reads; `ready` once all bases are loaded. */
export function useWizardContents(enabled: boolean): { contents: Contents; ready: boolean; failed: boolean } {
  const results = useQueries({ queries: WIZARD_SECTIONS.map((k) => ({ ...sectionQuery(k), enabled })) })
  const ous = useSectionContent('ous')
  const groups = useSectionContent('groups')
  const users = useSectionContent('users')
  const acls = useSectionContent('acls')
  const gpos = useSectionContent('gpos')
  const contents = React.useMemo(() => ({ ous, groups, users, acls, gpos }), [ous, groups, users, acls, gpos])
  // guid-mappings is only used for suggestions – the assistants work without it.
  const core = results.slice(0, 5)
  return { contents, ready: core.every((r) => r.isSuccess), failed: core.some((r) => r.isError) }
}

/** Applies a plan to the drafts as ONE undo step, confirms with a toast and opens the most relevant section. */
export function useApplyPlan() {
  const navigate = useNavigate()
  return React.useCallback(
    (plan: Plan, title: string, section: SectionKey) => {
      draftStore.apply(plan.updated)
      toast.success(title, { description: t('config.wizards.wizardShell.inTheDraftSaveTo') })
      navigate(`/konfiguration/${section}`)
    },
    [navigate],
  )
}

export interface WizardStep {
  id: string
  label: string
  /** Blocking messages of the step (field → message); empty when the step is complete. */
  errors: Record<string, string>
  content: React.ReactNode
}

export function WizardDialog({
  open,
  onClose,
  title,
  description,
  icon,
  steps,
  step,
  onStepChange,
  attempted,
  onAttempt,
  dirty,
  loading,
  finishLabel = t('config.wizards.wizardShell.applyToDraft'),
  finishBlocked,
  onFinish,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  icon: React.ReactNode
  steps: WizardStep[]
  step: number
  onStepChange: (i: number) => void
  /** Whether "Weiter" was tried on the current step (errors are shown from then on). */
  attempted: boolean
  onAttempt: () => void
  dirty: boolean
  loading?: boolean
  finishLabel?: string
  finishBlocked?: string | null
  onFinish: () => void
}) {
  const confirm = useConfirm()
  const confirming = React.useRef(false)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const current = steps[step]
  const last = step === steps.length - 1
  const firstInvalid = steps.findIndex((s) => Object.keys(s.errors).length > 0)

  const requestClose = async () => {
    if (confirming.current) return
    if (!dirty) return onClose()
    confirming.current = true
    const ok = await confirm({
      title: t('config.wizards.wizardShell.cancelAssistant'),
      description: t('config.wizards.wizardShell.yourInputInThisAssistant'),
      confirmText: t('config.wizards.wizardShell.cancelAndDiscard'),
      cancelText: t('config.wizards.wizardShell.continueEditing'),
      destructive: true,
    })
    confirming.current = false
    if (ok) onClose()
  }

  React.useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
    // Move focus to the first field of the new step (keyboard flow) – unless the user is already in the step.
    const raf = requestAnimationFrame(() => {
      const body = bodyRef.current
      if (!body || body.contains(document.activeElement)) return
      const el = body.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), button[role=combobox], [role=radio][data-state=checked], button[role=switch]')
      el?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(raf)
  }, [step, open, loading])

  const next = () => {
    if (Object.keys(current.errors).length) {
      onAttempt()
      setTimeout(() => bodyRef.current?.querySelector<HTMLElement>('[aria-invalid=true]')?.focus(), 0)
      return
    }
    if (last) onFinish()
    else onStepChange(step + 1)
  }

  return (
    <D.Root open={open} onOpenChange={(o) => !o && requestClose()}>
      <D.Portal>
        <DialogOverlay />
        <D.Content
          onInteractOutside={(e) => {
            e.preventDefault()
            if (!confirming.current) requestClose()
          }}
          className="fixed top-1/2 left-1/2 z-50 flex h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl shadow-black/10 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out sm:h-[min(760px,calc(100dvh-4rem))] sm:w-[calc(100vw-4rem)]"
        >
          {/* Header */}
          <div className="border-b px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
            <div className="flex items-start gap-3 pr-8">
              <div className="grid size-9 shrink-0 place-content-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4.5">{icon}</div>
              <div className="min-w-0">
                <D.Title className="text-base font-semibold tracking-tight">{title}</D.Title>
                <D.Description className="text-[13px] text-muted-foreground">{description}</D.Description>
              </div>
            </div>
            <Stepper steps={steps} step={step} firstInvalid={firstInvalid} onStepChange={onStepChange} />
          </div>
          <D.Close
            className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('common.close')}
            onClick={(e) => {
              e.preventDefault()
              requestClose()
            }}
          >
            <X className="size-4" />
          </D.Close>

          {/* Body */}
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-6" role="group" aria-label={t('config.wizards.wizardShell.stepValueLabel', { value: step + 1, label: current.label })}>
            {loading ? (
              <div className="grid h-full place-content-center gap-2 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto size-5 animate-spin" />
                {t('config.wizards.wizardShell.loadingConfiguration')}
              </div>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-6 [&_section]:grid-cols-[minmax(0,1fr)]">{current.content}</div>
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3 sm:px-6">
            <p className="hidden text-xs text-muted-foreground sm:block">
              {attempted && Object.keys(current.errors).length > 0 ? (
                <span className="text-destructive">{t('config.wizards.wizardShell.pleaseCompleteTheMarkedFields')}</span>
              ) : last && finishBlocked ? (
                <span className="text-destructive">{finishBlocked}</span>
              ) : (
                <>{t('config.wizards.wizardShell.step')} {step + 1} {t('config.wizards.wizardShell.of')} {steps.length}</>
              )}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={requestClose}>
                {t('common.cancel')}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={step === 0} onClick={() => onStepChange(step - 1)}>
                <ArrowLeft /> {t('common.back')}
              </Button>
              {last ? (
                <Button type="button" size="sm" disabled={loading || !!finishBlocked} onClick={next}>
                  <Check /> <span className="sm:hidden">{t('config.wizards.wizardShell.apply')}</span>
                  <span className="hidden sm:inline">{finishLabel}</span>
                </Button>
              ) : (
                <Button type="button" size="sm" disabled={loading} onClick={next}>
                  {t('config.wizards.wizardShell.next')} <ArrowRight />
                </Button>
              )}
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

function Stepper({ steps, step, firstInvalid, onStepChange }: { steps: WizardStep[]; step: number; firstInvalid: number; onStepChange: (i: number) => void }) {
  // A step can be jumped to when all steps before it are complete.
  const reachable = (i: number) => i <= step || firstInvalid === -1 || i <= firstInvalid
  return (
    <>
      <ol className="mt-4 hidden items-center gap-2 sm:flex" aria-label={t('config.wizards.wizardShell.steps')}>
        {steps.map((s, i) => {
          const done = i < step
          const active = i === step
          return (
            <li key={s.id} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
              <button
                type="button"
                disabled={!reachable(i)}
                onClick={() => onStepChange(i)}
                aria-current={active ? 'step' : undefined}
                className="group flex min-w-0 items-center gap-2 rounded-md py-0.5 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-content-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors',
                    active && 'border-primary bg-primary text-primary-foreground',
                    done && 'border-primary/40 bg-primary/10 text-primary',
                    !active && !done && 'bg-card text-muted-foreground',
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn('truncate text-[12.5px]', active ? 'font-medium text-foreground' : 'text-muted-foreground group-enabled:group-hover:text-foreground')}>{s.label}</span>
              </button>
              {i < steps.length - 1 && <span className={cn('h-px min-w-3 flex-1', done ? 'bg-primary/40' : 'bg-border')} aria-hidden />}
            </li>
          )
        })}
      </ol>
      <div className="mt-3 sm:hidden">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">{steps[step].label}</span>
          <span className="text-muted-foreground tabular-nums">{t('config.wizards.wizardShell.step')} {step + 1} {t('config.wizards.wizardShell.of')} {steps.length}</span>
        </div>
        <div className="mt-1.5 flex gap-1" aria-hidden>
          {steps.map((s, i) => (
            <span key={s.id} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-primary' : 'bg-border')} />
          ))}
        </div>
      </div>
    </>
  )
}

/** Step/attempt state for a wizard; `attempted` is per step. */
export function useWizardState() {
  const [step, setStep] = React.useState(0)
  const [attempted, setAttempted] = React.useState<Record<number, boolean>>({})
  return {
    step,
    setStep,
    attempted: !!attempted[step],
    onAttempt: () => setAttempted((a) => ({ ...a, [step]: true })),
    reset: () => {
      setStep(0)
      setAttempted({})
    },
  }
}

// ------------------------------------------------------------------ summary

const sectionIcons: Record<SectionKey, React.ReactNode> = {
  ous: <FolderTree />,
  groups: <Users />,
  users: <User />,
  acls: <ShieldCheck />,
  gpos: <ScrollText />,
}

/** Every change as a sentence, grouped by section, followed by the tier-rule check. */
export function PlanSummary({ plan }: { plan: Plan }) {
  const bySection = new Map<SectionKey, string[]>()
  for (const s of plan.sentences) {
    if (!bySection.has(s.section)) bySection.set(s.section, [])
    bySection.get(s.section)!.push(s.text)
  }
  const errors = plan.issues.filter((i) => i.severity === 'Error').length
  const warnings = plan.issues.length - errors
  return (
    <>
      <section className="grid gap-3" aria-labelledby="wiz-changes">
        <div>
          <h3 id="wiz-changes" className="text-[13px] font-semibold">{t('config.wizards.wizardShell.changesInTheDraft')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('config.wizards.wizardShell.appliedToTheDraftAs')} {modKey}{t('config.wizards.wizardShell.zAndOnlyEffectiveWith')}
          </p>
        </div>
        <div className="grid gap-2">
          {[...bySection.entries()].map(([section, texts]) => (
            <div key={section} className="rounded-lg border bg-card">
              <div className="flex items-center gap-2 border-b px-3 py-2 text-[12px] font-medium text-muted-foreground [&_svg]:size-3.5">
                {sectionIcons[section]}
                {sectionFallbackTitles[section] ?? section}
                <span className="ml-auto tabular-nums">{texts.length}</span>
              </div>
              <ul className="grid gap-1.5 px-3 py-2.5">
                {texts.map((tt, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-5">
                    <span className="mt-0.5 grid size-4 shrink-0 place-content-center rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" aria-hidden>
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <span className="min-w-0 break-words">{tt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <TierCheck issues={plan.issues} errors={errors} warnings={warnings} />
    </>
  )
}

export function TierCheck({ issues, errors, warnings, title = t('config.wizards.wizardShell.tierRuleCheck') }: { issues: Plan['issues']; errors?: number; warnings?: number; title?: string }) {
  const e = errors ?? issues.filter((i) => i.severity === 'Error').length
  const w = warnings ?? issues.length - e
  return (
    <section className="grid gap-3" aria-labelledby="wiz-check">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="wiz-check" className="text-[13px] font-semibold">{title}</h3>
        {issues.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {e > 0 && t('config.wizards.wizardShell.errors', { count: e })}
            {e > 0 && w > 0 && ' · '}
            {w > 0 && t('config.wizards.wizardShell.warnings', { count: w })}
          </span>
        )}
      </div>
      {issues.length === 0 ? (
        <div className="flex gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-800 dark:text-emerald-200" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <p>{t('config.wizards.wizardShell.noViolationsFoundControlOnly')}</p>
        </div>
      ) : (
        <TierRuleAlerts issues={issues} />
      )}
      {hasErrors(issues) && <p className="text-xs text-destructive">{t('config.wizards.wizardShell.errorsMustBeFixedBefore')}</p>}
    </section>
  )
}

export const blockedReason = (plan: Plan | null) => (plan && hasErrors(plan.issues) ? t('config.wizards.wizardShell.tierRuleOrConsistencyErrors') : null)

