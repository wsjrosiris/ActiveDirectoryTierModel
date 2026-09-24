import * as React from 'react'
import { ChevronRight, Plus, ShieldCheck, Trash2, UserCog, Users, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Field, Label } from '@/components/ui/label'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { usePrincipalOptions } from './lookups'
import {
  BUILTIN_GROUPS,
  CONDITIONS,
  FOREST_ROOT_SUGGESTIONS,
  GPO_BUILTIN_PRINCIPALS,
  LITERAL_SUGGESTIONS,
  USER_RIGHTS,
  describeGroupRelation,
  formatGroupRelation,
  newRight,
  parseGroupRelation,
  setRestricted,
  restrictedAsObject,
  setListKeep,
  type Obj,
} from './gpo-model'

/* Building blocks of the GPO edit sheet. Every section is memoized and receives a stable
 * functional updater, so typing in one field does not re-render the (large) other sections. */

export type Updater = (fn: (prev: Obj) => Obj) => void

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

// ------------------------------------------------------------------ suggestions from the whole section

export interface GpoSuggestions {
  principals: string[]
  literals: string[]
  forestRoot: string[]
  conditional: string[]
}
export const GpoSuggestionsContext = React.createContext<GpoSuggestions>({ principals: [], literals: [], forestRoot: [], conditional: [] })

/** Collects principals already used anywhere in the section, offered as suggestions. */
export function collectSuggestions(content: Obj | undefined): GpoSuggestions {
  const p = new Set<string>(), l = new Set<string>(), f = new Set<string>(), c = new Set<string>()
  for (const t of Object.values((content?.gpos ?? {}) as Obj)) {
    for (const g of [...(Array.isArray(t?.PostConfigureGpo) ? t.PostConfigureGpo : []), ...(Array.isArray(t?.ImportOnlyGpo) ? t.ImportOnlyGpo : [])]) {
      strings(g?.denyApplyGroupPolicy).forEach((x) => p.add(x))
      for (const r of Array.isArray(g?.userRightsAssignments) ? g.userRightsAssignments : []) {
        strings(r?.principals?.resolvableGroups).forEach((x) => p.add(x))
        strings(r?.principals?.literalStrings).forEach((x) => l.add(x))
        strings(r?.principals?.forestRootOnly).forEach((x) => f.add(x))
        for (const cg of Array.isArray(r?.principals?.conditionalGroups) ? r.principals.conditionalGroups : []) strings(cg?.names).forEach((x) => c.add(x))
      }
      const rg = restrictedAsObject(g?.restrictedGroups)
      for (const m of Array.isArray(rg.membershipGroups) ? rg.membershipGroups : []) strings(m?.memberGroups).forEach((x) => p.add(x))
    }
  }
  const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, 'de'))
  return { principals: sort(p), literals: sort(l), forestRoot: sort(f), conditional: sort(c) }
}

function mergeOptions(base: ComboOption[], extra: { value: string; label?: string; hint?: string; icon?: React.ReactNode }[]): ComboOption[] {
  const out = [...base]
  const seen = new Set(out.map((o) => o.value.toLowerCase()))
  for (const e of extra) {
    if (seen.has(e.value.toLowerCase())) continue
    seen.add(e.value.toLowerCase())
    out.push(e)
  }
  return out
}

const usedIcon = <Users className="size-4 text-muted-foreground" />

/** Principal picker: configured groups, built-ins, principals used elsewhere and live AD search. */
export const PrincipalPicker = React.memo(function PrincipalPicker({
  values,
  onChange,
  id,
  disabled,
  placeholder = 'Gruppe suchen oder eingeben …',
  extra,
}: {
  values: string[]
  onChange: (v: string[]) => void
  id?: string
  disabled?: boolean
  placeholder?: string
  extra?: string[]
}) {
  const [search, setSearch] = React.useState('')
  const { options, loading } = usePrincipalOptions(search)
  const used = React.useContext(GpoSuggestionsContext)
  const merged = React.useMemo(
    () =>
      mergeOptions(options, [
        ...(extra ?? []).map((v) => ({ value: v, hint: 'In GPOs verwendet', icon: usedIcon })),
        ...GPO_BUILTIN_PRINCIPALS.map((v) => ({ value: v, hint: 'Integriert' })),
        ...used.principals.map((v) => ({ value: v, hint: 'In GPOs verwendet', icon: usedIcon })),
      ]),
    [options, used.principals, extra],
  )
  return (
    <MultiCombobox
      id={id}
      values={values}
      onChange={onChange}
      options={merged}
      onSearchChange={setSearch}
      loading={loading}
      disabled={disabled}
      placeholder={placeholder}
    />
  )
})

