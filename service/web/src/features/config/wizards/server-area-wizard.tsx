import * as React from 'react'
import { RotateCcw, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Select } from '@/components/ui/select'
import { Tooltip } from '@/components/ui/tooltip'
import { TierBadgeFor, TierDot } from '@/components/shared/badges'
import { ouFullDn } from '@/lib/ou'
import { gpoLinkTierIssues } from '@/lib/tier-rules'
import { FormSection, SwitchRow } from '../form-helpers'
import { kindLabels } from '../gpo-model'
import { TierRuleAlerts } from '../tier-rule-alerts'
import {
  buildGpoTarget,
  buildServerAreaPlan,
  defaultGpoSource,
  defaultGroupsOu,
  defaultServerParent,
  gpoNameCatalog,
  gpoSources,
  groupSamError,
  groupsOf,
  ouNameError,
  ousOf,
  SERVER_RIGHTS_PRESETS,
  serverAreaDns,
  stagingName,
  suggestGroupName,
  suggestGroupSam,
  tierOus,
  type TierNum,
} from './wizard-model'
import { AclTemplateLine, Callout, Contained, DnPreview, RadioCards, shortDn, TierPicker } from './wizard-fields'
import { blockedReason, PlanSummary, useApplyPlan, useWizardContents, useWizardState, WizardDialog, type WizardStep } from './wizard-shell'
import { t } from '@/i18n'

