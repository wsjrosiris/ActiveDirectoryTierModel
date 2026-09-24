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
    () => [...catalog.values()].map(({ link, source }) => ({ value: link.name, label: link.name, hint: `${kindLabels[link.kind]} · verknüpft mit ${source.title}` })),
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
  if (!parentPath) errArea.parent = `Keine OU aus Tier ${tier} vorhanden – bitte zuerst eine anlegen.`
  else if (name && ous.some((o) => ouFullDn(o).toLowerCase() === dn.toLowerCase())) errArea.name = 'Eine OU mit diesem Namen existiert an dieser Stelle bereits.'
  const errGroup: Record<string, string> = {}
  if (!effGroupName.trim()) errGroup.groupName = 'Name ist erforderlich.'
  const samErr = groupSamError(effGroupSam, groups)
  if (samErr) errGroup.groupSam = samErr
  if (!effGroupOu) errGroup.groupOu = 'Ziel-OU ist erforderlich.'
  const show = w.attempted

  const presetObj = SERVER_RIGHTS_PRESETS.find((p) => p.id === preset)!
  const { links: previewLinks } = buildGpoTarget(effGpoNames, sources, effSource)
  const linkIssues = previewLinks.flatMap((l) => gpoLinkTierIssues(l.name, dn))

  const steps: WizardStep[] = [
    {
      id: 'area',
      label: 'Bereich',
      errors: errArea,
      content: (
        <>
          <FormSection title="Tier und Name" description="Wo im Tier-Modell liegen die neuen Server?">
            <Field label="Tier" htmlFor="sa-tier">
              <TierPicker id="sa-tier" value={tier} onChange={setTier} />
            </Field>
            {tier === 0 && (
              <Callout>
                <strong className="font-semibold">Tier 0 ist die höchste Schutzstufe.</strong> Server in Tier 0 können die gesamte Domäne kontrollieren – nur Systeme wie
                PKI, ADFS oder Identitätssynchronisation gehören hierher. Server-Bereiche entstehen üblicherweise in Tier 1 oder Tier 2.
              </Callout>
            )}
            <Field label="Name des Bereichs" htmlFor="sa-name" required error={show ? errArea.name : undefined} hint="Wird als OU-Name verwendet, z. B. „SQL Server“ oder „Webserver“.">
              <Input id="sa-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={show && !!errArea.name} placeholder="z. B. SQL Server" autoComplete="off" />
            </Field>
            <Field label="Übergeordnete OU" htmlFor="sa-parent" required error={show ? errArea.parent : undefined} hint={`OUs aus Tier ${tier}. Vorgeschlagen: die Member-Server-OU des Tiers.`}>
              <Combobox id="sa-parent" value={parentPath} onChange={(v) => setParent(v)} options={parentOptions} allowCustom={false} placeholder="OU wählen" searchPlaceholder="OU suchen …" invalid={show && !!errArea.parent} />
            </Field>
          </FormSection>
          <FormSection title="Struktur">
            <SwitchRow id="sa-staging" label="Staging-Unter-OU anlegen" description={`„${stagingName(name || 'Bereich')}“ nimmt neue Server auf, bevor sie in den Bereich verschoben werden.`} checked={staging} onCheckedChange={setStaging} />
            <DnPreview label="Neue OU" dn={name ? shortDn(dn) : ''} badge={name ? <TierBadgeFor text={dn} /> : undefined} />
            {staging && name && <DnPreview label="Staging-OU" dn={shortDn(stagingDn)} />}
          </FormSection>
        </>
      ),
    },
    {
      id: 'group',
      label: 'Gruppe',
      errors: errGroup,
      content: (
        <FormSection title="Admin-Gruppe für den Bereich" description="Mitglieder dieser Gruppe verwalten die Computerobjekte des neuen Bereichs.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="sa-gname" required error={show ? errGroup.groupName : undefined}>
              <Input id="sa-gname" value={effGroupName} onChange={(e) => setGroupName(e.target.value)} aria-invalid={show && !!errGroup.groupName} autoComplete="off" />
            </Field>
            <Field
              label="sAMAccountName"
              htmlFor="sa-gsam"
              required
              error={errGroup.groupSam && (show || groupSam !== null) ? errGroup.groupSam : undefined}
              hint="Vorschlag aus Tier und Name – eindeutig in der Konfiguration."
            >
              <div className="flex gap-2">
                <Input id="sa-gsam" className="font-mono" value={effGroupSam} onChange={(e) => setGroupSam(e.target.value)} aria-invalid={!!errGroup.groupSam && (show || groupSam !== null)} autoComplete="off" />
                {groupSam !== null && groupSam !== suggestedSam && (
                  <Tooltip content={`Vorschlag „${suggestedSam}“ verwenden`}>
                    <Button type="button" variant="outline" size="icon" aria-label={`Vorschlag „${suggestedSam}“ verwenden`} onClick={() => setGroupSam(null)}>
                      <RotateCcw />
                    </Button>
                  </Tooltip>
                )}
              </div>
            </Field>
          </div>
          <Field label="Beschreibung" htmlFor="sa-gdesc" hint="Optional – sonst wird eine Standardbeschreibung verwendet.">
            <Textarea id="sa-gdesc" rows={2} value={groupDesc} onChange={(e) => setGroupDesc(e.target.value)} placeholder={`Members of this group administer the Tier ${tier} ${name || '…'} servers`} />
          </Field>
          <Field label="Ziel-OU der Gruppe" htmlFor="sa-gou" required error={show ? errGroup.groupOu : undefined} hint={`Vorgeschlagen: die Gruppen-OU von Tier ${tier}.`}>
            <Combobox id="sa-gou" mono value={effGroupOu} onChange={(v) => setGroupOu(v)} options={groupOuOptions} allowCustom={false} placeholder="OU wählen" searchPlaceholder="OU suchen …" invalid={show && !!errGroup.groupOu} />
          </Field>
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline">Global</Badge>
            <Badge variant="outline">Sicherheitsgruppe</Badge>
          </div>
        </FormSection>
      ),
    },
    {
      id: 'rights',
      label: 'Rechte',
      errors: {},
      content: (
        <FormSection title="Delegierte Rechte" description={`„${effGroupSam || 'Gruppe'}“ erhält diese Rechte auf „${name || 'die neue OU'}“ und alle Unter-OUs.`}>
          <RadioCards
            label="Rechte-Vorlage"
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
            {presetObj.entries.length === 1 ? 'Es wird eine ACL-Delegation angelegt.' : `Es werden ${presetObj.entries.length} ACL-Delegationen angelegt.`} Feinere Rechte lassen sich später im Bereich
            „ACL-Delegationen“ oder mit dem Assistenten „Neue Delegation“ ergänzen.
          </p>
        </FormSection>
      ),
    },
    {
      id: 'gpos',
      label: 'GPOs',
      errors: {},
      content: (
        <FormSection title="GPO-Verknüpfungen" description={`GPOs, die bereits mit OUs aus Tier ${tier} verknüpft sind. Die Reihenfolge der Auswahl ist die Verknüpfungsreihenfolge.`}>
          {sources.length === 0 ? (
            <Callout tone="info">In Tier {tier} sind noch keine GPOs verknüpft – der Bereich wird ohne eigene GPO-Verknüpfungen angelegt.</Callout>
          ) : (
            <>
              <Field label="Vorlage übernehmen von" htmlFor="sa-gsrc" hint="Übernimmt die Verknüpfungen dieser OU – danach frei anpassbar.">
                <Select
                  id="sa-gsrc"
                  value={effSource}
                  onValueChange={(v) => {
                    setGpoSource(v)
                    setGpoNames(null)
                  }}
                  options={sources.map((s) => ({ value: s.key, label: s.title, description: `${s.links.length} GPO${s.links.length === 1 ? '' : 's'} · ${shortDn(s.key)}` }))}
                />
              </Field>
              <Field label="Zu verknüpfende GPOs" htmlFor="sa-gpos">
                <Contained><MultiCombobox id="sa-gpos" values={effGpoNames} onChange={setGpoNames} options={gpoOptions} allowCustom={false} placeholder="GPO suchen und hinzufügen …" /></Contained>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="xs" onClick={() => setGpoNames(null)} disabled={gpoNames === null}>
                  <RotateCcw /> Vorlage wiederherstellen
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => setGpoNames([])} disabled={effGpoNames.length === 0}>
                  Keine GPOs verknüpfen
                </Button>
              </div>
              {previewLinks.length > 0 && (
                <ol className="grid grid-cols-[minmax(0,1fr)] gap-1 rounded-lg border bg-card p-1.5" aria-label="Verknüpfungsreihenfolge">
                  {previewLinks.map((l) => (
                    <li key={l.name} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px]">
                      <span className="grid size-5 shrink-0 place-content-center rounded bg-muted text-[11px] font-semibold tabular-nums">{l.linkOrder}</span>
                      <span className="min-w-0 flex-1 truncate" title={l.name}>{l.name}</span>
                      <Badge variant={l.kind === 'PostConfigureGpo' ? 'info' : 'muted'} className="hidden sm:inline-flex">{kindLabels[l.kind]}</Badge>
                      {!l.linkEnabled && <Badge variant="outline">Link aus</Badge>}
                    </li>
                  ))}
                </ol>
              )}
              <TierRuleAlerts issues={linkIssues} />
              {effGpoNames.length > 0 && <p className="text-xs text-muted-foreground">Die neue OU blockiert die GPO-Vererbung, damit nur diese Verknüpfungen gelten.</p>}
            </>
          )}
        </FormSection>
      ),
    },
    {
      id: 'summary',
      label: 'Zusammenfassung',
      errors: {},
      content: plan ? <PlanSummary plan={plan} /> : null,
    },
  ]

  return (
    <WizardDialog
      open={open}
      onClose={close}
      title="Neuen Server-Bereich aufnehmen"
      description="OU, Admin-Gruppe, Rechte und GPO-Verknüpfungen in einem Schritt."
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
        apply(plan, `Server-Bereich „${name.trim()}“ angelegt`, 'ous')
        close()
      }}
    />
  )
}