// ------------------------------------------------------------------ collapsible section

export function Collapsible({
  title,
  description,
  count,
  icon,
  defaultOpen,
  error,
  children,
}: {
  title: string
  description?: string
  count?: number
  icon?: React.ReactNode
  defaultOpen?: boolean
  error?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(!!defaultOpen)
  const bodyId = React.useId()
  return (
    <section className={cn('min-w-0 rounded-lg border', error && 'border-destructive/60')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2.5 rounded-lg px-3.5 py-3 text-left transition-colors hover:bg-accent/40 disabled:cursor-default"
      >
        <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">{title}</span>
          {description && <span className="block text-xs text-muted-foreground">{description}</span>}
        </span>
        {count !== undefined && <Badge variant={count ? 'secondary' : 'muted'} className="tabular">{count}</Badge>}
      </button>
      {error && <p className="px-3.5 pb-2 text-xs text-destructive" role="alert">{error}</p>}
      {open && (
        <div id={bodyId} className="grid min-w-0 gap-4 border-t px-3.5 py-4 [&>*]:min-w-0">
          {children}
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------------------ deny apply

export const DenyApplySection = React.memo(function DenyApplySection({ values, update, disabled }: { values: string[]; update: Updater; disabled: boolean }) {
  const onChange = React.useCallback((v: string[]) => update((g) => setListKeep(g, 'denyApplyGroupPolicy', v)), [update])
  return (
    <Collapsible
      title="Anwenden verweigern für"
      description="Diese Gruppen erhalten im GPO-ACL „Gruppenrichtlinie übernehmen: Verweigern“."
      count={values.length}
      icon={<ShieldCheck />}
      defaultOpen={values.length > 0}
    >
      <PrincipalPicker id="gpo-deny" values={values} onChange={onChange} disabled={disabled} />
    </Collapsible>
  )
})

// ------------------------------------------------------------------ user rights

const rightOptionsAll: ComboOption[] = USER_RIGHTS.map((r) => ({ value: r.value, label: r.label, hint: r.value }))

export const UserRightsSection = React.memo(function UserRightsSection({
  rights,
  update,
  disabled,
  error,
}: {
  rights: Obj[]
  update: Updater
  disabled: boolean
  error?: string
}) {
  const used = rights.map((r) => String(r?.right ?? ''))
  const usedKey = used.join('|')
  const addOptions = React.useMemo(() => rightOptionsAll.filter((o) => !usedKey.split('|').includes(o.value)), [usedKey])

  const updateRight = React.useCallback(
    (i: number, fn: (r: Obj) => Obj) =>
      update((g) => ({ ...g, userRightsAssignments: (g.userRightsAssignments as Obj[]).map((r, j) => (j === i ? fn(r) : r)) })),
    [update],
  )
  const removeRight = React.useCallback(
    (i: number) => update((g) => ({ ...g, userRightsAssignments: (g.userRightsAssignments as Obj[]).filter((_, j) => j !== i) })),
    [update],
  )
  const addRight = (right: string) => {
    if (!right || used.includes(right)) return
    update((g) => ({ ...g, userRightsAssignments: [...(Array.isArray(g.userRightsAssignments) ? g.userRightsAssignments : []), newRight(right)] }))
  }

  return (
    <Collapsible
      title="Benutzerrechte"
      description="Zuweisen von Benutzerrechten (User Rights Assignment) in dieser GPO."
      count={rights.length}
      icon={<UserCog />}
      defaultOpen={rights.length > 0 && rights.length <= 3}
      error={error}
    >
      {rights.length === 0 && <p className="text-xs text-muted-foreground">Keine Benutzerrechte konfiguriert.</p>}
      <div className="grid min-w-0 gap-3 [&>*]:min-w-0">
        {rights.map((r, i) => (
          <RightCard key={i} index={i} right={r} usedKey={usedKey} updateRight={updateRight} removeRight={removeRight} disabled={disabled} />
        ))}
      </div>
      {!disabled && (
        <div className="max-w-md">
          <Combobox key={usedKey} value="" onChange={addRight} options={addOptions} placeholder="+ Benutzerrecht hinzufügen …" searchPlaceholder="Recht oder Konstante suchen …" emptyText="Kein weiteres Recht verfügbar" />
        </div>
      )}
    </Collapsible>
  )
})

const literalOptions = (used: string[]): ComboOption[] =>
  mergeOptions(
    LITERAL_SUGGESTIONS.map((l) => ({ value: l.value, label: l.label, hint: l.value })),
    used.map((v) => ({ value: v, hint: 'In GPOs verwendet' })),
  )
const forestRootOptions = (used: string[]): ComboOption[] =>
  mergeOptions(
    FOREST_ROOT_SUGGESTIONS.map((l) => ({ value: l.value, label: l.label, hint: l.value })),
    used.map((v) => ({ value: v, hint: 'In GPOs verwendet' })),
  )

const RightCard = React.memo(function RightCard({
  index,
  right,
  usedKey,
  updateRight,
  removeRight,
  disabled,
}: {
  index: number
  right: Obj
  usedKey: string
  updateRight: (i: number, fn: (r: Obj) => Obj) => void
  removeRight: (i: number) => void
  disabled: boolean
}) {
  const suggestions = React.useContext(GpoSuggestionsContext)
  const p = (right?.principals ?? {}) as Obj
  const resolvable = strings(p.resolvableGroups)
  const literals = strings(p.literalStrings)
  const forest = strings(p.forestRootOnly)
  const conditional: Obj[] = Array.isArray(p.conditionalGroups) ? p.conditionalGroups : []
  const total = resolvable.length + literals.length + forest.length + conditional.length
  // A freshly added (empty) right opens right away.
  const [open, setOpen] = React.useState(total === 0)
  const rightOptions = React.useMemo(() => {
    const taken = usedKey.split('|')
    const opts = rightOptionsAll.filter((o) => o.value === right?.right || !taken.includes(o.value))
    if (right?.right && !opts.some((o) => o.value === right.right)) opts.unshift({ value: right.right, hint: 'Unbekanntes Recht' })
    return opts
  }, [usedKey, right?.right])
  const litOpts = React.useMemo(() => literalOptions(suggestions.literals), [suggestions.literals])
  const frOpts = React.useMemo(() => forestRootOptions(suggestions.forestRoot), [suggestions.forestRoot])

  const setPrincipal = React.useCallback(
    (key: string, keepMissing: boolean) => (v: unknown[]) =>
      updateRight(index, (r) => {
        const pr = (r.principals ?? {}) as Obj
        const next = keepMissing ? setListKeep(pr, key, v) : { ...pr, [key]: v }
        return next === pr ? r : { ...r, principals: next }
      }),
    [index, updateRight],
  )
  const onResolvable = React.useMemo(() => setPrincipal('resolvableGroups', false), [setPrincipal])
  const onLiterals = React.useMemo(() => setPrincipal('literalStrings', false), [setPrincipal])
  const onForest = React.useMemo(() => setPrincipal('forestRootOnly', true), [setPrincipal])
  const onConditional = React.useMemo(() => setPrincipal('conditionalGroups', true), [setPrincipal])
  const idp = `ura-${index}`

  return (
    <div className="rounded-lg border bg-muted/20">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Zuklappen' : 'Aufklappen'}
          className="grid size-6 shrink-0 place-content-center rounded text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        </button>
        <div className="min-w-0 flex-1">
          <Combobox
            key={String(right?.right ?? '')}
            id={`${idp}-right`}
            value={String(right?.right ?? '')}
            onChange={(v) => v && updateRight(index, (r) => ({ ...r, right: v }))}
            options={rightOptions}
            placeholder="Benutzerrecht wählen"
            searchPlaceholder="Recht oder Konstante suchen …"
            disabled={disabled}
          />
        </div>
        <Badge variant={total ? 'secondary' : 'muted'} className="hidden tabular sm:inline-flex" title="Einträge">
          {total}
        </Badge>
        {!disabled && (
          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => removeRight(index)} aria-label="Benutzerrecht entfernen">
            <Trash2 />
          </Button>
        )}
      </div>
      {!open && total > 0 && (
        <button type="button" onClick={() => setOpen(true)} className="block w-full truncate px-11 pb-2 text-left text-xs text-muted-foreground hover:text-foreground">
          {[...resolvable, ...literals.map((l) => LITERAL_SUGGESTIONS.find((x) => x.value === l)?.label ?? l), ...forest].join(', ')}
          {conditional.length > 0 && ` · ${conditional.length} bedingt`}
        </button>
      )}
      {open && (
        <div className="grid min-w-0 gap-4 border-t bg-card px-3 py-4 sm:px-4 [&>*]:min-w-0">
          <Field label="Gruppen (werden aufgelöst)" htmlFor={`${idp}-res`} hint="Werden beim Deployment über den Namen im AD aufgelöst.">
            <PrincipalPicker id={`${idp}-res`} values={resolvable} onChange={onResolvable} disabled={disabled} />
          </Field>
          <Field label="Feste Einträge" htmlFor={`${idp}-lit`} hint="Werden unverändert übernommen: SIDs mit *-Präfix oder lokale Konten wie NT SERVICE\…">
            <MultiCombobox id={`${idp}-lit`} values={literals} onChange={onLiterals} options={litOpts} disabled={disabled} placeholder="SID oder Konto wählen oder eingeben …" />
          </Field>
          <Field label="Nur in der Stammdomäne der Gesamtstruktur" htmlFor={`${idp}-fr`} hint="Gruppen, die nur in der Forest-Root-Domäne existieren.">
            <MultiCombobox id={`${idp}-fr`} values={forest} onChange={onForest} options={frOpts} disabled={disabled} placeholder="Gruppe wählen …" />
          </Field>
          <ConditionalGroups items={conditional} onChange={onConditional} disabled={disabled} idPrefix={idp} />
        </div>
      )}
    </div>
  )
})

function ConditionalGroups({ items, onChange, disabled, idPrefix }: { items: Obj[]; onChange: (v: Obj[]) => void; disabled: boolean; idPrefix: string }) {
  const suggestions = React.useContext(GpoSuggestionsContext)
  const set = (i: number, next: Obj) => onChange(items.map((x, j) => (j === i ? next : x)))
  return (
    <div className="grid min-w-0 gap-2 [&>*]:min-w-0">
      <Label>Bedingte Gruppen</Label>
      <p className="-mt-1 text-xs text-muted-foreground">Werden nur eingetragen, wenn die Bedingung erfüllt ist.</p>
      {items.map((c, i) => {
        const conds: Obj[] = Array.isArray(c?.conditions) ? c.conditions : []
        return (
          <div key={i} className="grid gap-3 rounded-md border bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <Field label="Gruppen" htmlFor={`${idPrefix}-cg-${i}`} className="min-w-0 flex-1">
                <PrincipalPicker id={`${idPrefix}-cg-${i}`} values={strings(c?.names)} onChange={(v) => set(i, { ...c, names: v })} disabled={disabled} extra={suggestions.conditional} />
              </Field>
              {!disabled && (
                <Button type="button" variant="ghost" size="icon-sm" className="mt-5 text-muted-foreground hover:text-destructive" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Bedingte Gruppe entfernen">
                  <Trash2 />
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
              {(conds.length ? conds : [undefined]).map((cond, k) => {
                const known = CONDITIONS.find((x) => x.type === cond?.type && x.operator === cond?.operator)
                const cur = cond ? `${cond.type}|${cond.operator}` : ''
                const opts = CONDITIONS.map((x) => ({ value: `${x.type}|${x.operator}`, label: x.label }))
                if (cond && !known) opts.push({ value: cur, label: `${cond.type} ${cond.operator}` })
                return (
                  <Field key={k} label={conds.length > 1 ? `Bedingung ${k + 1}` : 'Bedingung'} htmlFor={`${idPrefix}-cg-${i}-c${k}`}>
                    <Select
                      id={`${idPrefix}-cg-${i}-c${k}`}
                      value={cur}
                      disabled={disabled}
                      options={opts}
                      placeholder="Bedingung wählen"
                      onValueChange={(v) => {
                        if (v === cur) return
                        const [type, operator] = v.split('|')
                        const nextConds = conds.length ? conds.map((x, j) => (j === k ? { ...x, type, operator } : x)) : [{ type, operator }]
                        set(i, { ...c, conditions: nextConds })
                      }}
                    />
                  </Field>
                )
              })}
              <Field label="Kommentar" htmlFor={`${idPrefix}-cg-${i}-cm`}>
                <Input id={`${idPrefix}-cg-${i}-cm`} value={c?.comment ?? ''} disabled={disabled} onChange={(e) => set(i, { ...c, comment: e.target.value })} placeholder="Warum ist die Gruppe bedingt?" />
              </Field>
            </div>
          </div>
        )
      })}
      {items.length === 0 && <p className="text-xs text-muted-foreground">Keine bedingten Gruppen.</p>}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="justify-self-start"
          onClick={() => onChange([...items, { names: [], conditions: [{ type: 'groupExists', operator: 'exists' }], comment: '' }])}
        >
          <Plus /> Bedingte Gruppe hinzufügen
        </Button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ restricted groups

const builtinGroupOptions: ComboOption[] = BUILTIN_GROUPS.map((b) => ({ value: b.value, label: b.label, hint: b.hint }))

export const RestrictedGroupsSection = React.memo(function RestrictedGroupsSection({
  value,
  update,
  disabled,
  error,
}: {
  value: unknown
  update: Updater
  disabled: boolean
  error?: string
}) {
  const rg = restrictedAsObject(value)
  const empty = strings(rg.emptyGroups)
  const memberships: Obj[] = Array.isArray(rg.membershipGroups) ? rg.membershipGroups : []
  const setRg = React.useCallback(
    (fn: (rg: Obj) => Obj) => update((g) => setRestricted(g, fn(restrictedAsObject(g.restrictedGroups)))),
    [update],
  )

  return (
    <Collapsible
      title="Eingeschränkte Gruppen"
      description="Lokale Gruppen leeren oder ihre Mitgliedschaften festlegen (Restricted Groups)."
      count={empty.length + memberships.length}
      icon={<Users />}
      error={error}
    >
      <EmptyGroupsPicker values={empty} onChange={(v) => setRg((r) => ({ ...r, emptyGroups: v }))} disabled={disabled} />
      <div className="grid min-w-0 gap-2 [&>*]:min-w-0">
        <Label>Mitgliedschaften festlegen</Label>
        <p className="-mt-1 text-xs text-muted-foreground">Legt fest, welche Gruppen Mitglied einer lokalen Gruppe sind (bzw. wovon sie Mitglied ist).</p>
        {memberships.map((m, i) => (
          <MembershipRow
            key={i}
            item={m}
            index={i}
            disabled={disabled}
            onChange={(next) => setRg((r) => ({ ...r, membershipGroups: (r.membershipGroups as Obj[]).map((x, j) => (j === i ? next : x)) }))}
            onRemove={() => setRg((r) => ({ ...r, membershipGroups: (r.membershipGroups as Obj[]).filter((_, j) => j !== i) }))}
          />
        ))}
        {memberships.length === 0 && <p className="text-xs text-muted-foreground">Keine Mitgliedschaften festgelegt.</p>}
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="justify-self-start"
            onClick={() => setRg((r) => ({ ...r, membershipGroups: [...(Array.isArray(r.membershipGroups) ? r.membershipGroups : []), { groupSidOrName: '__Members', memberGroups: [] }] }))}
          >
            <Plus /> Mitgliedschaft hinzufügen
          </Button>
        )}
      </div>
    </Collapsible>
  )
})

function RelationSelect({ id, value, onChange, disabled }: { id?: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const opts = [
    { value: 'Members', label: 'Mitglieder' },
    { value: 'Memberof', label: 'Mitglied von' },
  ]
  if (value && !opts.some((o) => o.value === value)) opts.push({ value, label: value })
  return <Select id={id} value={value} onValueChange={onChange} options={opts} disabled={disabled} placeholder="Beziehung" />
}

function MembershipRow({ item, index, onChange, onRemove, disabled }: { item: Obj; index: number; onChange: (v: Obj) => void; onRemove: () => void; disabled: boolean }) {
  const { group, relation } = parseGroupRelation(String(item?.groupSidOrName ?? ''))
  const members = strings(item?.memberGroups)
  const onMembers = React.useCallback((v: string[]) => onChange({ ...item, memberGroups: v }), [item, onChange])
  const id = `rg-m-${index}`
  return (
    <div className="grid min-w-0 gap-3 rounded-md border bg-muted/20 p-3 [&>*]:min-w-0">
      <div className="flex items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_11rem]">
          <Field label="Gruppe" htmlFor={`${id}-g`}>
            <Combobox
              id={`${id}-g`}
              value={group}
              onChange={(g) => onChange({ ...item, groupSidOrName: formatGroupRelation(g, relation || 'Members') })}
              options={builtinGroupOptions}
              placeholder="Lokale Gruppe wählen"
              searchPlaceholder="Gruppe oder SID suchen …"
              invalid={!group}
              disabled={disabled}
            />
          </Field>
          <Field label="Beziehung" htmlFor={`${id}-r`}>
            <RelationSelect id={`${id}-r`} value={relation} onChange={(r) => onChange({ ...item, groupSidOrName: formatGroupRelation(group, r) })} disabled={disabled} />
          </Field>
        </div>
        {!disabled && (
          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="Mitgliedschaft entfernen">
            <Trash2 />
          </Button>
        )}
      </div>
      <Field label={relation === 'Memberof' ? 'Ist Mitglied von' : 'Mitglieder'} htmlFor={`${id}-mem`}>
        <PrincipalPicker id={`${id}-mem`} values={members} onChange={onMembers} disabled={disabled} />
      </Field>
    </div>
  )
}

function EmptyGroupsPicker({ values, onChange, disabled }: { values: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const [group, setGroup] = React.useState('')
  const [members, setMembers] = React.useState(true)
  const [memberOf, setMemberOf] = React.useState(true)
  const lower = values.map((v) => v.toLowerCase())
  const toAdd = group
    ? ([members && 'Members', memberOf && 'Memberof'].filter(Boolean) as string[]).map((r) => formatGroupRelation(group, r)).filter((v) => !lower.includes(v.toLowerCase()))
    : []
  const add = () => {
    if (!toAdd.length) return
    onChange([...values, ...toAdd])
    setGroup('')
  }
  return (
    <div className="grid min-w-0 gap-2 [&>*]:min-w-0">
      <Label>Leeren</Label>
      <p className="-mt-1 text-xs text-muted-foreground">Die Mitglieder dieser lokalen Gruppen bzw. deren Mitgliedschaften werden geleert.</p>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/60 py-0.5 pr-0.5 pl-2 text-xs" title={v}>
              <span className="truncate">{describeGroupRelation(v)}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`${describeGroupRelation(v)} entfernen`}
                  className="grid size-4 place-content-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Keine Gruppen werden geleert.</p>
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-dashed p-2">
          <div className="min-w-56 flex-1">
            <Combobox value={group} onChange={setGroup} options={builtinGroupOptions} placeholder="Lokale Gruppe wählen …" searchPlaceholder="Gruppe oder SID suchen …" />
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={members} onCheckedChange={(c) => setMembers(c === true)} /> Mitglieder
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={memberOf} onCheckedChange={(c) => setMemberOf(c === true)} /> Mitglied von
          </label>
          <Button type="button" size="sm" variant="secondary" onClick={add} disabled={!toAdd.length}>
            <Plus /> Hinzufügen
          </Button>
        </div>
      )}
    </div>
  )
}

