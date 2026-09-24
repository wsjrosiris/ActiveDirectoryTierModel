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
import { ListEditor, type Column, type FormProps, type Item } from './list-editor'
import {
  CheckboxGrid,
  ChipsInput,
  FormSection,
  SwitchRow,
  setField,
  useGpoNameOptions,
  useGroupOptions,
  useOuOptions,
} from './form-helpers'
import { useSectionContent } from './draft-store'
import { OuRenameDialog } from './ou-rename-dialog'

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
      {short === DOMAIN ? 'Domänenstamm' : short}
    </span>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12.5px] whitespace-nowrap">{children}</span>
}

const bool = (v: unknown) =>
  v ? <CheckCircle2 className="size-4 text-emerald-500" aria-label="Ja" /> : <Circle className="size-4 text-muted-foreground/40" aria-label="Nein" />

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
      <FormSection title="Allgemein">
        <Field label="Name" htmlFor="ou-name" required error={errors.name} hint={existing ? 'Umbenennen und Verschieben aktualisieren alle Referenzen in anderen Sektionen.' : undefined}>
          <div className="flex gap-2">
            <Input id="ou-name" value={value.name ?? ''} readOnly={existing} onChange={(e) => onChange(setField(value, 'name', e.target.value))} aria-invalid={!!errors.name} placeholder="z. B. Tier 0 Accounts" />
            {existing && (
              <Button type="button" variant="outline" onClick={() => setRenameOpen(true)}>
                <Pencil /> Umbenennen / Verschieben …
              </Button>
            )}
          </div>
        </Field>
        <Field label="Übergeordnete OU" htmlFor="ou-path" required error={errors.path} hint={existing ? "Verschieben über „Umbenennen / Verschieben …“." : "Relativer Pfad ohne Domänen-Suffix oder {{DOMAIN_DN}} für die oberste Ebene."}>
          {existing ? (
            <Input id="ou-path" className="font-mono" value={value.path ?? ''} readOnly />
          ) : (
            <Combobox id="ou-path" mono value={value.path ?? ''} onChange={(v) => onChange(setField(value, 'path', v))} options={parentOptions} placeholder="Übergeordnete OU wählen" invalid={!!errors.path} />
          )}
        </Field>
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Distinguished Name</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="min-w-0 flex-1 font-mono text-[12px] break-all">{value.name ? ouFullDn(value as OuItem) : '–'}</p>
            <TierBadgeFor text={value.name ? ouFullDn(value as OuItem) : ''} />
          </div>
        </div>
        <Field label="Kommentar" htmlFor="ou-comment">
          <Textarea id="ou-comment" rows={2} value={value.comment ?? ''} onChange={(e) => onChange(setField(value, 'comment', e.target.value, !('comment' in value)))} />
        </Field>
      </FormSection>
      <FormSection title="Schutz & Vererbung">
        <div className="grid gap-2">
          <SwitchRow id="ou-protect" label="Vor versehentlichem Löschen schützen" checked={!!value.protectFromAccidentalDeletion} onCheckedChange={(v) => onChange(setField(value, 'protectFromAccidentalDeletion', v))} />
          <SwitchRow id="ou-inherit" label="ACL-Vererbung deaktivieren" description="Berechtigungen der übergeordneten OU werden nicht geerbt." checked={!!value.disableInheritance} onCheckedChange={(v) => onChange(setField(value, 'disableInheritance', v))} />
          <SwitchRow id="ou-gpo" label="GPO-Vererbung blockieren" description="Gruppenrichtlinien übergeordneter Container werden blockiert." checked={!!value.blockGpoInheritance} onCheckedChange={(v) => onChange(setField(value, 'blockGpoInheritance', v))} />
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
    { id: 'name', header: 'Name', cell: (o) => <span className="font-medium whitespace-nowrap">{o.name}</span>, sortValue: (o) => o.name ?? '' },
    { id: 'path', header: 'Übergeordnet', cell: (o) => <DnText value={o.path} />, sortValue: (o) => toFullDn(o.path ?? '').split(',').reverse().join(',') },
    { id: 'tier', header: 'Tier', cell: (o) => <TierBadge tier={ouTier(o)} short />, sortValue: (o) => String(ouTier(o) ?? 'z') },
    { id: 'protect', header: 'Schutz', cell: (o) => bool(o.protectFromAccidentalDeletion), className: 'hidden @2xl:table-cell' },
    { id: 'inh', header: 'ACL-Vererb. aus', cell: (o) => bool(o.disableInheritance), className: 'hidden @3xl:table-cell' },
    { id: 'gpo', header: 'GPO-Block', cell: (o) => bool(o.blockGpoInheritance), className: 'hidden @3xl:table-cell' },
    { id: 'comment', header: 'Kommentar', cell: (o) => <span className="line-clamp-1 max-w-xs text-muted-foreground">{o.comment}</span>, className: 'hidden @5xl:table-cell' },
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
        entity={{ singular: 'OU', plural: 'OUs', article: 'die' }}
        readOnly={props.readOnly}
        defaultSort="path"
        validate={(o, all, index) => {
          const e: Record<string, string> = {}
          if (!o.name?.trim()) e.name = 'Name ist erforderlich.'
          else if (/[,=+<>#;\\"]/.test(o.name)) e.name = 'Name darf keine Sonderzeichen wie , = + < > # ; \\ " enthalten.'
          if (!o.path?.trim()) e.path = 'Übergeordnete OU ist erforderlich.'
          const dn = ouFullDn(o as OuItem).toLowerCase()
          if (o.name && all.some((x, i) => i !== index && ouFullDn(x as OuItem).toLowerCase() === dn)) e.name = 'Eine OU mit diesem Namen existiert bereits an dieser Stelle.'
          const parent = toFullDn(o.path ?? '').toLowerCase()
          if (o.path && o.path !== DOMAIN && !all.some((x, i) => i !== index && ouFullDn(x as OuItem).toLowerCase() === parent))
            e.path = 'Übergeordnete OU existiert nicht in der Konfiguration.'
          return e
        }}
        extraActions={[{ label: 'Umbenennen / Verschieben …', icon: <Pencil />, onSelect: (_o, i) => setRename(i) }]}
        toolbarExtra={
          <Segmented
            aria-label="Ansicht"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'table', label: 'Tabelle', icon: <Table2 /> },
              { value: 'tree', label: 'Baum', icon: <FolderTree /> },
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
                            <Button type="button" variant="ghost" size="icon-xs" aria-label={`${n.ou.name} umbenennen`} onClick={() => setRename(n.index)}>
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
      <FormSection title="Identität">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="g-name" required error={errors.name}>
            <Input id="g-name" value={value.name ?? ''} onChange={(e) => onChange(setField(value, 'name', e.target.value))} aria-invalid={!!errors.name} placeholder="z. B. Tier 0 Admins" />
          </Field>
          <Field label="sAMAccountName" htmlFor="g-sam" required error={errors.samaccountname}>
            <Input id="g-sam" className="font-mono" value={value.samaccountname ?? ''} onChange={(e) => onChange(setField(value, 'samaccountname', e.target.value))} aria-invalid={!!errors.samaccountname} placeholder="Tier0Admins" />
          </Field>
        </div>
        <Field label="Beschreibung" htmlFor="g-desc">
          <Textarea id="g-desc" rows={2} value={value.description ?? ''} onChange={(e) => onChange(setField(value, 'description', e.target.value, !('description' in value)))} />
        </Field>
      </FormSection>
      <FormSection title="Typ & Ablage">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gruppenbereich" htmlFor="g-scope">
            <Select id="g-scope" value={value.groupscope} onValueChange={(v) => onChange(setField(value, 'groupscope', v))} options={[
              { value: 'Global', label: 'Global' },
              { value: 'Universal', label: 'Universal' },
              { value: 'DomainLocal', label: 'Lokal (Domäne)' },
            ]} />
          </Field>
          <Field label="Gruppentyp" htmlFor="g-cat">
            <Select id="g-cat" value={value.groupcategory} onValueChange={(v) => onChange(setField(value, 'groupcategory', v))} options={[
              { value: 'Security', label: 'Sicherheit' },
              { value: 'Distribution', label: 'Verteilung' },
            ]} />
          </Field>
        </div>
        <Field label="Ziel-OU" htmlFor="g-path" required error={errors.path}>
          <Combobox id="g-path" mono value={value.path ?? ''} onChange={(v) => onChange(setField(value, 'path', v))} options={ouOptions} placeholder="OU wählen" invalid={!!errors.path} />
        </Field>
        <Field label="Kommentar" htmlFor="g-comment">
          <Textarea id="g-comment" rows={2} value={value.comment ?? ''} onChange={(e) => onChange(setField(value, 'comment', e.target.value, !('comment' in value)))} />
        </Field>
      </FormSection>
    </>
  )
}

