import * as React from 'react'
import { CheckCircle2, Circle, FolderTree, Pencil, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { TierBadge, TierBadgeFor } from '@/components/shared/badges'
import { OuTree } from '@/components/shared/ou-tree'
import { DOMAIN, ouFullDn, ouParentOptions, toFullDn, type OuItem } from '@/lib/ou'
import { tierOf, type Tier } from '@/lib/tier'
import { aclTierIssues, lapsTierIssues, userTierIssues } from '@/lib/tier-rules'
import { useGroupTierMap } from './tier-rule-alerts'
import { ListEditor, type Column, type FormProps, type Item } from './list-editor'
import {
  CheckboxGrid,
  FormSection,
  SwitchRow,
  setField,
  useGpoNameOptions,
  useOuOptions,
} from './form-helpers'
import { ALL_OBJECTS_LABEL, PrincipalCombobox, PrincipalMultiCombobox, useObjectTypeOptions } from './lookups'
import { useSectionContent } from './draft-store'
import { OuRenameDialog } from './ou-rename-dialog'
import { t } from '@/i18n'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

export interface EditorProps {
  sectionKey: string
  content: Json
  setContent: (next: Json, tag?: string) => void
  readOnly: boolean
}

function DnText({ value }: { value: string | undefined }) {
  if (!value) return <span className="text-muted-foreground">–</span>
  const short = value.replace(/,\{\{DOMAIN_DN\}\}$/, '')
  return (
    <span className="block max-w-[150px] truncate font-mono text-[12px] text-muted-foreground @4xl:max-w-[220px] @6xl:max-w-[340px]" title={value}>
      {short === DOMAIN ? t('config.editors.domainRoot') : short}
    </span>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12.5px] whitespace-nowrap">{children}</span>
}

const bool = (v: unknown) =>
  v ? <CheckCircle2 className="size-4 text-emerald-500" aria-label={t('common.yes')} /> : <Circle className="size-4 text-muted-foreground/40" aria-label={t('common.no')} />

function useListBinding(props: EditorProps, listKey: string) {
  const items: Item[] = Array.isArray(props.content?.[listKey]) ? props.content[listKey] : []
  const onItemsChange = React.useCallback(
    (next: Item[], tag?: string) => props.setContent({ ...props.content, [listKey]: next }, tag),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.content, props.setContent, listKey],
  )
  return { items, onItemsChange }
}

// ============================================================ OUs

const ouTier = (o: Item): Tier => tierOf(ouFullDn(o as OuItem))

function OuForm({ value, onChange, errors, index }: FormProps) {
  const content = useSectionContent('ous')
  const ous = (content?.organizationUnits ?? []) as OuItem[]
  const selfDn = index !== null && ous[index] ? ouFullDn(ous[index]) : undefined
  const parentOptions = React.useMemo(() => ouParentOptions(ous, selfDn), [ous, selfDn])
  const [renameOpen, setRenameOpen] = React.useState(false)
  const existing = index !== null

  return (
    <>
      <FormSection title={t('config.editors.general')}>
        <Field label={t('common.name')} htmlFor="ou-name" required error={errors.name} hint={existing ? t('config.editors.renamingAndMovingUpdateAll') : undefined}>
          <div className="flex gap-2">
            <Input id="ou-name" value={value.name ?? ''} readOnly={existing} onChange={(e) => onChange(setField(value, 'name', e.target.value))} aria-invalid={!!errors.name} placeholder={t('config.editors.eGTier0Accounts')} />
            {existing && (
              <Button type="button" variant="outline" onClick={() => setRenameOpen(true)}>
                <Pencil /> {t('config.editors.renameMove')}
              </Button>
            )}
          </div>
        </Field>
        <Field label={t('config.editors.parentOu')} htmlFor="ou-path" required error={errors.path} hint={existing ? t('config.editors.moveViaRenameMove') : t('config.editors.relativePathWithoutDomainSuffix')}>
          {existing ? (
            <Input id="ou-path" className="font-mono" value={value.path ?? ''} readOnly />
          ) : (
            <Combobox id="ou-path" mono value={value.path ?? ''} onChange={(v) => onChange(setField(value, 'path', v))} options={parentOptions} placeholder={t('config.editors.selectParentOu')} invalid={!!errors.path} />
          )}
        </Field>
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t('config.editors.distinguishedName')}</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="min-w-0 flex-1 font-mono text-[12px] break-all">{value.name ? ouFullDn(value as OuItem) : '–'}</p>
            <TierBadgeFor text={value.name ? ouFullDn(value as OuItem) : ''} />
          </div>
        </div>
        <Field label={t('config.editors.comment')} htmlFor="ou-comment">
          <Textarea id="ou-comment" rows={2} value={value.comment ?? ''} onChange={(e) => onChange(setField(value, 'comment', e.target.value, !('comment' in value)))} />
        </Field>
      </FormSection>
      <FormSection title={t('config.editors.protectionInheritance')}>
        <div className="grid gap-2">
          <SwitchRow id="ou-protect" label={t('config.editors.protectFromAccidentalDeletion')} checked={!!value.protectFromAccidentalDeletion} onCheckedChange={(v) => onChange(setField(value, 'protectFromAccidentalDeletion', v))} />
          <SwitchRow id="ou-inherit" label={t('config.editors.disableAclInheritance')} description={t('config.editors.permissionsOfTheParentOu')} checked={!!value.disableInheritance} onCheckedChange={(v) => onChange(setField(value, 'disableInheritance', v))} />
          <SwitchRow id="ou-gpo" label={t('config.editors.blockGpoInheritance')} description={t('config.editors.groupPoliciesOfParentContainers')} checked={!!value.blockGpoInheritance} onCheckedChange={(v) => onChange(setField(value, 'blockGpoInheritance', v))} />
        </div>
      </FormSection>
      {existing && index !== null && (
        <OuRenameDialog open={renameOpen} onOpenChange={setRenameOpen} index={index} onApplied={(name, path) => onChange({ ...value, name, path })} />
      )}
    </>
  )
}

