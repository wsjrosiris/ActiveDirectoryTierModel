import * as React from 'react'
import { RotateCcw, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { Tooltip } from '@/components/ui/tooltip'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { TierBadgeFor, TierDot } from '@/components/shared/badges'
import { buildGroupTierMap, userTierIssues } from '@/lib/tier-rules'
import { FormSection, SwitchRow } from '../form-helpers'
import { TierRuleAlerts } from '../tier-rule-alerts'
import {
  buildAdminAccountPlan,
  defaultAccountsOu,
  groupsOf,
  ousOf,
  PROTECTED_USERS,
  suggestUserSam,
  tierOus,
  tierPrefix,
  userSamError,
  usersOf,
  USER_SAM_MAX,
  type TierNum,
} from './wizard-model'
import { Contained, shortDn, TierPicker } from './wizard-fields'
import { blockedReason, PlanSummary, useApplyPlan, useWizardContents, useWizardState, WizardDialog, type WizardStep } from './wizard-shell'
import { t } from '@/i18n'

export function AdminAccountWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { contents, ready } = useWizardContents(open)
  const apply = useApplyPlan()
  const w = useWizardState()

  const [tier, setTierState] = React.useState<TierNum>(1)
  const [displayName, setDisplayName] = React.useState('')
  const [sam, setSam] = React.useState<string | null>(null)
  const [description, setDescription] = React.useState('')
  const [enabled, setEnabled] = React.useState(true)
  const [ouPath, setOuPath] = React.useState<string | null>(null)
  const [memberOf, setMemberOf] = React.useState<string[]>([])
  const [protectedUsers, setProtectedUsers] = React.useState<boolean | null>(null)

  const setTier = (tt: TierNum) => {
    setTierState(tt)
    setOuPath(null)
    setProtectedUsers(null)
    // A typed name keeps its body, only the tier prefix follows the tier.
    setSam((s) => (s !== null && /^t[012]-/i.test(s) ? tierPrefix(tt) + s.slice(3) : s))
  }

  const ous = ousOf(contents)
  const groups = groupsOf(contents)
  const users = usersOf(contents)
  const suggestedSam = suggestUserSam(tier, displayName, users.map((u) => String(u.samAccountName ?? '')))
  const effSam = sam ?? suggestedSam
  const effOu = ouPath ?? defaultAccountsOu(ous, tier)
  const effProtected = protectedUsers ?? tier < 2

  const dirty = !!displayName || sam !== null || !!description || ouPath !== null || memberOf.length > 0 || protectedUsers !== null || !enabled || tier !== 1
  const reset = () => {
    w.reset()
    setTierState(1)
    setDisplayName('')
    setSam(null)
    setDescription('')
    setEnabled(true)
    setOuPath(null)
    setMemberOf([])
    setProtectedUsers(null)
  }
  const close = () => {
    onClose()
    setTimeout(reset, 200)
  }

  const ouOptions: ComboOption[] = React.useMemo(
    () => tierOus(ous, tier).map((x) => ({ value: x.dn, label: x.ou.name, hint: shortDn(x.dn), icon: <TierDot tier={tier} /> })),
    [ous, tier],
  )
  const groupOptions: ComboOption[] = React.useMemo(() => {
    const map = buildGroupTierMap(groups)
    return groups
      .filter((g) => map.get(String(g.samaccountname ?? '').toLowerCase()) === tier)
      .map((g) => ({ value: String(g.samaccountname), label: String(g.samaccountname), hint: g.name, icon: <TierDot tier={tier} /> }))
  }, [groups, tier])
  // Live check of the memberships (errors for more privileged tiers, warnings for less privileged ones).
  const membershipIssues = React.useMemo(() => userTierIssues({ ouPath: `OU=Tier ${tier}`, memberOf }, buildGroupTierMap(groups)), [tier, memberOf, groups])

  const input = { tier, samAccountName: effSam, displayName, description, ouPath: effOu, memberOf, protectedUsers: effProtected, enabled }
  const plan = React.useMemo(() => (ready && w.step === 2 ? buildAdminAccountPlan(contents, input) : null), [ready, w.step, contents, JSON.stringify(input)]) // eslint-disable-line react-hooks/exhaustive-deps

  const errAccount: Record<string, string> = {}
  if (!displayName.trim()) errAccount.displayName = t('config.wizards.adminAccountWizard.displayNameIsRequired')
  const samErr = userSamError(effSam, users)
  if (samErr) errAccount.sam = samErr
  const errPlace: Record<string, string> = {}
  if (!effOu) errPlace.ou = t('config.wizards.adminAccountWizard.noOuFromTierTier', { tier })
  const show = w.attempted
  const prefixOk = !effSam || effSam.toLowerCase().startsWith(tierPrefix(tier))

  const steps: WizardStep[] = [
    {
      id: 'account',
      label: t('config.wizards.adminAccountWizard.account'),
      errors: errAccount,
      content: (
        <FormSection title={t('config.wizards.adminAccountWizard.adminAccount')} description={t('config.wizards.adminAccountWizard.separatePrivilegedAccountNeverUse')}>
          <Field label={t('config.wizards.adminAccountWizard.tier')} htmlFor="aa-tier">
            <TierPicker id="aa-tier" value={tier} onChange={setTier} />
          </Field>
          <Field label={t('config.wizards.adminAccountWizard.displayName')} htmlFor="aa-dn" required error={show ? errAccount.displayName : undefined}>
            <Input id="aa-dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-invalid={show && !!errAccount.displayName} placeholder={t('config.wizards.adminAccountWizard.eGJohnDoeTier')} autoComplete="off" />
          </Field>
          <Field
            label={t('config.wizards.adminAccountWizard.samaccountname')}
            htmlFor="aa-sam"
            required
            error={errAccount.sam && (show || sam !== null) ? errAccount.sam : undefined}
            hint={
              !prefixOk ? (
                <span className="text-amber-700 dark:text-amber-300">{t('config.wizards.adminAccountWizard.prefixHint', { tier, prefix: tierPrefix(tier) })}</span>
              ) : (
                t('config.wizards.adminAccountWizard.pattern', { prefix: tierPrefix(tier), max: USER_SAM_MAX })
              )
            }
          >
            <div className="flex gap-2">
              <Input id="aa-sam" className="font-mono" value={effSam} maxLength={USER_SAM_MAX + 5} onChange={(e) => setSam(e.target.value)} aria-invalid={!!errAccount.sam && (show || sam !== null)} placeholder={`${tierPrefix(tier)}mmustermann`} autoComplete="off" />
              {sam !== null && sam !== suggestedSam && suggestedSam && (
                <Tooltip content={t('config.wizards.adminAccountWizard.useSuggestionSuggestedsam', { suggestedSam })}>
                  <Button type="button" variant="outline" size="icon" aria-label={t('config.wizards.adminAccountWizard.useSuggestionSuggestedsam', { suggestedSam })} onClick={() => setSam(null)}>
                    <RotateCcw />
                  </Button>
                </Tooltip>
              )}
            </div>
          </Field>
          <Field label={t('config.wizards.adminAccountWizard.description')} htmlFor="aa-desc">
            <Textarea id="aa-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('config.wizards.adminAccountWizard.tierTierAdministratorAccountOf', { tier })} />
          </Field>
          <SwitchRow id="aa-enabled" label={t('config.wizards.adminAccountWizard.accountEnabled')} description={t('config.wizards.adminAccountWizard.disabledAccountsAreCreatedBut')} checked={enabled} onCheckedChange={setEnabled} />
        </FormSection>
      ),
    },
    {
      id: 'place',
      label: t('config.wizards.adminAccountWizard.locationGroups'),
      errors: errPlace,
      content: (
        <>
          <FormSection title={t('config.wizards.adminAccountWizard.location')}>
            <Field label={t('config.wizards.adminAccountWizard.targetOu')} htmlFor="aa-ou" required error={show ? errPlace.ou : undefined} hint={t('config.wizards.adminAccountWizard.ousFromTierTierSuggested', { tier })}>
              <Combobox id="aa-ou" mono value={effOu} onChange={(v) => setOuPath(v)} options={ouOptions} allowCustom={false} placeholder={t('config.wizards.adminAccountWizard.selectOu')} searchPlaceholder={t('config.wizards.adminAccountWizard.searchOu')} invalid={show && !!errPlace.ou} />
            </Field>
            {effOu && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <TierBadgeFor text={effOu} /> <span className="min-w-0 truncate font-mono">{shortDn(effOu)}</span>
              </p>
            )}
          </FormSection>
          <FormSection title={t('config.wizards.adminAccountWizard.groupMemberships')} description={t('config.wizards.adminAccountWizard.suggestionsGroupsFromTierTier', { tier })}>
            <Contained>
            <MultiCombobox
              id="aa-groups"
              values={memberOf.filter((g) => g.toLowerCase() !== PROTECTED_USERS.toLowerCase())}
              onChange={setMemberOf}
              options={groupOptions}
              placeholder={t('config.wizards.adminAccountWizard.searchAndAddGroup')}
              emptyText={t('config.wizards.adminAccountWizard.noTierTierGroupFound', { tier })}
            />
            </Contained>
            <TierRuleAlerts issues={membershipIssues} />
            <SwitchRow
              id="aa-protected"
              label={t('config.wizards.adminAccountWizard.recommendedAddTier01')}
              description={t('config.wizards.adminAccountWizard.addsProtectedUsersToThe')}
              checked={effProtected}
              onCheckedChange={setProtectedUsers}
            />
          </FormSection>
        </>
      ),
    },
    {
      id: 'summary',
      label: t('config.wizards.adminAccountWizard.summary'),
      errors: {},
      content: plan ? <PlanSummary plan={plan} /> : null,
    },
  ]

  return (
    <WizardDialog
      open={open}
      onClose={close}
      title={t('config.wizards.adminAccountWizard.newAdminAccount')}
      description={t('config.wizards.adminAccountWizard.accountInTheRightTier')}
      icon={<UserPlus />}
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
        apply(plan, t('config.wizards.adminAccountWizard.adminAccountEffsamCreated', { effSam }), 'users')
        close()
      }}
    />
  )
}
