import * as React from 'react'
import { ChevronDown, KeyRound } from 'lucide-react'
import { Combobox } from '@/components/ui/combobox'
import { Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { TierBadge } from '@/components/shared/badges'
import { buildGroupTierMap, BROAD, principalTier, targetTier } from '@/lib/tier-rules'
import { cn } from '@/lib/utils'
import { AD_RIGHTS } from '../editors'
import { CheckboxGrid, FormSection, useOuOptions } from '../form-helpers'
import { ALL_OBJECTS_LABEL, PrincipalCombobox, useObjectTypeOptions } from '../lookups'
import {
  buildDelegationPlan,
  CUSTOM_PRESET,
  DELEGATION_PRESETS,
  delegationIssues,
  delegationTierExplanation,
  groupsOf,
  INHERITANCE_LABELS,
  matchPreset,
} from './wizard-model'
import { AclTemplateLine, RIGHT_LABELS } from './wizard-fields'
import { blockedReason, PlanSummary, TierCheck, useApplyPlan, useWizardContents, useWizardState, WizardDialog, type WizardStep } from './wizard-shell'
import { t } from '@/i18n'

const COMMON_OBJECT_TYPES = ['Computer', 'User', 'Group', 'OrganizationalUnit', 'Contact', 'AllObjectClasses', 'PasswordReset', 'LockoutTime', 'UserAccountOption', 'LogonScript', 'DnsHostname', 'WriteSPN']

function TierOf({ tier }: { tier: number | null }) {
  if (tier === null) return <span className="text-xs text-muted-foreground">{t('config.wizards.delegationWizard.noTierDetected')}</span>
  if (tier === BROAD) return <span className="text-xs text-muted-foreground">{t('config.wizards.delegationWizard.broadGroupBelowAllTiers')}</span>
  return <TierBadge tier={tier as 0 | 1 | 2} />
}

export function DelegationWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { contents, ready } = useWizardContents(open)
  const apply = useApplyPlan()
  const w = useWizardState()
  const ouOptions = useOuOptions()
  const typeOptions = useObjectTypeOptions(COMMON_OBJECT_TYPES)

  const first = DELEGATION_PRESETS[0].entries[0]
  const [principal, setPrincipal] = React.useState('')
  const [rights, setRights] = React.useState<string[]>(first.activedirectoryrights)
  const [objecttype, setObjecttype] = React.useState(first.objecttype)
  const [inheritedObjectType, setInheritedObjectType] = React.useState('')
  const [inheritance, setInheritance] = React.useState(first.activeDirectorysecurityinheritance)
  const [allow, setAllow] = React.useState(true)
  const [target, setTarget] = React.useState('')
  const [comment, setComment] = React.useState('')
  const [advanced, setAdvanced] = React.useState(false)

  const template = { objecttype, activedirectoryrights: rights, activeDirectorysecurityinheritance: inheritance, inheritedObjectType }
  const preset = matchPreset(template)
  const choosePreset = (id: string) => {
    if (id === CUSTOM_PRESET) return setAdvanced(true)
    const tt = DELEGATION_PRESETS.find((p) => p.id === id)!.entries[0]
    setRights(tt.activedirectoryrights)
    setObjecttype(tt.objecttype)
    setInheritance(tt.activeDirectorysecurityinheritance)
    setInheritedObjectType(tt.inheritedObjectType ?? '')
  }

  const dirty = !!principal || !!target || !!comment || !allow || preset !== DELEGATION_PRESETS[0].id
  const reset = () => {
    w.reset()
    setPrincipal('')
    choosePreset(DELEGATION_PRESETS[0].id)
    setAllow(true)
    setTarget('')
    setComment('')
    setAdvanced(false)
  }
  const close = () => {
    onClose()
    setTimeout(reset, 200)
  }

  const input = { principal, rights, objecttype, inheritedObjectType, target, inheritance, allow, comment }
  const groupMap = React.useMemo(() => buildGroupTierMap(groupsOf(contents)), [contents])
  const liveIssues = React.useMemo(() => (ready && principal && target && rights.length ? delegationIssues(contents, input) : []), [ready, contents, JSON.stringify(input)]) // eslint-disable-line react-hooks/exhaustive-deps
  const plan = React.useMemo(() => (ready && w.step === 3 ? buildDelegationPlan(contents, input) : null), [ready, w.step, contents, JSON.stringify(input)]) // eslint-disable-line react-hooks/exhaustive-deps
  const explanation = delegationTierExplanation(contents, principal, target)

  const errWho: Record<string, string> = {}
  if (!principal.trim()) errWho.principal = t('config.wizards.delegationWizard.pleaseSelectAPrincipal')
  const errWhat: Record<string, string> = {}
  if (!rights.length) errWhat.rights = t('config.wizards.delegationWizard.selectAtLeastOneRight')
  const errWhere: Record<string, string> = {}
  if (!target.trim()) errWhere.target = t('config.wizards.delegationWizard.pleaseSelectATargetOu')
  const show = w.attempted

  const steps: WizardStep[] = [
    {
      id: 'who',
      label: t('config.wizards.delegationWizard.who'),
      errors: errWho,
      content: (
        <FormSection title={t('config.wizards.delegationWizard.whoGetsTheRights')} description={t('config.wizards.delegationWizard.groupFromTheConfigurationA')}>
          <Field label={t('config.wizards.delegationWizard.principal')} htmlFor="dw-principal" required error={show ? errWho.principal : undefined}>
            <PrincipalCombobox id="dw-principal" value={principal} onChange={setPrincipal} placeholder={t('config.wizards.delegationWizard.selectGroup')} invalid={show && !!errWho.principal} />
          </Field>
          {principal && (
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              {t('config.wizards.delegationWizard.detectedTier')} <TierOf tier={principalTier(principal, groupMap)} />
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t('config.wizards.delegationWizard.tipGrantRightsToGroups')}</p>
        </FormSection>
      ),
    },
    {
      id: 'what',
      label: t('config.wizards.delegationWizard.what'),
      errors: errWhat,
      content: (
        <>
          <FormSection title={t('config.wizards.delegationWizard.whichRights')}>
            <Field label={t('config.wizards.delegationWizard.template')} htmlFor="dw-preset">
              <Select
                id="dw-preset"
                value={preset}
                onValueChange={choosePreset}
                options={[
                  ...DELEGATION_PRESETS.map((p) => ({ value: p.id, label: p.label, description: p.description })),
                  { value: CUSTOM_PRESET, label: t('config.wizards.delegationWizard.custom'), description: t('config.wizards.delegationWizard.defineRightsObjectTypeAnd') },
                ]}
              />
            </Field>
            <Field label={t('config.wizards.delegationWizard.accessType')} htmlFor="dw-allow">
              <div id="dw-allow">
                <Segmented
                  aria-label={t('config.wizards.delegationWizard.accessType')}
                  value={allow ? 'allow' : 'deny'}
                  onValueChange={(v) => setAllow(v === 'allow')}
                  options={[
                    { value: 'allow', label: t('config.wizards.delegationWizard.allow') },
                    { value: 'deny', label: t('config.wizards.delegationWizard.deny') },
                  ]}
                />
              </div>
            </Field>
            <div className="rounded-lg border bg-card px-3.5 py-3">
              <AclTemplateLine t={template} allow={allow} />
              {errWhat.rights && show && <p className="mt-2 text-xs text-destructive" role="alert">{errWhat.rights}</p>}
            </div>
          </FormSection>
          <section className="grid gap-4">
            <button
              type="button"
              aria-expanded={advanced}
              aria-controls="dw-advanced"
              onClick={() => setAdvanced((a) => !a)}
              className="flex items-center gap-2 self-start rounded-md text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className={cn('size-4 transition-transform', !advanced && '-rotate-90')} />
              {t('config.wizards.delegationWizard.advancedAdjustRightsAndObject')}
            </button>
            {advanced && (
              <div id="dw-advanced" className="grid gap-4">
                <Field label={t('config.wizards.delegationWizard.rights')} required error={show ? errWhat.rights : undefined}>
                  <CheckboxGrid options={AD_RIGHTS} value={rights} onChange={setRights} describe={RIGHT_LABELS} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('config.wizards.delegationWizard.objectType')} htmlFor="dw-type" hint={t('config.wizards.delegationWizard.namesFromTheGuidMappings')}>
                    <Combobox id="dw-type" mono value={objecttype} onChange={setObjecttype} options={typeOptions} placeholder={ALL_OBJECTS_LABEL} searchPlaceholder={t('config.wizards.delegationWizard.searchObjectType')} />
                  </Field>
                  <Field label={t('config.wizards.delegationWizard.inheritedObjectType')} htmlFor="dw-itype" hint={t('config.wizards.delegationWizard.optionalOnlyDescendantsOfThis')}>
                    <Combobox id="dw-itype" mono value={inheritedObjectType} onChange={setInheritedObjectType} options={typeOptions} placeholder={ALL_OBJECTS_LABEL} searchPlaceholder={t('config.wizards.delegationWizard.searchObjectType')} />
                  </Field>
                </div>
              </div>
            )}
          </section>
        </>
      ),
    },
    {
      id: 'where',
      label: t('config.wizards.delegationWizard.where'),
      errors: errWhere,
      content: (
        <>
          <FormSection title={t('config.wizards.delegationWizard.onWhichOu')}>
            <Field label={t('config.wizards.delegationWizard.targetOu')} htmlFor="dw-target" required error={show ? errWhere.target : undefined}>
              <Combobox id="dw-target" mono value={target} onChange={setTarget} options={ouOptions} allowCustom={false} placeholder={t('config.wizards.delegationWizard.selectOu')} searchPlaceholder={t('config.wizards.delegationWizard.searchOu')} invalid={show && !!errWhere.target} />
            </Field>
            {target && (
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                {t('config.wizards.delegationWizard.tierOfTheOu')} <TierOf tier={targetTier(target)} />
              </p>
            )}
            <Field label={t('config.wizards.delegationWizard.inheritance')} htmlFor="dw-inh">
              <Select id="dw-inh" value={inheritance} onValueChange={setInheritance} options={Object.entries(INHERITANCE_LABELS).map(([value, label]) => ({ value, label, description: value }))} />
            </Field>
            <Field label={t('config.wizards.delegationWizard.comment')} htmlFor="dw-comment" hint={t('config.wizards.delegationWizard.optionalWhyDoesThisDelegation')}>
              <Textarea id="dw-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          </FormSection>
          {principal && target && (
            <section className="grid gap-3">
              <TierCheck issues={liveIssues} title={t('config.wizards.delegationWizard.liveCheckOfTheTier')} />
              {explanation && <p className="text-xs text-muted-foreground">{explanation}</p>}
            </section>
          )}
        </>
      ),
    },
    {
      id: 'summary',
      label: t('config.wizards.delegationWizard.summary'),
      errors: {},
      content: plan ? (
        <>
          <PlanSummary plan={plan} />
          {explanation && <p className="-mt-3 text-xs text-muted-foreground">{explanation}</p>}
        </>
      ) : null,
    },
  ]

  return (
    <WizardDialog
      open={open}
      onClose={close}
      title={t('config.wizards.delegationWizard.newDelegation')}
      description={t('config.wizards.delegationWizard.whoMayDoWhatOn')}
      icon={<KeyRound />}
      steps={steps}
      step={w.step}
      onStepChange={w.setStep}
      attempted={w.attempted}
      onAttempt={w.onAttempt}
      dirty={dirty}
      loading={!ready}
      finishBlocked={blockedReason(plan)}
      onFinish={() => {
        if (!plan) return
        apply(plan, t('config.wizards.delegationWizard.delegationForPrincipalCreated', { principal }), 'acls')
        close()
      }}
    />
  )
}