export function ServerAreaWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { contents, ready } = useWizardContents(open)
  const apply = useApplyPlan()
  const w = useWizardState()

  const [tier, setTierState] = React.useState<TierNum>(1)
  const [name, setName] = React.useState('')
  const [parent, setParent] = React.useState<string | null>(null)
  const [staging, setStaging] = React.useState(true)
  const [groupName, setGroupName] = React.useState<string | null>(null)
  const [groupSam, setGroupSam] = React.useState<string | null>(null)
  const [groupDesc, setGroupDesc] = React.useState('')
  const [groupOu, setGroupOu] = React.useState<string | null>(null)
  const [preset, setPreset] = React.useState('full')
  const [gpoSource, setGpoSource] = React.useState<string | null>(null)
  const [gpoNames, setGpoNames] = React.useState<string[] | null>(null)

  const setTier = (tt: TierNum) => {
    setTierState(tt)
    setParent(null)
    setGroupOu(null)
    setGpoSource(null)
    setGpoNames(null)
  }

  const ous = ousOf(contents)
  const groups = groupsOf(contents)

  // ---- effective values (suggestions until the user overrides them)
  const parentPath = parent ?? defaultServerParent(ous, tier)
  const effGroupName = groupName ?? suggestGroupName(tier, name)
  const suggestedSam = suggestGroupSam(tier, name, groups.map((g) => String(g.samaccountname ?? '')))
  const effGroupSam = groupSam ?? suggestedSam
  const effGroupOu = groupOu ?? defaultGroupsOu(ous, tier)
  const sources = React.useMemo(() => gpoSources(contents.gpos, tier, parentPath), [contents.gpos, tier, parentPath])
  const effSource = gpoSource ?? defaultGpoSource(sources)?.key ?? ''
  const sourceObj = sources.find((s) => s.key === effSource)
  const effGpoNames = gpoNames ?? sourceObj?.links.map((l) => l.name) ?? []

  const dirty = !!name || parent !== null || groupName !== null || groupSam !== null || !!groupDesc || groupOu !== null || preset !== 'full' || gpoNames !== null || gpoSource !== null || !staging || tier !== 1

  const reset = () => {
    w.reset()
    setTierState(1)
    setName('')
    setParent(null)
    setStaging(true)
    setGroupName(null)
    setGroupSam(null)
    setGroupDesc('')
    setGroupOu(null)
    setPreset('full')
    setGpoSource(null)
    setGpoNames(null)
  }
  const close = () => {
    onClose()
    setTimeout(reset, 200)
  }

  // ---- options
  const parentOptions: ComboOption[] = React.useMemo(
    () =>
      tierOus(ous, tier).map((x) => ({ value: x.rel, label: x.ou.name, hint: shortDn(x.dn), icon: <TierDot tier={tier} /> })),
    [ous, tier],
  )
  const groupOuOptions: ComboOption[] = React.useMemo(
    () => tierOus(ous, tier).map((x) => ({ value: x.dn, label: x.ou.name, hint: shortDn(x.dn), icon: <TierDot tier={tier} /> })),
    [ous, tier],
  )
  const catalog = React.useMemo(() => gpoNameCatalog(sources), [sources])
  const gpoOptions: ComboOption[] = React.useMemo(
    () => [...catalog.values()].map(({ link, source }) => ({ value: link.name, label: link.name, hint: t('config.wizards.serverAreaWizard.valueLinkedToTitle', { value: kindLabels[link.kind], title: source.title }) })),
    [catalog],
  )

  const input = {
    tier,
    name,
    parentPath,
    staging,
    groupName: effGroupName,
    groupSam: effGroupSam,
    groupDescription: groupDesc,
    groupOu: effGroupOu,
    presetId: preset,
    gpoNames: effGpoNames,
    gpoSourceKey: effSource,
  }
  const { dn, stagingDn } = serverAreaDns({ name: name || '…', parentPath })
  const plan = React.useMemo(() => (ready && w.step === 4 ? buildServerAreaPlan(contents, input) : null), [ready, w.step, contents, JSON.stringify(input)]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- per-step errors
  const errArea: Record<string, string> = {}
  const nameErr = ouNameError(name)
  if (nameErr) errArea.name = nameErr
  if (!parentPath) errArea.parent = t('config.wizards.serverAreaWizard.noOuFromTierTier', { tier })
  else if (name && ous.some((o) => ouFullDn(o).toLowerCase() === dn.toLowerCase())) errArea.name = t('config.wizards.serverAreaWizard.anOuWithThisName')
  const errGroup: Record<string, string> = {}
  if (!effGroupName.trim()) errGroup.groupName = t('config.wizards.serverAreaWizard.nameIsRequired')
  const samErr = groupSamError(effGroupSam, groups)
  if (samErr) errGroup.groupSam = samErr
  if (!effGroupOu) errGroup.groupOu = t('config.wizards.serverAreaWizard.targetOuIsRequired')
  const show = w.attempted

  const presetObj = SERVER_RIGHTS_PRESETS.find((p) => p.id === preset)!
  const { links: previewLinks } = buildGpoTarget(effGpoNames, sources, effSource)
  const linkIssues = previewLinks.flatMap((l) => gpoLinkTierIssues(l.name, dn))

  const steps: WizardStep[] = [
    {
      id: 'area',
      label: t('config.wizards.serverAreaWizard.area'),
      errors: errArea,
      content: (
        <>
          <FormSection title={t('config.wizards.serverAreaWizard.tierAndName')} description={t('config.wizards.serverAreaWizard.whereInTheTierModel')}>
            <Field label={t('config.wizards.serverAreaWizard.tier')} htmlFor="sa-tier">
              <TierPicker id="sa-tier" value={tier} onChange={setTier} />
            </Field>
            {tier === 0 && (
              <Callout>
                <strong className="font-semibold">{t('config.wizards.serverAreaWizard.tier0IsTheHighest')}</strong> {t('config.wizards.serverAreaWizard.serversInTier0Can')}
              </Callout>
            )}
            <Field label={t('config.wizards.serverAreaWizard.nameOfTheArea')} htmlFor="sa-name" required error={show ? errArea.name : undefined} hint={t('config.wizards.serverAreaWizard.usedAsTheOuName')}>
              <Input id="sa-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={show && !!errArea.name} placeholder={t('config.wizards.serverAreaWizard.eGSqlServer')} autoComplete="off" />
            </Field>
            <Field label={t('config.wizards.serverAreaWizard.parentOu')} htmlFor="sa-parent" required error={show ? errArea.parent : undefined} hint={t('config.wizards.serverAreaWizard.ousFromTierTierSuggested', { tier })}>
              <Combobox id="sa-parent" value={parentPath} onChange={(v) => setParent(v)} options={parentOptions} allowCustom={false} placeholder={t('config.wizards.serverAreaWizard.selectOu')} searchPlaceholder={t('config.wizards.serverAreaWizard.searchOu')} invalid={show && !!errArea.parent} />
            </Field>
          </FormSection>
          <FormSection title={t('config.wizards.serverAreaWizard.structure')}>
            <SwitchRow id="sa-staging" label={t('config.wizards.serverAreaWizard.createStagingSubOu')} description={t('config.wizards.serverAreaWizard.valueReceivesNewServersBefore', { value: stagingName(name || t('config.wizards.serverAreaWizard.area')) })} checked={staging} onCheckedChange={setStaging} />
            <DnPreview label={t('config.wizards.serverAreaWizard.newOu')} dn={name ? shortDn(dn) : ''} badge={name ? <TierBadgeFor text={dn} /> : undefined} />
            {staging && name && <DnPreview label={t('config.wizards.serverAreaWizard.stagingOu')} dn={shortDn(stagingDn)} />}
          </FormSection>
        </>
      ),
    },
    {
      id: 'group',
      label: t('config.wizards.serverAreaWizard.group'),
      errors: errGroup,
      content: (
        <FormSection title={t('config.wizards.serverAreaWizard.adminGroupForTheArea')} description={t('config.wizards.serverAreaWizard.membersOfThisGroupManage')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.name')} htmlFor="sa-gname" required error={show ? errGroup.groupName : undefined}>
              <Input id="sa-gname" value={effGroupName} onChange={(e) => setGroupName(e.target.value)} aria-invalid={show && !!errGroup.groupName} autoComplete="off" />
            </Field>
            <Field
              label={t('config.wizards.serverAreaWizard.samaccountname')}
              htmlFor="sa-gsam"
              required
              error={errGroup.groupSam && (show || groupSam !== null) ? errGroup.groupSam : undefined}
              hint={t('config.wizards.serverAreaWizard.suggestionFromTierAndName')}
            >
              <div className="flex gap-2">
                <Input id="sa-gsam" className="font-mono" value={effGroupSam} onChange={(e) => setGroupSam(e.target.value)} aria-invalid={!!errGroup.groupSam && (show || groupSam !== null)} autoComplete="off" />
                {groupSam !== null && groupSam !== suggestedSam && (
                  <Tooltip content={t('config.wizards.serverAreaWizard.useSuggestionSuggestedsam', { suggestedSam })}>
                    <Button type="button" variant="outline" size="icon" aria-label={t('config.wizards.serverAreaWizard.useSuggestionSuggestedsam', { suggestedSam })} onClick={() => setGroupSam(null)}>
                      <RotateCcw />
                    </Button>
                  </Tooltip>
                )}
              </div>
            </Field>
          </div>
          <Field label={t('config.wizards.serverAreaWizard.description')} htmlFor="sa-gdesc" hint={t('config.wizards.serverAreaWizard.optionalOtherwiseADefaultDescription')}>
            <Textarea id="sa-gdesc" rows={2} value={groupDesc} onChange={(e) => setGroupDesc(e.target.value)} placeholder={`Members of this group administer the Tier ${tier} ${name || '…'} servers`} />
          </Field>
          <Field label={t('config.wizards.serverAreaWizard.targetOuOfTheGroup')} htmlFor="sa-gou" required error={show ? errGroup.groupOu : undefined} hint={t('config.wizards.serverAreaWizard.suggestedTheGroupsOuOf', { tier })}>
            <Combobox id="sa-gou" mono value={effGroupOu} onChange={(v) => setGroupOu(v)} options={groupOuOptions} allowCustom={false} placeholder={t('config.wizards.serverAreaWizard.selectOu')} searchPlaceholder={t('config.wizards.serverAreaWizard.searchOu')} invalid={show && !!errGroup.groupOu} />
          </Field>
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline">{t('config.wizards.serverAreaWizard.global')}</Badge>
            <Badge variant="outline">{t('config.wizards.serverAreaWizard.securityGroup')}</Badge>
          </div>
        </FormSection>
      ),
    },
    {
      id: 'rights',
      label: t('config.wizards.serverAreaWizard.rights'),
      errors: {},
      content: (
        <FormSection title={t('config.wizards.serverAreaWizard.delegatedRights')} description={t('config.wizards.serverAreaWizard.valueGetsTheseRightsOn', { value: effGroupSam || t('config.wizards.serverAreaWizard.group'), value2: name || t('config.wizards.serverAreaWizard.theNewOu') })}>
          <RadioCards
            label={t('config.wizards.serverAreaWizard.rightsTemplate')}
            value={preset}
            onChange={setPreset}
            options={SERVER_RIGHTS_PRESETS.map((p) => ({
              value: p.id,
              title: p.label,
              description: p.description,
              extra: p.id === preset ? p.entries.map((tt, i) => <AclTemplateLine key={i} t={tt} />) : undefined,
            }))}
          />
          <p className="text-xs text-muted-foreground">
            {presetObj.entries.length === 1 ? t('config.wizards.serverAreaWizard.oneAclDelegationIsCreated') : t('config.wizards.serverAreaWizard.lengthAclDelegationsAreCreated', { length: presetObj.entries.length })} {t('config.wizards.serverAreaWizard.finerRightsCanBeAdded')}
          </p>
        </FormSection>
      ),
    },
    {
      id: 'gpos',
      label: t('config.wizards.serverAreaWizard.gpos'),
      errors: {},
      content: (
        <FormSection title={t('config.wizards.serverAreaWizard.gpoLinks')} description={t('config.wizards.serverAreaWizard.gposAlreadyLinkedToOus', { tier })}>
          {sources.length === 0 ? (
            <Callout tone="info">{t('config.wizards.serverAreaWizard.inTier')} {tier} {t('config.wizards.serverAreaWizard.noGposAreLinkedYet')}</Callout>
          ) : (
            <>
              <Field label={t('config.wizards.serverAreaWizard.takeOverTemplateFrom')} htmlFor="sa-gsrc" hint={t('config.wizards.serverAreaWizard.takesOverTheLinksOf')}>
                <Select
                  id="sa-gsrc"
                  value={effSource}
                  onValueChange={(v) => {
                    setGpoSource(v)
                    setGpoNames(null)
                  }}
                  options={sources.map((s) => ({ value: s.key, label: s.title, description: `${t('config.wizards.serverAreaWizard.gpoCount', { count: s.links.length })} · ${shortDn(s.key)}` }))}
                />
              </Field>
              <Field label={t('config.wizards.serverAreaWizard.gposToLink')} htmlFor="sa-gpos">
                <Contained><MultiCombobox id="sa-gpos" values={effGpoNames} onChange={setGpoNames} options={gpoOptions} allowCustom={false} placeholder={t('config.wizards.serverAreaWizard.searchAndAddGpo')} /></Contained>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="xs" onClick={() => setGpoNames(null)} disabled={gpoNames === null}>
                  <RotateCcw /> {t('config.wizards.serverAreaWizard.restoreTemplate')}
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => setGpoNames([])} disabled={effGpoNames.length === 0}>
                  {t('config.wizards.serverAreaWizard.doNotLinkGpos')}
                </Button>
              </div>
              {previewLinks.length > 0 && (
                <ol className="grid grid-cols-[minmax(0,1fr)] gap-1 rounded-lg border bg-card p-1.5" aria-label={t('config.wizards.serverAreaWizard.linkOrder')}>
                  {previewLinks.map((l) => (
                    <li key={l.name} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px]">
                      <span className="grid size-5 shrink-0 place-content-center rounded bg-muted text-[11px] font-semibold tabular-nums">{l.linkOrder}</span>
                      <span className="min-w-0 flex-1 truncate" title={l.name}>{l.name}</span>
                      <Badge variant={l.kind === 'PostConfigureGpo' ? 'info' : 'muted'} className="hidden sm:inline-flex">{kindLabels[l.kind]}</Badge>
                      {!l.linkEnabled && <Badge variant="outline">{t('config.wizards.serverAreaWizard.linkOff')}</Badge>}
                    </li>
                  ))}
                </ol>
              )}
              <TierRuleAlerts issues={linkIssues} />
              {effGpoNames.length > 0 && <p className="text-xs text-muted-foreground">{t('config.wizards.serverAreaWizard.theNewOuBlocksGpo')}</p>}
            </>
          )}
        </FormSection>
      ),
    },
    {
      id: 'summary',
      label: t('config.wizards.serverAreaWizard.summary'),
      errors: {},
      content: plan ? <PlanSummary plan={plan} /> : null,
    },
  ]

  return (
    <WizardDialog
      open={open}
      onClose={close}
      title={t('config.wizards.serverAreaWizard.addNewServerArea')}
      description={t('config.wizards.serverAreaWizard.ouAdminGroupRightsAnd')}
      icon={<Server />}
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
        apply(plan, t('config.wizards.serverAreaWizard.serverAreaTrimCreated', { trim: name.trim() }), 'ous')
        close()
      }}
    />
  )
}