export function OusEditor(props: EditorProps) {
  const { items, onItemsChange } = useListBinding(props, 'organizationUnits')
  const [view, setView] = React.useState<'table' | 'tree'>('table')
  const [rename, setRename] = React.useState<number | null>(null)
  const columns: Column[] = [
    { id: 'name', header: t('common.name'), cell: (o) => <span className="font-medium whitespace-nowrap">{o.name}</span>, sortValue: (o) => o.name ?? '' },
    { id: 'path', header: t('config.editors.parent'), cell: (o) => <DnText value={o.path} />, sortValue: (o) => toFullDn(o.path ?? '').split(',').reverse().join(',') },
    { id: 'tier', header: t('config.editors.tier'), cell: (o) => <TierBadge tier={ouTier(o)} short />, sortValue: (o) => String(ouTier(o) ?? 'z') },
    { id: 'protect', header: t('config.editors.protection'), cell: (o) => bool(o.protectFromAccidentalDeletion), className: 'hidden @2xl:table-cell' },
    { id: 'inh', header: t('config.editors.aclInheritOff'), cell: (o) => bool(o.disableInheritance), className: 'hidden @3xl:table-cell' },
    { id: 'gpo', header: t('config.editors.gpoBlock'), cell: (o) => bool(o.blockGpoInheritance), className: 'hidden @3xl:table-cell' },
    { id: 'comment', header: t('config.editors.comment'), cell: (o) => <span className="line-clamp-1 max-w-xs text-muted-foreground">{o.comment}</span>, className: 'hidden @5xl:table-cell' },
  ]
  return (
    <>
      <ListEditor
        items={items}
        onItemsChange={onItemsChange}
        columns={columns}
        searchText={(o) => `${o.name} ${o.path} ${o.comment ?? ''}`}
        tierOf={ouTier}
        itemLabel={(o) => o.name}
        newItem={() => ({ name: '', path: DOMAIN, protectFromAccidentalDeletion: true, disableInheritance: false, blockGpoInheritance: false, comment: '' })}
        Form={OuForm}
        entity={{ singular: t('config.editors.ou'), plural: t('config.editors.ous'), article: 'die' }}
        readOnly={props.readOnly}
        defaultSort="path"
        validate={(o, all, index) => {
          const e: Record<string, string> = {}
          if (!o.name?.trim()) e.name = t('config.editors.nameIsRequired')
          else if (/[,=+<>#;\\"]/.test(o.name)) e.name = t('config.editors.nameMustNotContainSpecial')
          if (!o.path?.trim()) e.path = t('config.editors.parentOuIsRequired')
          const dn = ouFullDn(o as OuItem).toLowerCase()
          if (o.name && all.some((x, i) => i !== index && ouFullDn(x as OuItem).toLowerCase() === dn)) e.name = t('config.editors.anOuWithThisName')
          const parent = toFullDn(o.path ?? '').toLowerCase()
          if (o.path && o.path !== DOMAIN && !all.some((x, i) => i !== index && ouFullDn(x as OuItem).toLowerCase() === parent))
            e.path = t('config.editors.parentOuDoesNotExist')
          return e
        }}
        extraActions={[{ label: t('config.editors.renameMove'), icon: <Pencil />, onSelect: (_o, i) => setRename(i) }]}
        toolbarExtra={
          <Segmented
            aria-label={t('config.editors.view')}
            value={view}
            onValueChange={setView}
            options={[
              { value: 'table', label: t('config.editors.table'), icon: <Table2 /> },
              { value: 'tree', label: t('config.editors.tree'), icon: <FolderTree /> },
            ]}
            className="[&_button]:h-7 [&_button]:px-2.5 [&_button]:text-xs"
          />
        }
        alternateView={
          view === 'tree'
            ? (open) => (
                <Card className="p-4">
                  <OuTree
                    ous={items as OuItem[]}
                    onSelect={open}
                    defaultExpandedDepth={3}
                    renderActions={
                      props.readOnly
                        ? undefined
                        : (n) => (
                            <Button type="button" variant="ghost" size="icon-xs" aria-label={t('config.editors.renameName', { name: n.ou.name })} onClick={() => setRename(n.index)}>
                              <Pencil />
                            </Button>
                          )
                    }
                  />
                </Card>
              )
            : undefined
        }
      />
      {rename !== null && (
        <OuRenameDialog open onOpenChange={(o) => !o && setRename(null)} index={rename} />
      )}
    </>
  )
}

// ============================================================ Groups

function GroupForm({ value, onChange, errors }: FormProps) {
  const ouOptions = useOuOptions()
  return (
    <>
      <FormSection title={t('config.editors.identity')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.name')} htmlFor="g-name" required error={errors.name}>
            <Input id="g-name" value={value.name ?? ''} onChange={(e) => onChange(setField(value, 'name', e.target.value))} aria-invalid={!!errors.name} placeholder={t('config.editors.eGTier0Admins')} />
          </Field>
          <Field label="sAMAccountName" htmlFor="g-sam" required error={errors.samaccountname}>
            <Input id="g-sam" className="font-mono" value={value.samaccountname ?? ''} onChange={(e) => onChange(setField(value, 'samaccountname', e.target.value))} aria-invalid={!!errors.samaccountname} placeholder="Tier0Admins" />
          </Field>
        </div>
        <Field label={t('config.editors.description')} htmlFor="g-desc">
          <Textarea id="g-desc" rows={2} value={value.description ?? ''} onChange={(e) => onChange(setField(value, 'description', e.target.value, !('description' in value)))} />
        </Field>
      </FormSection>
      <FormSection title={t('config.editors.typeLocation')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('config.editors.groupScope')} htmlFor="g-scope">
            <Select id="g-scope" value={value.groupscope} onValueChange={(v) => onChange(setField(value, 'groupscope', v))} options={[
              { value: 'Global', label: 'Global' },
              { value: 'Universal', label: 'Universal' },
              { value: 'DomainLocal', label: t('config.editors.domainLocal') },
            ]} />
          </Field>
          <Field label={t('config.editors.groupType')} htmlFor="g-cat">
            <Select id="g-cat" value={value.groupcategory} onValueChange={(v) => onChange(setField(value, 'groupcategory', v))} options={[
              { value: 'Security', label: t('config.editors.security') },
              { value: 'Distribution', label: t('config.editors.distribution') },
            ]} />
          </Field>
        </div>
        <Field label={t('config.editors.targetOu')} htmlFor="g-path" required error={errors.path}>
          <Combobox id="g-path" mono value={value.path ?? ''} onChange={(v) => onChange(setField(value, 'path', v))} options={ouOptions} placeholder={t('config.editors.selectOu')} invalid={!!errors.path} />
        </Field>
        <Field label={t('config.editors.comment')} htmlFor="g-comment">
          <Textarea id="g-comment" rows={2} value={value.comment ?? ''} onChange={(e) => onChange(setField(value, 'comment', e.target.value, !('comment' in value)))} />
        </Field>
      </FormSection>
    </>
  )
}

const groupTier = (g: Item): Tier => tierOf(g.name) ?? tierOf(g.path)

export function GroupsEditor(props: EditorProps) {
  const { items, onItemsChange } = useListBinding(props, 'groups')
  const scopeLabel: Record<string, string> = { Global: 'Global', Universal: 'Universal', DomainLocal: t('config.editors.domainLocal2') }
  return (
    <ListEditor
      items={items}
      onItemsChange={onItemsChange}
      columns={[
        { id: 'name', header: t('common.name'), cell: (g) => <span className="block min-w-[140px] font-medium">{g.name}</span>, sortValue: (g) => g.name ?? '' },
        { id: 'sam', header: 'sAMAccountName', cell: (g) => <Mono>{g.samaccountname}</Mono>, sortValue: (g) => g.samaccountname ?? '' },
        { id: 'scope', header: t('config.editors.scope'), cell: (g) => <Badge variant="outline">{scopeLabel[g.groupscope] ?? g.groupscope}</Badge>, sortValue: (g) => g.groupscope ?? '', className: 'hidden @2xl:table-cell' },
        { id: 'cat', header: t('config.editors.type'), cell: (g) => <span className="text-muted-foreground">{g.groupcategory === 'Security' ? t('config.editors.security') : g.groupcategory === 'Distribution' ? t('config.editors.distribution') : g.groupcategory}</span>, className: 'hidden @5xl:table-cell' },
        { id: 'path', header: 'OU', cell: (g) => <DnText value={g.path} />, sortValue: (g) => g.path ?? '', className: 'hidden @3xl:table-cell' },
      ]}
      searchText={(g) => `${g.name} ${g.samaccountname} ${g.description ?? ''} ${g.path ?? ''}`}
      tierOf={groupTier}
      itemLabel={(g) => g.name || g.samaccountname}
      newItem={() => ({ name: '', samaccountname: '', description: '', groupscope: 'Global', groupcategory: 'Security', path: '', comment: '' })}
      Form={GroupForm}
      entity={{ singular: t('config.editors.group'), plural: t('config.editors.groups'), article: 'die' }}
      readOnly={props.readOnly}
      defaultSort="name"
      validate={(g, all, index) => {
        const e: Record<string, string> = {}
        if (!g.name?.trim()) e.name = t('config.editors.nameIsRequired')
        if (!g.samaccountname?.trim()) e.samaccountname = t('config.editors.samaccountnameIsRequired')
        else if (/[\s"/\\[\]:;|=,+*?<>@]/.test(g.samaccountname)) e.samaccountname = t('config.editors.containsInvalidCharacters')
        else if (all.some((x, i) => i !== index && String(x.samaccountname).toLowerCase() === g.samaccountname.toLowerCase())) e.samaccountname = t('config.editors.thisSamaccountnameIsAlreadyIn')
        if (!g.path?.trim()) e.path = t('config.editors.targetOuIsRequired')
        return e
      }}
    />
  )
}

// ============================================================ Users

function UserForm({ value, onChange, errors }: FormProps) {
  const ouOptions = useOuOptions()
  const members: string[] = Array.isArray(value.memberOf) ? value.memberOf : []
  return (
    <>
      <FormSection title={t('config.editors.account')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="sAMAccountName" htmlFor="u-sam" required error={errors.samAccountName} hint={t('config.editors.max20Characters')}>
            <Input id="u-sam" className="font-mono" value={value.samAccountName ?? ''} onChange={(e) => onChange(setField(value, 'samAccountName', e.target.value))} aria-invalid={!!errors.samAccountName} placeholder="svc-beispiel" />
          </Field>
          <Field label={t('config.editors.displayName')} htmlFor="u-dn">
            <Input id="u-dn" value={value.displayName ?? ''} onChange={(e) => onChange(setField(value, 'displayName', e.target.value, !('displayName' in value)))} />
          </Field>
        </div>
        <Field label={t('config.editors.targetOu')} htmlFor="u-ou" required error={errors.ouPath}>
          <Combobox id="u-ou" mono value={value.ouPath ?? ''} onChange={(v) => onChange(setField(value, 'ouPath', v))} options={ouOptions} placeholder={t('config.editors.selectOu')} invalid={!!errors.ouPath} />
        </Field>
        <Field label={t('config.editors.description')} htmlFor="u-desc">
          <Textarea id="u-desc" rows={2} value={value.description ?? ''} onChange={(e) => onChange(setField(value, 'description', e.target.value, !('description' in value)))} />
        </Field>
        <SwitchRow id="u-enabled" label={t('config.editors.accountEnabled')} description={t('config.editors.serviceAccountsUsuallyStayDisabled')} checked={!!value.enabled} onCheckedChange={(v) => onChange(setField(value, 'enabled', v))} />
      </FormSection>
      <FormSection title={t('config.editors.groupMemberships')} description={t('config.editors.samaccountnameOfTheGroupsFrom')}>
        <PrincipalMultiCombobox id="u-member" values={members} onChange={(v) => onChange(setField(value, 'memberOf', v))} placeholder={t('config.editors.searchAndAddGroup')} />
      </FormSection>
      <Field label={t('config.editors.comment')} htmlFor="u-comment">
        <Textarea id="u-comment" rows={2} value={value.comment ?? ''} onChange={(e) => onChange(setField(value, 'comment', e.target.value, !('comment' in value)))} />
      </Field>
    </>
  )
}

export function UsersEditor(props: EditorProps) {
  const { items, onItemsChange } = useListBinding(props, 'users')
  const groupTiers = useGroupTierMap()
  return (
    <ListEditor
      items={items}
      onItemsChange={onItemsChange}
      hints={(u) => userTierIssues(u, groupTiers)}
      columns={[
        { id: 'sam', header: 'sAMAccountName', cell: (u) => <Mono>{u.samAccountName}</Mono>, sortValue: (u) => u.samAccountName ?? '' },
        { id: 'dn', header: t('config.editors.displayName'), cell: (u) => u.displayName, sortValue: (u) => u.displayName ?? '', className: 'hidden @2xl:table-cell' },
        { id: 'ou', header: 'OU', cell: (u) => <DnText value={u.ouPath} />, sortValue: (u) => u.ouPath ?? '' },
        { id: 'enabled', header: t('common.status'), cell: (u) => (u.enabled ? <Badge variant="success">{t('common.active')}</Badge> : <Badge variant="muted">{t('config.editors.disabled')}</Badge>) },
        { id: 'member', header: t('config.editors.memberOf'), cell: (u) => <span className="text-muted-foreground">{(u.memberOf ?? []).join(', ') || '–'}</span>, className: 'hidden @3xl:table-cell' },
      ]}
      searchText={(u) => `${u.samAccountName} ${u.displayName ?? ''} ${u.ouPath ?? ''} ${u.description ?? ''} ${(u.memberOf ?? []).join(' ')}`}
      tierOf={(u) => tierOf(u.ouPath)}
      itemLabel={(u) => u.samAccountName}
      newItem={() => ({ samAccountName: '', displayName: '', ouPath: '', description: '', enabled: false, memberOf: [], comment: '' })}
      Form={UserForm}
      entity={{ singular: t('config.editors.user'), plural: t('config.editors.users'), article: 'den' }}
      readOnly={props.readOnly}
      validate={(u, all, index) => {
        const e: Record<string, string> = {}
        if (!u.samAccountName?.trim()) e.samAccountName = t('config.editors.samaccountnameIsRequired')
        else if (u.samAccountName.length > 20) e.samAccountName = t('config.editors.atMost20Characters')
        else if (all.some((x, i) => i !== index && String(x.samAccountName).toLowerCase() === u.samAccountName.toLowerCase())) e.samAccountName = t('config.editors.alreadyInUse')
        if (!u.ouPath?.trim()) e.ouPath = t('config.editors.targetOuIsRequired')
        return e
      }}
    />
  )
}

// ============================================================ ACL delegations (acls, msa, gmsa, dmsa)

export const AD_RIGHTS = [
  'GenericAll', 'GenericRead', 'GenericWrite', 'CreateChild', 'DeleteChild', 'ReadProperty', 'WriteProperty',
  'ExtendedRight', 'ListChildren', 'Delete', 'DeleteTree', 'WriteDacl', 'WriteOwner', 'Self',
]
const INHERITANCE = ['None', 'All', 'Descendents', 'SelfAndChildren', 'Children']
const inheritanceLabels: Record<string, string> = {
  None: t('config.editors.noneThisObjectOnly'),
  All: t('config.editors.allObjectAndAllDescendants'),
  Descendents: t('config.editors.descendantsChildObjectsOnly'),
  SelfAndChildren: t('config.editors.objectAndDirectChildren'),
  Children: t('config.editors.directChildrenOnly'),
}
const COMMON_OBJECT_TYPES = [
  'Computer', 'User', 'Group', 'OrganizationalUnit', 'Contact', 'AllObjectClasses', 'PasswordReset',
  'BitLockerKeyPackage', 'BitLockerRecoveryPassword', 'DnsHostname', 'WriteSPN', 'LogonScript',
  'UserAccountOption', 'LockoutTime', 'msDS-ManagedServiceAccount', 'msDS-GroupManagedServiceAccount',
  'msDS-DelegatedManagedServiceAccount',
]

function aclTier(a: Item): Tier {
  if (a.tier === 0 || a.tier === 1 || a.tier === 2) return a.tier
  return tierOf(a.targetOUPath) ?? tierOf(a.identityreference)
}

function makeAclForm(objectTypes: string[], showTier: boolean) {
  return function AclForm({ value, onChange, errors }: FormProps) {
    const ouOptions = useOuOptions()
    const typeOptions = useObjectTypeOptions(objectTypes)
    const inhKey = 'inheritedobjecttype' in value ? 'inheritedobjecttype' : 'inheritedObjectType'
    const rights: string[] = Array.isArray(value.activedirectoryrights) ? value.activedirectoryrights : []
    return (
      <>
        <FormSection title={t('config.editors.targetPrincipal')}>
          <Field label={t('config.editors.targetOu')} htmlFor="a-ou" required error={errors.targetOUPath}>
            <Combobox id="a-ou" mono value={value.targetOUPath ?? ''} onChange={(v) => onChange(setField(value, 'targetOUPath', v))} options={ouOptions} placeholder={t('config.editors.selectOu')} invalid={!!errors.targetOUPath} />
          </Field>
          <Field label={t('config.editors.principalIdentityReference')} htmlFor="a-id" required error={errors.identityreference} hint={t('config.editors.samaccountnameOfAGroupFrom')}>
            <PrincipalCombobox id="a-id" value={value.identityreference ?? ''} onChange={(v) => onChange(setField(value, 'identityreference', v))} placeholder={t('config.editors.selectPrincipal')} invalid={!!errors.identityreference} />
          </Field>
        </FormSection>
        <FormSection title={t('config.editors.rights')} description="activedirectoryrights">
          <CheckboxGrid options={AD_RIGHTS} value={rights} onChange={(v) => onChange(setField(value, 'activedirectoryrights', v))} />
          {errors.activedirectoryrights && <p className="-mt-2 text-xs text-destructive">{errors.activedirectoryrights}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('config.editors.accessType')} htmlFor="a-type">
              <Select id="a-type" value={value.accesscontroltype} onValueChange={(v) => onChange(setField(value, 'accesscontroltype', v))} options={[
                { value: 'Allow', label: t('config.editors.allow') },
                { value: 'Deny', label: t('config.editors.deny') },
              ]} />
            </Field>
            <Field label={t('config.editors.inheritance')} htmlFor="a-inh">
              <Select id="a-inh" value={value.activeDirectorysecurityinheritance} onValueChange={(v) => onChange(setField(value, 'activeDirectorysecurityinheritance', v))}
                options={INHERITANCE.map((i) => ({ value: i, label: i, description: inheritanceLabels[i] }))} />
            </Field>
          </div>
        </FormSection>
        <FormSection title={t('config.editors.objectTypes')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('config.editors.objectType')} htmlFor="a-obj" hint={t('config.editors.namesFromTheGuidMappings')}>
              <Combobox id="a-obj" mono value={value.objecttype ?? ''} onChange={(v) => onChange(setField(value, 'objecttype', v))} options={typeOptions} placeholder={ALL_OBJECTS_LABEL} />
            </Field>
            <Field label={t('config.editors.inheritedObjectType')} htmlFor="a-iobj" hint={t('config.editors.optionalRestrictsToDescendantsOf')}>
              <Combobox id="a-iobj" mono value={value[inhKey] ?? ''} onChange={(v) => onChange(setField(value, inhKey, v, true))} options={typeOptions} placeholder={ALL_OBJECTS_LABEL} />
            </Field>
          </div>
          {'inheritanceType' in value && (
            <Field label={t('config.editors.inheritanceType')} htmlFor="a-it" hint="inheritanceType">
              <Combobox
                id="a-it"
                mono
                value={value.inheritanceType ?? ''}
                onChange={(v) => onChange(setField(value, 'inheritanceType', v, true))}
                options={[
                  { value: 'ContainerInherit', hint: t('config.editors.inheritanceToContainers') },
                  { value: 'ObjectInherit', hint: t('config.editors.inheritanceToObjects') },
                  { value: 'None', hint: t('config.editors.noInheritance') },
                  ...typeOptions.filter((o) => o.value),
                ]}
                placeholder={t('config.editors.optional')}
              />
            </Field>
          )}
          <SwitchRow id="a-guid" label={t('config.editors.resolveGuid')} description={t('config.editors.translateTheObjectTypeInto')} checked={!!value.resolveguid} onCheckedChange={(v) => onChange(setField(value, 'resolveguid', v))} />
          {showTier && (
            <Field label={t('config.editors.tier')} htmlFor="a-tier">
              <Select id="a-tier" value={value.tier === undefined ? '' : String(value.tier)} onValueChange={(v) => onChange(setField(value, 'tier', Number(v)))} options={[
                { value: '0', label: t('config.editors.tier0') }, { value: '1', label: t('config.editors.tier1') }, { value: '2', label: t('config.editors.tier2') },
              ]} placeholder={t('config.editors.selectTier')} />
            </Field>
          )}
        </FormSection>
        <Field label={t('config.editors.comment')} htmlFor="a-comment">
          <Textarea id="a-comment" rows={2} value={value.comment ?? ''} onChange={(e) => onChange(setField(value, 'comment', e.target.value, !('comment' in value)))} />
        </Field>
      </>
    )
  }
}

export function AclsEditor(props: EditorProps) {
  const { items, onItemsChange } = useListBinding(props, 'aclDelegations')
  const groupTiers = useGroupTierMap()
  const isMsa = props.sectionKey !== 'acls'
  const objectTypes = React.useMemo(() => {
    const s = new Set(COMMON_OBJECT_TYPES)
    items.forEach((a) => {
      for (const k of ['objecttype', 'inheritedObjectType', 'inheritedobjecttype']) if (a[k]) s.add(a[k])
    })
    return [...s].sort()
  }, [items])
  const Form = React.useMemo(() => makeAclForm(objectTypes, isMsa), [objectTypes, isMsa])
  const msaType: string | undefined = props.content?.managedServiceAccountType
  return (
    <>
      {isMsa && msaType && (
        <p className="mb-3 text-[13px] text-muted-foreground">
          {t('config.editors.accountType')} <Badge variant="info">{msaType}</Badge>
        </p>
      )}
      <ListEditor
        items={items}
        onItemsChange={onItemsChange}
        hints={(a) => aclTierIssues(a, groupTiers)}
        columns={[
          { id: 'principal', header: t('config.editors.principal'), cell: (a) => <span className="font-medium">{a.identityreference}</span>, sortValue: (a) => a.identityreference ?? '' },
          {
            id: 'rights', header: t('config.editors.rights'),
            cell: (a) => (
              <div className="flex min-w-[160px] max-w-[280px] flex-wrap gap-1">
                {(a.activedirectoryrights ?? []).map((r: string) => <Badge key={r} variant="secondary" className="font-mono text-[11px] font-normal">{r}</Badge>)}
              </div>
            ),
          },
          { id: 'type', header: t('config.editors.objectType'), cell: (a) => <Mono>{a.objecttype || <span className="text-muted-foreground">{t('config.editors.all')}</span>}</Mono>, sortValue: (a) => a.objecttype ?? '', className: 'hidden @4xl:table-cell' },
          { id: 'ou', header: t('config.editors.targetOu'), cell: (a) => <DnText value={a.targetOUPath} />, sortValue: (a) => a.targetOUPath ?? '' },
          {
            id: 'act', header: t('config.editors.type'),
            cell: (a) => (a.accesscontroltype === 'Deny' ? <Badge variant="danger">Deny</Badge> : <Badge variant="success">Allow</Badge>),
            sortValue: (a) => a.accesscontroltype ?? '', className: 'hidden @5xl:table-cell',
          },
          { id: 'inh', header: t('config.editors.inheritance'), cell: (a) => <span className="text-muted-foreground">{a.activeDirectorysecurityinheritance}</span>, sortValue: (a) => a.activeDirectorysecurityinheritance ?? '', className: 'hidden @6xl:table-cell' },
        ]}
        searchText={(a) => `${a.identityreference} ${a.targetOUPath} ${a.objecttype ?? ''} ${a.inheritedObjectType ?? a.inheritedobjecttype ?? ''} ${(a.activedirectoryrights ?? []).join(' ')} ${a.comment ?? ''}`}
        tierOf={aclTier}
        itemLabel={(a) => `${a.identityreference} → ${String(a.targetOUPath ?? '').replace(/,\{\{DOMAIN_DN\}\}$/, '')}`}
        newItem={() => ({
          targetOUPath: '', identityreference: '', activedirectoryrights: [], accesscontroltype: 'Allow',
          objecttype: isMsa ? (items[0]?.objecttype ?? '') : 'Computer',
          activeDirectorysecurityinheritance: 'Descendents', resolveguid: isMsa, ...(isMsa ? { tier: 1 } : {}), comment: '',
        })}
        Form={Form}
        entity={{ singular: t('config.editors.delegation'), plural: t('config.editors.delegations'), article: 'die' }}
        readOnly={props.readOnly}
        validate={(a) => {
          const e: Record<string, string> = {}
          if (!a.targetOUPath?.trim()) e.targetOUPath = t('config.editors.targetOuIsRequired')
          if (!a.identityreference?.trim()) e.identityreference = t('config.editors.principalIsRequired')
          if (!a.activedirectoryrights?.length) e.activedirectoryrights = t('config.editors.selectAtLeastOneRight')
          return e
        }}
      />
    </>
  )
}

// ============================================================ Windows LAPS

function WinLapsForm({ value, onChange, errors }: FormProps) {
  const ouOptions = useOuOptions()
  const gpoNames = useGpoNameOptions()
  return (
    <>
      <FormSection title={t('config.editors.target')}>
        <Field label={t('config.editors.ou')} htmlFor="w-ou" required error={errors.ouDn}>
          <Combobox id="w-ou" mono value={value.ouDn ?? ''} onChange={(v) => onChange(setField(value, 'ouDn', v))} options={ouOptions} placeholder={t('config.editors.selectOu')} invalid={!!errors.ouDn} />
        </Field>
        <div className="grid gap-2">
          <SwitchRow id="w-self" label={t('config.editors.computerSelfPermission')} description={t('config.editors.computersMayWriteTheirOwn')} checked={!!value.computerSelfPermission} onCheckedChange={(v) => onChange(setField(value, 'computerSelfPermission', v))} />
          <SwitchRow id="w-dc" label={t('config.editors.domainControllerOu')} description={t('config.editors.dsrmDecryptionIsAlwaysDone')} checked={!!value.isDomainControllerOu} onCheckedChange={(v) => onChange(setField(value, 'isDomainControllerOu', v, !('isDomainControllerOu' in value) && !v))} />
        </div>
      </FormSection>
      <FormSection title={t('config.editors.authorizedGroups')} description={t('config.editors.groupNamesNotSamaccountname')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('config.editors.read')} htmlFor="w-read" required error={errors.readGroup}>
            <PrincipalCombobox by="name" id="w-read" value={value.readGroup ?? ''} onChange={(v) => onChange(setField(value, 'readGroup', v))} placeholder={t('config.editors.selectGroup')} invalid={!!errors.readGroup} />
          </Field>
          <Field label={t('config.editors.reset')} htmlFor="w-reset" required error={errors.resetGroup}>
            <PrincipalCombobox by="name" id="w-reset" value={value.resetGroup ?? ''} onChange={(v) => onChange(setField(value, 'resetGroup', v))} placeholder={t('config.editors.selectGroup')} invalid={!!errors.resetGroup} />
          </Field>
        </div>
        <Field label={t('config.editors.decryptionDecryptorgroup')} htmlFor="w-dec" hint={t('config.editors.optionalNotRequiredForA')}>
          <PrincipalCombobox by="name" id="w-dec" value={value.decryptorGroup ?? ''} onChange={(v) => onChange(setField(value, 'decryptorGroup', v, true))} placeholder={t('config.editors.optional')} />
        </Field>
        <Field label={t('config.editors.decryptorGpo')} htmlFor="w-gpo" hint={t('config.editors.nameOfTheGpoThat')}>
          <Combobox id="w-gpo" value={value.decryptorGpoName ?? ''} onChange={(v) => onChange(setField(value, 'decryptorGpoName', v, true))} options={gpoNames} placeholder={t('config.editors.optional')} />
        </Field>
      </FormSection>
      <Field label={t('config.editors.comment')} htmlFor="w-comment">
        <Textarea id="w-comment" rows={2} value={value.comment ?? ''} onChange={(e) => onChange(setField(value, 'comment', e.target.value, true))} />
      </Field>
    </>
  )
}

export function WinLapsEditor(props: EditorProps) {
  const { items, onItemsChange } = useListBinding(props, 'winLapsDelegations')
  const groupTiers = useGroupTierMap()
  return (
    <ListEditor
      items={items}
      onItemsChange={onItemsChange}
      hints={(w) => lapsTierIssues(w, groupTiers)}
      columns={[
        { id: 'ou', header: 'OU', cell: (w) => <DnText value={w.ouDn} />, sortValue: (w) => w.ouDn ?? '' },
        { id: 'read', header: t('config.editors.read'), cell: (w) => w.readGroup, sortValue: (w) => w.readGroup ?? '' },
        { id: 'reset', header: t('config.editors.reset'), cell: (w) => w.resetGroup, className: 'hidden @2xl:table-cell' },
        { id: 'dec', header: t('config.editors.decryption'), cell: (w) => w.decryptorGroup ?? <span className="text-muted-foreground">–</span>, className: 'hidden @3xl:table-cell' },
        { id: 'self', header: 'Self', cell: (w) => bool(w.computerSelfPermission), className: 'hidden @3xl:table-cell' },
      ]}
      searchText={(w) => `${w.ouDn} ${w.readGroup} ${w.resetGroup} ${w.decryptorGroup ?? ''} ${w.decryptorGpoName ?? ''}`}
      tierOf={(w) => tierOf(w.ouDn) ?? tierOf(w.readGroup)}
      itemLabel={(w) => String(w.ouDn ?? '').replace(/,\{\{DOMAIN_DN\}\}$/, '')}
      newItem={() => ({ ouDn: '', computerSelfPermission: true, readGroup: '', resetGroup: '' })}
      Form={WinLapsForm}
      entity={{ singular: t('config.editors.lapsDelegation'), plural: t('config.editors.lapsDelegations'), article: 'die' }}
      readOnly={props.readOnly}
      validate={(w, all, index) => {
        const e: Record<string, string> = {}
        if (!w.ouDn?.trim()) e.ouDn = t('config.editors.ouIsRequired')
        else if (all.some((x, i) => i !== index && x.ouDn === w.ouDn)) e.ouDn = t('config.editors.aDelegationAlreadyExistsFor')
        if (!w.readGroup?.trim()) e.readGroup = t('config.editors.required')
        if (!w.resetGroup?.trim()) e.resetGroup = t('config.editors.required')
        return e
      }}
    />
  )
}