const groupTier = (g: Item): Tier => tierOf(g.name) ?? tierOf(g.path)

export function GroupsEditor(props: EditorProps) {
  const { items, onItemsChange } = useListBinding(props, 'groups')
  const scopeLabel: Record<string, string> = { Global: 'Global', Universal: 'Universal', DomainLocal: 'Lokal' }
  return (
    <ListEditor
      items={items}
      onItemsChange={onItemsChange}
      columns={[
        { id: 'name', header: 'Name', cell: (g) => <span className="block min-w-[140px] font-medium">{g.name}</span>, sortValue: (g) => g.name ?? '' },
        { id: 'sam', header: 'sAMAccountName', cell: (g) => <Mono>{g.samaccountname}</Mono>, sortValue: (g) => g.samaccountname ?? '' },
        { id: 'scope', header: 'Bereich', cell: (g) => <Badge variant="outline">{scopeLabel[g.groupscope] ?? g.groupscope}</Badge>, sortValue: (g) => g.groupscope ?? '', className: 'hidden @2xl:table-cell' },
        { id: 'cat', header: 'Typ', cell: (g) => <span className="text-muted-foreground">{g.groupcategory === 'Security' ? 'Sicherheit' : g.groupcategory === 'Distribution' ? 'Verteilung' : g.groupcategory}</span>, className: 'hidden @5xl:table-cell' },
        { id: 'path', header: 'OU', cell: (g) => <DnText value={g.path} />, sortValue: (g) => g.path ?? '', className: 'hidden @3xl:table-cell' },
      ]}
      searchText={(g) => `${g.name} ${g.samaccountname} ${g.description ?? ''} ${g.path ?? ''}`}
      tierOf={groupTier}
      itemLabel={(g) => g.name || g.samaccountname}
      newItem={() => ({ name: '', samaccountname: '', description: '', groupscope: 'Global', groupcategory: 'Security', path: '', comment: '' })}
      Form={GroupForm}
      entity={{ singular: 'Gruppe', plural: 'Gruppen', article: 'die' }}
      readOnly={props.readOnly}
      defaultSort="name"
      validate={(g, all, index) => {
        const e: Record<string, string> = {}
        if (!g.name?.trim()) e.name = 'Name ist erforderlich.'
        if (!g.samaccountname?.trim()) e.samaccountname = 'sAMAccountName ist erforderlich.'
        else if (/[\s"/\\[\]:;|=,+*?<>@]/.test(g.samaccountname)) e.samaccountname = 'Enthält unzulässige Zeichen.'
        else if (all.some((x, i) => i !== index && String(x.samaccountname).toLowerCase() === g.samaccountname.toLowerCase())) e.samaccountname = 'Dieser sAMAccountName ist bereits vergeben.'
        if (!g.path?.trim()) e.path = 'Ziel-OU ist erforderlich.'
        return e
      }}
    />
  )
}

// ============================================================ Users

function UserForm({ value, onChange, errors }: FormProps) {
  const ouOptions = useOuOptions()
  const groupOptions = useGroupOptions('samaccountname')
  const members: string[] = Array.isArray(value.memberOf) ? value.memberOf : []
  return (
    <>
      <FormSection title="Konto">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="sAMAccountName" htmlFor="u-sam" required error={errors.samAccountName} hint="Max. 20 Zeichen">
            <Input id="u-sam" className="font-mono" value={value.samAccountName ?? ''} onChange={(e) => onChange(setField(value, 'samAccountName', e.target.value))} aria-invalid={!!errors.samAccountName} placeholder="svc-beispiel" />
          </Field>
          <Field label="Anzeigename" htmlFor="u-dn">
            <Input id="u-dn" value={value.displayName ?? ''} onChange={(e) => onChange(setField(value, 'displayName', e.target.value, !('displayName' in value)))} />
          </Field>
        </div>
        <Field label="Ziel-OU" htmlFor="u-ou" required error={errors.ouPath}>
          <Combobox id="u-ou" mono value={value.ouPath ?? ''} onChange={(v) => onChange(setField(value, 'ouPath', v))} options={ouOptions} placeholder="OU wählen" invalid={!!errors.ouPath} />
        </Field>
        <Field label="Beschreibung" htmlFor="u-desc">
          <Textarea id="u-desc" rows={2} value={value.description ?? ''} onChange={(e) => onChange(setField(value, 'description', e.target.value, !('description' in value)))} />
        </Field>
        <SwitchRow id="u-enabled" label="Konto aktiviert" description="Dienstkonten bleiben üblicherweise deaktiviert, bis sie benötigt werden." checked={!!value.enabled} onCheckedChange={(v) => onChange(setField(value, 'enabled', v))} />
      </FormSection>
      <FormSection title="Gruppenmitgliedschaften" description="sAMAccountName der Gruppen">
        <ChipsInput id="u-member" value={members} onChange={(v) => onChange(setField(value, 'memberOf', v))} options={groupOptions} placeholder="Gruppe hinzufügen …" />
      </FormSection>
      <Field label="Kommentar" htmlFor="u-comment">
        <Textarea id="u-comment" rows={2} value={value.comment ?? ''} onChange={(e) => onChange(setField(value, 'comment', e.target.value, !('comment' in value)))} />
      </Field>
    </>
  )
}

export function UsersEditor(props: EditorProps) {
  const { items, onItemsChange } = useListBinding(props, 'users')
  return (
    <ListEditor
      items={items}
      onItemsChange={onItemsChange}
      columns={[
        { id: 'sam', header: 'sAMAccountName', cell: (u) => <Mono>{u.samAccountName}</Mono>, sortValue: (u) => u.samAccountName ?? '' },
        { id: 'dn', header: 'Anzeigename', cell: (u) => u.displayName, sortValue: (u) => u.displayName ?? '', className: 'hidden @2xl:table-cell' },
        { id: 'ou', header: 'OU', cell: (u) => <DnText value={u.ouPath} />, sortValue: (u) => u.ouPath ?? '' },
        { id: 'enabled', header: 'Status', cell: (u) => (u.enabled ? <Badge variant="success">Aktiv</Badge> : <Badge variant="muted">Deaktiviert</Badge>) },
        { id: 'member', header: 'Mitglied von', cell: (u) => <span className="text-muted-foreground">{(u.memberOf ?? []).join(', ') || '–'}</span>, className: 'hidden @3xl:table-cell' },
      ]}
      searchText={(u) => `${u.samAccountName} ${u.displayName ?? ''} ${u.ouPath ?? ''} ${u.description ?? ''} ${(u.memberOf ?? []).join(' ')}`}
      tierOf={(u) => tierOf(u.ouPath)}
      itemLabel={(u) => u.samAccountName}
      newItem={() => ({ samAccountName: '', displayName: '', ouPath: '', description: '', enabled: false, memberOf: [], comment: '' })}
      Form={UserForm}
      entity={{ singular: 'Benutzer', plural: 'Benutzer', article: 'den' }}
      readOnly={props.readOnly}
      validate={(u, all, index) => {
        const e: Record<string, string> = {}
        if (!u.samAccountName?.trim()) e.samAccountName = 'sAMAccountName ist erforderlich.'
        else if (u.samAccountName.length > 20) e.samAccountName = 'Maximal 20 Zeichen.'
        else if (all.some((x, i) => i !== index && String(x.samAccountName).toLowerCase() === u.samAccountName.toLowerCase())) e.samAccountName = 'Bereits vergeben.'
        if (!u.ouPath?.trim()) e.ouPath = 'Ziel-OU ist erforderlich.'
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
  None: 'Keine – nur dieses Objekt',
  All: 'Alle – Objekt und alle Nachfolger',
  Descendents: 'Nachfolger – nur untergeordnete Objekte',
  SelfAndChildren: 'Objekt und direkte Kinder',
  Children: 'Nur direkte Kinder',
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
    const principals = useGroupOptions('samaccountname')
    const typeOptions = objectTypes.map((t) => ({ value: t }))
    const rights: string[] = Array.isArray(value.activedirectoryrights) ? value.activedirectoryrights : []
    return (
      <>
        <FormSection title="Ziel & Prinzipal">
          <Field label="Ziel-OU" htmlFor="a-ou" required error={errors.targetOUPath}>
            <Combobox id="a-ou" mono value={value.targetOUPath ?? ''} onChange={(v) => onChange(setField(value, 'targetOUPath', v))} options={ouOptions} placeholder="OU wählen" invalid={!!errors.targetOUPath} />
          </Field>
          <Field label="Prinzipal (Identity Reference)" htmlFor="a-id" required error={errors.identityreference} hint="sAMAccountName einer Gruppe aus der Konfiguration oder ein integriertes Konto.">
            <Combobox id="a-id" value={value.identityreference ?? ''} onChange={(v) => onChange(setField(value, 'identityreference', v))} options={principals} placeholder="Prinzipal wählen" invalid={!!errors.identityreference} />
          </Field>
        </FormSection>
        <FormSection title="Rechte" description="activedirectoryrights">
          <CheckboxGrid options={AD_RIGHTS} value={rights} onChange={(v) => onChange(setField(value, 'activedirectoryrights', v))} />
          {errors.activedirectoryrights && <p className="-mt-2 text-xs text-destructive">{errors.activedirectoryrights}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Zugriffstyp" htmlFor="a-type">
              <Select id="a-type" value={value.accesscontroltype} onValueChange={(v) => onChange(setField(value, 'accesscontroltype', v))} options={[
                { value: 'Allow', label: 'Zulassen (Allow)' },
                { value: 'Deny', label: 'Verweigern (Deny)' },
              ]} />
            </Field>
            <Field label="Vererbung" htmlFor="a-inh">
              <Select id="a-inh" value={value.activeDirectorysecurityinheritance} onValueChange={(v) => onChange(setField(value, 'activeDirectorysecurityinheritance', v))}
                options={INHERITANCE.map((i) => ({ value: i, label: i, description: inheritanceLabels[i] }))} />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Objekttypen">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Objekttyp" htmlFor="a-obj" hint="Leer = alle Objekte">
              <Combobox id="a-obj" mono value={value.objecttype ?? ''} onChange={(v) => onChange(setField(value, 'objecttype', v))} options={typeOptions} placeholder="Objekttyp wählen" />
            </Field>
            <Field label="Geerbter Objekttyp" htmlFor="a-iobj" hint="inheritedObjectType (optional)">
              <Combobox id="a-iobj" mono value={value.inheritedObjectType ?? ''} onChange={(v) => onChange(setField(value, 'inheritedObjectType', v, true))} options={typeOptions} placeholder="Optional" />
            </Field>
          </div>
          {'inheritanceType' in value && (
            <Field label="Vererbungstyp" htmlFor="a-it" hint="inheritanceType">
              <Input id="a-it" className="font-mono" value={value.inheritanceType ?? ''} onChange={(e) => onChange(setField(value, 'inheritanceType', e.target.value, true))} />
            </Field>
          )}
          <SwitchRow id="a-guid" label="GUID auflösen" description="Objekttyp zur Laufzeit über guid-mappings in eine Schema-GUID übersetzen (resolveguid)." checked={!!value.resolveguid} onCheckedChange={(v) => onChange(setField(value, 'resolveguid', v))} />
          {showTier && (
            <Field label="Tier" htmlFor="a-tier">
              <Select id="a-tier" value={value.tier === undefined ? '' : String(value.tier)} onValueChange={(v) => onChange(setField(value, 'tier', Number(v)))} options={[
                { value: '0', label: 'Tier 0' }, { value: '1', label: 'Tier 1' }, { value: '2', label: 'Tier 2' },
              ]} placeholder="Tier wählen" />
            </Field>
          )}
        </FormSection>
        <Field label="Kommentar" htmlFor="a-comment">
          <Textarea id="a-comment" rows={2} value={value.comment ?? ''} onChange={(e) => onChange(setField(value, 'comment', e.target.value, !('comment' in value)))} />
        </Field>
      </>
    )
  }
}

export function AclsEditor(props: EditorProps) {
  const { items, onItemsChange } = useListBinding(props, 'aclDelegations')
  const isMsa = props.sectionKey !== 'acls'
  const objectTypes = React.useMemo(() => {
    const s = new Set(COMMON_OBJECT_TYPES)
    items.forEach((a) => { if (a.objecttype) s.add(a.objecttype); if (a.inheritedObjectType) s.add(a.inheritedObjectType) })
    return [...s].sort()
  }, [items])
  const Form = React.useMemo(() => makeAclForm(objectTypes, isMsa), [objectTypes, isMsa])
  const msaType: string | undefined = props.content?.managedServiceAccountType
  return (
    <>
      {isMsa && msaType && (
        <p className="mb-3 text-[13px] text-muted-foreground">
          Kontotyp: <Badge variant="info">{msaType}</Badge>
        </p>
      )}
      <ListEditor
        items={items}
        onItemsChange={onItemsChange}
        columns={[
          { id: 'principal', header: 'Prinzipal', cell: (a) => <span className="font-medium">{a.identityreference}</span>, sortValue: (a) => a.identityreference ?? '' },
          {
            id: 'rights', header: 'Rechte',
            cell: (a) => (
              <div className="flex min-w-[160px] max-w-[280px] flex-wrap gap-1">
                {(a.activedirectoryrights ?? []).map((r: string) => <Badge key={r} variant="secondary" className="font-mono text-[11px] font-normal">{r}</Badge>)}
              </div>
            ),
          },
          { id: 'type', header: 'Objekttyp', cell: (a) => <Mono>{a.objecttype || <span className="text-muted-foreground">alle</span>}</Mono>, sortValue: (a) => a.objecttype ?? '', className: 'hidden @4xl:table-cell' },
          { id: 'ou', header: 'Ziel-OU', cell: (a) => <DnText value={a.targetOUPath} />, sortValue: (a) => a.targetOUPath ?? '' },
          {
            id: 'act', header: 'Typ',
            cell: (a) => (a.accesscontroltype === 'Deny' ? <Badge variant="danger">Deny</Badge> : <Badge variant="success">Allow</Badge>),
            sortValue: (a) => a.accesscontroltype ?? '', className: 'hidden @5xl:table-cell',
          },
          { id: 'inh', header: 'Vererbung', cell: (a) => <span className="text-muted-foreground">{a.activeDirectorysecurityinheritance}</span>, sortValue: (a) => a.activeDirectorysecurityinheritance ?? '', className: 'hidden @6xl:table-cell' },
        ]}
        searchText={(a) => `${a.identityreference} ${a.targetOUPath} ${a.objecttype ?? ''} ${a.inheritedObjectType ?? ''} ${(a.activedirectoryrights ?? []).join(' ')} ${a.comment ?? ''}`}
        tierOf={aclTier}
        itemLabel={(a) => `${a.identityreference} → ${String(a.targetOUPath ?? '').replace(/,\{\{DOMAIN_DN\}\}$/, '')}`}
        newItem={() => ({
          targetOUPath: '', identityreference: '', activedirectoryrights: [], accesscontroltype: 'Allow',
          objecttype: isMsa ? (items[0]?.objecttype ?? '') : 'Computer',
          activeDirectorysecurityinheritance: 'Descendents', resolveguid: isMsa, ...(isMsa ? { tier: 1 } : {}), comment: '',
        })}
        Form={Form}
        entity={{ singular: 'Delegation', plural: 'Delegationen', article: 'die' }}
        readOnly={props.readOnly}
        validate={(a) => {
          const e: Record<string, string> = {}
          if (!a.targetOUPath?.trim()) e.targetOUPath = 'Ziel-OU ist erforderlich.'
          if (!a.identityreference?.trim()) e.identityreference = 'Prinzipal ist erforderlich.'
          if (!a.activedirectoryrights?.length) e.activedirectoryrights = 'Mindestens ein Recht auswählen.'
          return e
        }}
      />
    </>
  )
}

// ============================================================ Windows LAPS

function WinLapsForm({ value, onChange, errors }: FormProps) {
  const ouOptions = useOuOptions()
  const groups = useGroupOptions('name')
  const gpoNames = useGpoNameOptions()
  return (
    <>
      <FormSection title="Ziel">
        <Field label="OU" htmlFor="w-ou" required error={errors.ouDn}>
          <Combobox id="w-ou" mono value={value.ouDn ?? ''} onChange={(v) => onChange(setField(value, 'ouDn', v))} options={ouOptions} placeholder="OU wählen" invalid={!!errors.ouDn} />
        </Field>
        <div className="grid gap-2">
          <SwitchRow id="w-self" label="Computer-Selbstberechtigung" description="Computer dürfen ihr eigenes LAPS-Passwort schreiben." checked={!!value.computerSelfPermission} onCheckedChange={(v) => onChange(setField(value, 'computerSelfPermission', v))} />
          <SwitchRow id="w-dc" label="Domain-Controller-OU" description="DSRM-Entschlüsselung erfolgt immer durch Domain Admins." checked={!!value.isDomainControllerOu} onCheckedChange={(v) => onChange(setField(value, 'isDomainControllerOu', v, !('isDomainControllerOu' in value) && !v))} />
        </div>
      </FormSection>
      <FormSection title="Berechtigte Gruppen" description="Gruppennamen (nicht sAMAccountName)">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lesen" htmlFor="w-read" required error={errors.readGroup}>
            <Combobox id="w-read" value={value.readGroup ?? ''} onChange={(v) => onChange(setField(value, 'readGroup', v))} options={groups} placeholder="Gruppe wählen" invalid={!!errors.readGroup} />
          </Field>
          <Field label="Zurücksetzen" htmlFor="w-reset" required error={errors.resetGroup}>
            <Combobox id="w-reset" value={value.resetGroup ?? ''} onChange={(v) => onChange(setField(value, 'resetGroup', v))} options={groups} placeholder="Gruppe wählen" invalid={!!errors.resetGroup} />
          </Field>
        </div>
        <Field label="Entschlüsselung (decryptorGroup)" htmlFor="w-dec" hint="Optional – bei DC-OU nicht erforderlich">
          <Combobox id="w-dec" value={value.decryptorGroup ?? ''} onChange={(v) => onChange(setField(value, 'decryptorGroup', v, true))} options={groups} placeholder="Optional" />
        </Field>
        <Field label="Decryptor-GPO" htmlFor="w-gpo" hint="Name der GPO, die die Entschlüsselungsgruppe konfiguriert">
          <Combobox id="w-gpo" value={value.decryptorGpoName ?? ''} onChange={(v) => onChange(setField(value, 'decryptorGpoName', v, true))} options={gpoNames} placeholder="Optional" />
        </Field>
      </FormSection>
      <Field label="Kommentar" htmlFor="w-comment">
        <Textarea id="w-comment" rows={2} value={value.comment ?? ''} onChange={(e) => onChange(setField(value, 'comment', e.target.value, true))} />
      </Field>
    </>
  )
}

export function WinLapsEditor(props: EditorProps) {
  const { items, onItemsChange } = useListBinding(props, 'winLapsDelegations')
  return (
    <ListEditor
      items={items}
      onItemsChange={onItemsChange}
      columns={[
        { id: 'ou', header: 'OU', cell: (w) => <DnText value={w.ouDn} />, sortValue: (w) => w.ouDn ?? '' },
        { id: 'read', header: 'Lesen', cell: (w) => w.readGroup, sortValue: (w) => w.readGroup ?? '' },
        { id: 'reset', header: 'Zurücksetzen', cell: (w) => w.resetGroup, className: 'hidden @2xl:table-cell' },
        { id: 'dec', header: 'Entschlüsselung', cell: (w) => w.decryptorGroup ?? <span className="text-muted-foreground">–</span>, className: 'hidden @3xl:table-cell' },
        { id: 'self', header: 'Self', cell: (w) => bool(w.computerSelfPermission), className: 'hidden @3xl:table-cell' },
      ]}
      searchText={(w) => `${w.ouDn} ${w.readGroup} ${w.resetGroup} ${w.decryptorGroup ?? ''} ${w.decryptorGpoName ?? ''}`}
      tierOf={(w) => tierOf(w.ouDn) ?? tierOf(w.readGroup)}
      itemLabel={(w) => String(w.ouDn ?? '').replace(/,\{\{DOMAIN_DN\}\}$/, '')}
      newItem={() => ({ ouDn: '', computerSelfPermission: true, readGroup: '', resetGroup: '' })}
      Form={WinLapsForm}
      entity={{ singular: 'LAPS-Delegation', plural: 'LAPS-Delegationen', article: 'die' }}
      readOnly={props.readOnly}
      validate={(w, all, index) => {
        const e: Record<string, string> = {}
        if (!w.ouDn?.trim()) e.ouDn = 'OU ist erforderlich.'
        else if (all.some((x, i) => i !== index && x.ouDn === w.ouDn)) e.ouDn = 'Für diese OU existiert bereits eine Delegation.'
        if (!w.readGroup?.trim()) e.readGroup = 'Erforderlich.'
        if (!w.resetGroup?.trim()) e.resetGroup = 'Erforderlich.'
        return e
      }}
    />
  )
}

// ============================================================ GPO overview (read-only)

export function GpoOverview({ content, focus }: { content: Json; focus?: string | null }) {
  React.useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => {
      const el = document.getElementById(`gpo-${focus}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.classList.add('ring-2', 'ring-primary')
      setTimeout(() => el?.classList.remove('ring-2', 'ring-primary'), 2400)
    }, 150)
    return () => clearTimeout(t)
  }, [focus])
  const map = (content?.gpos ?? {}) as Record<string, Item>
  const entries = Object.entries(map)
  const [filter, setFilter] = React.useState('')
  const q = filter.toLowerCase()
  const rows = entries
    .map(([dn, v]) => {
      const gpos: { name: string; kind: string; linkOrder?: number; linkEnabled?: boolean; mode?: string }[] = []
      for (const kind of ['ImportOnlyGpo', 'PostConfigureGpo'])
        if (Array.isArray(v?.[kind])) v[kind].forEach((g: Item) => gpos.push({ name: g.name, kind, linkOrder: g.linkOrder, linkEnabled: g.linkEnabled, mode: g.mode }))
      gpos.sort((a, b) => (a.linkOrder ?? 999) - (b.linkOrder ?? 999))
      return { dn, displayName: v?.displayName as string | undefined, gpos }
    })
    .filter((r) => !q || r.dn.toLowerCase().includes(q) || r.gpos.some((g) => g.name?.toLowerCase().includes(q)))

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="OU oder GPO filtern …" className="h-8 max-w-xs text-[13px]" aria-label="GPOs filtern" />
        <span className="text-xs text-muted-foreground">{entries.length} Ziele · {entries.reduce((n, [, v]) => n + ((v?.ImportOnlyGpo?.length ?? 0) + (v?.PostConfigureGpo?.length ?? 0)), 0)} GPOs</span>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.dn} id={`gpo-${r.dn}`} className="overflow-hidden transition-shadow">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
              <FolderTree className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{r.displayName ?? (r.dn === DOMAIN ? 'Domänenstamm' : r.dn.split(',')[0].replace(/^OU=/, ''))}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{r.dn}</p>
              </div>
              <TierBadgeFor text={r.dn} short />
            </div>
            {r.gpos.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">Keine GPOs verknüpft</p>
            ) : (
              <ul className="divide-y">
                {r.gpos.map((g, i) => (
                  <li key={i} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                    <span className="w-5 text-right font-mono text-[11px] text-muted-foreground tabular">{g.linkOrder ?? '–'}</span>
                    <span className={g.linkEnabled === false ? 'min-w-0 flex-1 truncate text-muted-foreground' : 'min-w-0 flex-1 truncate'} title={g.name}>
                      {g.name}
                    </span>
                    {g.kind === 'PostConfigureGpo' && <Badge variant="info" className="text-[10px]">konfiguriert</Badge>}
                    {g.linkEnabled === false && <Badge variant="muted" className="text-[10px]">Link aus</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
