import * as React from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  Copy,
  Eye,
  FileStack,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { SortableTH, Table, TBody, TD, TH, THead, TR, type SortDir } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { TierBadge, TierDot } from '@/components/shared/badges'
import { useHotkey } from '@/hooks/use-hotkey'
import { tierOf } from '@/lib/tier'
import { cn, formatNumber } from '@/lib/utils'
import type { EditorProps } from './editors'
import { SwitchRow, useGpoNameOptions, useOuOptions } from './form-helpers'
import { useGpoBackupOptions } from './lookups'
import { useDraftState } from './draft-store'
import { DenyApplySection, GpoSuggestionsContext, RestrictedGroupsSection, UserRightsSection, collectSuggestions } from './gpo-fields'
import {
  DC_OU,
  DOMAIN_DN,
  GPO_KINDS,
  GPO_MODES,
  GPO_STATUSES,
  TEMPLATE_KEY,
  addTarget,
  finalizeGpo,
  gpoList,
  isLinked,
  kindDescriptions,
  kindLabels,
  modeMeta,
  newGpo,
  nextLinkOrder,
  removeTarget,
  replaceGpo,
  setGpoList,
  setTarget,
  setText,
  statusMeta,
  targetHint,
  targetTitle,
  validateGpo,
  type GpoKind,
  type Obj,
} from './gpo-model'
import { gpoLinkTierIssues } from '@/lib/tier-rules'
import { TierRuleAlerts } from './tier-rule-alerts'

/* Form editor for tiermodel-gpos.json: link targets (master) → GPO lists (detail) → edit sheet.
 * Content is immutable; every edit spreads the original objects so unknown keys survive. */

interface EditState {
  /** Increments per opened sheet so the form re-initialises. */
  id: number
  targetKey: string
  kind: GpoKind
  /** null = new entry */
  index: number | null
  original: Obj | null
  /** Saved (server) version of this GPO, if any: decides whether emptied keys are removed again. */
  reference: Obj | null
  initial: Obj
}

type Apply = (fn: (c: Obj) => Obj, tag?: string) => void

const matchesQuery = (g: Obj, q: string) =>
  !q || `${g?.name ?? ''} ${g?.rename ?? ''} ${g?.importPath ?? ''}`.toLowerCase().includes(q)

const targetTier = (key: string) => (key === TEMPLATE_KEY ? null : tierOf(key))

let editSeq = 0

export function GposEditor(props: EditorProps) {
  const { content, readOnly } = props
  const contentRef = React.useRef<Obj>(content)
  contentRef.current = content
  const base = useDraftState((s) => s.bases[props.sectionKey]?.content) as Obj | undefined
  const baseRef = React.useRef(base)
  baseRef.current = base
  const setContentRef = React.useRef(props.setContent)
  setContentRef.current = props.setContent
  const apply = React.useCallback<Apply>((fn, tag) => {
    const cur = contentRef.current
    const next = fn(cur)
    if (next !== cur) setContentRef.current(next, tag)
  }, [])
  const confirm = useConfirm()

  const map = (content?.gpos ?? {}) as Obj
  const keys = React.useMemo(() => Object.keys(map), [map])
  const [selectedRaw, setSelected] = React.useState<string | null>(null)

  const [search, setSearch] = React.useState('')
  const query = React.useDeferredValue(search.trim().toLowerCase())
  const searchRef = React.useRef<HTMLInputElement>(null)
  useHotkey('mod+f', () => searchRef.current?.focus(), { allowInInputs: true })

  const rows = React.useMemo<TargetRow[]>(
    () =>
      keys.map((k) => {
        const tt = map[k]
        const imp = gpoList(tt, 'ImportOnlyGpo')
        const post = gpoList(tt, 'PostConfigureGpo')
        const title = targetTitle(k, tt)
        const selfMatch = !!query && `${title} ${k} ${tt?.displayName ?? ''}`.toLowerCase().includes(query)
        const hits = query ? imp.filter((g) => matchesQuery(g, query)).length + post.filter((g) => matchesQuery(g, query)).length : 0
        return { k, title, imp: imp.length, post: post.length, hits, selfMatch, visible: !query || selfMatch || hits > 0 }
      }),
    [keys, map, query],
  )
  const visible = React.useMemo(() => rows.filter((r) => r.visible), [rows])
  const picked = selectedRaw !== null && selectedRaw in map ? selectedRaw : (keys[0] ?? null)
  // While searching, show the first matching target if the picked one has no hits.
  const selected = query && picked && !visible.some((r) => r.k === picked) ? (visible[0]?.k ?? null) : picked
  const selectedRow = rows.find((r) => r.k === selected)
  const detailQuery = selectedRow?.selfMatch && !selectedRow.hits ? '' : query

  const suggestions = React.useMemo(() => collectSuggestions(content), [content?.gpos])
  const [editing, setEditing] = React.useState<EditState | null>(null)
  const [moving, setMoving] = React.useState<{ targetKey: string; kind: GpoKind; index: number } | null>(null)

  const totals = React.useMemo(() => {
    let n = 0
    for (const k of keys) for (const kind of GPO_KINDS) n += gpoList(map[k], kind).length
    return n
  }, [keys, map])

  // ---- actions (stable: read the latest content through the ref)
  const openGpo = React.useCallback((targetKey: string, kind: GpoKind, index: number) => {
    const g = gpoList(contentRef.current?.gpos?.[targetKey], kind)[index]
    if (!g) return
    const saved = gpoList(baseRef.current?.gpos?.[targetKey], kind).find((x) => x?.name === g.name) ?? null
    setEditing({ id: ++editSeq, targetKey, kind, index, original: g, reference: saved ?? g, initial: g })
  }, [])
  const newGpoFor = React.useCallback((targetKey: string, kind: GpoKind) => {
    setEditing({ id: ++editSeq, targetKey, kind, index: null, original: null, reference: null, initial: newGpo(kind, targetKey, contentRef.current?.gpos?.[targetKey]) })
  }, [])
  const duplicateGpo = React.useCallback((targetKey: string, kind: GpoKind, index: number) => {
    const tt = contentRef.current?.gpos?.[targetKey]
    const g = gpoList(tt, kind)[index]
    if (!g) return
    const copy: Obj = { ...structuredClone(g), name: `${g.name ?? ''} (Kopie)` }
    if (isLinked(targetKey) && 'linkOrder' in g) copy.linkOrder = nextLinkOrder(tt)
    setEditing({ id: ++editSeq, targetKey, kind, index: null, original: null, reference: null, initial: copy })
  }, [])
  const removeGpo = React.useCallback(
    async (targetKey: string, kind: GpoKind, index: number) => {
      const g = gpoList(contentRef.current?.gpos?.[targetKey], kind)[index]
      if (!g) return
      const ok = await confirm({
        title: 'GPO entfernen?',
        description: (
          <>
            <span className="font-medium text-foreground">{g.name}</span> wird aus „{targetTitle(targetKey)}“ entfernt. Die Änderung wird erst beim Speichern übernommen und kann mit Strg+Z rückgängig gemacht werden.
          </>
        ),
        confirmText: 'Entfernen',
        destructive: true,
      })
      if (!ok) return
      apply((c) => {
        const list = gpoList(c.gpos?.[targetKey], kind)
        const i = list[index] === g ? index : list.indexOf(g)
        return i < 0 ? c : setGpoList(c, targetKey, kind, list.filter((_, j) => j !== i))
      })
      toast('GPO entfernt', { description: g.name })
    },
    [apply, confirm],
  )
  const toggleLink = React.useCallback(
    (targetKey: string, kind: GpoKind, index: number, v: boolean) => {
      apply((c) => {
        const g = gpoList(c.gpos?.[targetKey], kind)[index]
        return g ? replaceGpo(c, targetKey, kind, index, { ...g, linkEnabled: v }) : c
      })
    },
    [apply],
  )
  const moveKind = React.useCallback((targetKey: string, kind: GpoKind, index: number) => setMoving({ targetKey, kind, index }), [])

  const removeTargetKey = React.useCallback(
    async (key: string) => {
      const tt = contentRef.current?.gpos?.[key]
      const n = GPO_KINDS.reduce((s, k) => s + gpoList(tt, k).length, 0)
      const ok = await confirm({
        title: 'Verknüpfungsziel entfernen?',
        description: (
          <>
            <span className="font-medium text-foreground">{targetTitle(key, tt)}</span>
            <span className="block font-mono text-xs break-all">{key}</span>
            {n > 0 ? ` Alle ${n} GPO-Einträge dieses Ziels werden ebenfalls entfernt.` : ' Das Ziel enthält keine GPOs.'} Die Änderung kann mit Strg+Z rückgängig gemacht werden.
          </>
        ),
        confirmText: 'Entfernen',
        destructive: true,
      })
      if (!ok) return
      apply((c) => removeTarget(c, key))
      toast('Verknüpfungsziel entfernt', { description: targetTitle(key, tt) })
    },
    [apply, confirm],
  )

  const addTargetKey = (key: string) => {
    const k = key.trim()
    if (!k) return
    if (k in (contentRef.current?.gpos ?? {})) {
      setSelected(k)
      return
    }
    if (k !== TEMPLATE_KEY && !k.includes('=')) {
      toast.error('Ungültiges Verknüpfungsziel', { description: 'Erwartet wird ein Distinguished Name, z. B. OU=Name,{{DOMAIN_DN}}.' })
      return
    }
    apply((c) => addTarget(c, k, { ImportOnlyGpo: [], PostConfigureGpo: [] }))
    setSelected(k)
    toast.success('Verknüpfungsziel hinzugefügt', { description: 'Im Entwurf – zum Übernehmen speichern.' })
  }

  const submitGpo = (st: EditState, value: Obj): Record<string, string> | null => {
    const c = contentRef.current
    const tt = c?.gpos?.[st.targetKey]
    if (!tt) {
      toast.error('Verknüpfungsziel existiert nicht mehr')
      return null
    }
    const list = gpoList(tt, st.kind)
    // The list may have changed while the sheet was open (undo/redo): find the entry by identity.
    const index = st.index === null ? null : list[st.index] === st.original ? st.index : list.indexOf(st.original!)
    if (index === -1) {
      toast.error('GPO wurde zwischenzeitlich geändert oder entfernt', { description: 'Die Bearbeitung wurde nicht übernommen. Bitte erneut öffnen.' })
      setEditing(null)
      return null
    }
    const final = finalizeGpo(value, st.reference)
    const errs = validateGpo(final, st.targetKey, tt, st.kind, index)
    if (Object.keys(errs).length) return errs
    if (index !== null && JSON.stringify(final) === JSON.stringify(st.original)) {
      setEditing(null)
      return null
    }
    apply((cur) => (index === null ? setGpoList(cur, st.targetKey, st.kind, [...list, final]) : replaceGpo(cur, st.targetKey, st.kind, index, final)))
    toast.success(index === null ? 'GPO hinzugefügt' : 'GPO aktualisiert', { description: 'Im Entwurf – zum Übernehmen speichern.' })
    setEditing(null)
    return null
  }

  const target = selected ? map[selected] : undefined

  return (
    <GpoSuggestionsContext.Provider value={suggestions}>
      <GeneralSettings version={content?.version} comment={content?.comment} apply={apply} readOnly={readOnly} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="GPO-Namen durchsuchen …"
            className="h-8 pr-8 pl-8 text-[13px]"
            aria-label="GPOs durchsuchen"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Suche leeren">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatNumber(keys.length)} Ziele · {formatNumber(totals)} GPOs
        </span>
        {!readOnly && (
          <div className="ml-auto w-full sm:w-80">
            <AddTargetPicker existing={keys} onAdd={addTargetKey} />
          </div>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(230px,290px)_minmax(0,1fr)]">
        <TargetList visible={visible} selected={selected} onSelect={setSelected} query={query} />
        {selected && target ? (
          <TargetDetail
            key={selected}
            targetKey={selected}
            target={target}
            query={detailQuery}
            readOnly={readOnly}
            apply={apply}
            onOpen={openGpo}
            onNew={newGpoFor}
            onDuplicate={duplicateGpo}
            onRemove={removeGpo}
            onMove={moveKind}
            onToggleLink={toggleLink}
            onRemoveTarget={removeTargetKey}
          />
        ) : (
          <Card>
            <EmptyState icon={<Inbox />} title="Keine Verknüpfungsziele" description={readOnly ? undefined : 'Fügen Sie oben ein Verknüpfungsziel hinzu.'} />
          </Card>
        )}
      </div>

      <GpoSheet state={editing} readOnly={readOnly} onClose={() => setEditing(null)} onSubmit={submitGpo} />
      {moving && <MoveDialog moving={moving} keys={keys} apply={apply} onClose={() => setMoving(null)} onMoved={(k) => setSelected(k)} />}
    </GpoSuggestionsContext.Provider>
  )
}

// ============================================================ general (version, comment)

const GeneralSettings = React.memo(function GeneralSettings({
  version,
  comment,
  apply,
  readOnly,
}: {
  version: unknown
  comment: unknown
  apply: Apply
  readOnly: boolean
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Card className="mb-3 overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] hover:bg-accent/40">
        <Settings2 className="size-4 text-muted-foreground" />
        <span className="font-medium">Allgemein</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {version !== undefined && <>Version {String(version)}</>}
          {typeof comment === 'string' && comment && <> · {comment}</>}
        </span>
        <span className="text-xs text-muted-foreground">{open ? 'Zuklappen' : 'Bearbeiten'}</span>
      </button>
      {open && (
        <fieldset disabled={readOnly} className="grid gap-4 border-t px-4 py-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Version" htmlFor="gpos-version">
            <Input
              id="gpos-version"
              className="font-mono"
              value={version === undefined ? '' : String(version)}
              onChange={(e) => apply((c) => setText(c, 'version', e.target.value, !('version' in c)), 'gpos-version')}
            />
          </Field>
          <Field label="Kommentar" htmlFor="gpos-comment">
            <Textarea
              id="gpos-comment"
              rows={2}
              className="min-h-0"
              value={typeof comment === 'string' ? comment : ''}
              onChange={(e) => apply((c) => setText(c, 'comment', e.target.value, !('comment' in c)), 'gpos-comment')}
            />
          </Field>
        </fieldset>
      )}
    </Card>
  )
})

// ============================================================ add target

function AddTargetPicker({ existing, onAdd }: { existing: string[]; onAdd: (k: string) => void }) {
  const ouOptions = useOuOptions()
  const options = React.useMemo(() => {
    const taken = new Set(existing.map((k) => k.toLowerCase()))
    const base: ComboOption[] = [
      { value: DOMAIN_DN, label: 'Domänenstamm', hint: DOMAIN_DN, icon: <TierDot tier={null} /> },
      { value: DC_OU, label: 'Domain Controllers', hint: DC_OU, icon: <TierDot tier={0} /> },
      ...ouOptions,
      { value: TEMPLATE_KEY, label: 'Vorlagen (nicht verknüpft)', hint: TEMPLATE_KEY, icon: <FileStack className="size-4 text-muted-foreground" /> },
    ]
    const seen = new Set<string>()
    return base.filter((o) => {
      const k = o.value.toLowerCase()
      if (taken.has(k) || seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [ouOptions, existing])
  // Remount after each add: the chosen option disappears from the list, and cmdk must not see
  // its items change while the popover closes.
  return (
    <Combobox
      key={existing.length}
      value=""
      onChange={onAdd}
      options={options}
      placeholder="+ Verknüpfungsziel hinzufügen …"
      searchPlaceholder="OU suchen oder DN eingeben …"
      emptyText="Keine weitere OU verfügbar"
      validateCustom={(v) => (v === TEMPLATE_KEY || /^(OU|CN|DC)=/i.test(v) || v === DOMAIN_DN ? null : 'Distinguished Name erwartet, z. B. OU=Name,{{DOMAIN_DN}}')}
    />
  )
}

// ============================================================ master: targets

interface TargetRow {
  k: string
  title: string
  imp: number
  post: number
  hits: number
  selfMatch: boolean
  visible: boolean
}

const TargetList = React.memo(function TargetList({
  visible,
  selected,
  onSelect,
  query,
}: {
  visible: TargetRow[]
  selected: string | null
  onSelect: (k: string) => void
  query: string
}) {
  return (
    <Card className="overflow-hidden lg:sticky lg:top-4">
      <div className="border-b bg-muted/30 px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Verknüpfungsziele</div>
      {visible.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">Keine Treffer</p>
      ) : (
        <ul className="max-h-[calc(100dvh-260px)] overflow-y-auto p-1.5" role="listbox" aria-label="Verknüpfungsziele">
          {visible.map((r) => {
            const active = r.k === selected
            return (
              <li key={r.k}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => onSelect(r.k)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/60',
                    active && 'bg-primary/8 ring-1 ring-primary/25 hover:bg-primary/10',
                  )}
                >
                  {r.k === TEMPLATE_KEY ? <FileStack className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <TierDot tier={targetTier(r.k)} className="mt-1.5" />}
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className={cn('truncate text-[13px]', active ? 'font-semibold' : 'font-medium')} title={r.title}>
                      {r.title}
                    </span>
                    <span className="truncate font-mono text-[10.5px] text-muted-foreground" title={r.k}>
                      {targetHint(r.k)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
                    {query && r.hits > 0 ? (
                      <Badge variant="info" className="tabular text-[10px]">{r.hits} Treffer</Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground tabular" title={`${r.imp} nur importiert · ${r.post} konfiguriert`}>
                        {r.imp + r.post}
                      </span>
                    )}
                    {r.post > 0 && !query && <span className="text-[10px] text-sky-600 tabular dark:text-sky-400" title="Importieren & konfigurieren">{r.post} konf.</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
})

// ============================================================ detail: one target

interface DetailProps {
  targetKey: string
  target: Obj
  query: string
  readOnly: boolean
  apply: Apply
  onOpen: (key: string, kind: GpoKind, index: number) => void
  onNew: (key: string, kind: GpoKind) => void
  onDuplicate: (key: string, kind: GpoKind, index: number) => void
  onRemove: (key: string, kind: GpoKind, index: number) => void
  onMove: (key: string, kind: GpoKind, index: number) => void
  onToggleLink: (key: string, kind: GpoKind, index: number, v: boolean) => void
  onRemoveTarget: (key: string) => void
}

const TargetDetail = React.memo(function TargetDetail(p: DetailProps) {
  const { targetKey, target, readOnly, apply } = p
  const linked = isLinked(targetKey)
  const tier = targetTier(targetKey)
  const dupOrders = React.useMemo(() => {
    const seen = new Map<number, number>()
    for (const k of GPO_KINDS) for (const g of gpoList(target, k)) if (typeof g?.linkOrder === 'number') seen.set(g.linkOrder, (seen.get(g.linkOrder) ?? 0) + 1)
    return [...seen].filter(([, n]) => n > 1).map(([o]) => o).sort((a, b) => a - b)
  }, [target])

  return (
    <div className="grid min-w-0 gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold tracking-tight">{targetTitle(targetKey, target)}</h3>
              {tier !== null && <TierBadge tier={tier} />}
              {!linked && <Badge variant="muted">Nicht verknüpft</Badge>}
            </div>
            <p className="mt-0.5 font-mono text-[12px] break-all text-muted-foreground">{targetKey}</p>
          </div>
          {!readOnly && (
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => p.onRemoveTarget(targetKey)}>
              <Trash2 /> Ziel entfernen
            </Button>
          )}
        </div>
        <div className="mt-4 max-w-md">
          <Field label="Anzeigename" htmlFor="gpo-target-dn" hint="Optionaler, lesbarer Name für dieses Ziel.">
            <Input
              id="gpo-target-dn"
              value={typeof target.displayName === 'string' ? target.displayName : ''}
              disabled={readOnly}
              placeholder={targetTitle(targetKey)}
              onChange={(e) => {
                const v = e.target.value
                apply((c) => {
                  const tt = (c.gpos?.[targetKey] ?? {}) as Obj
                  return setTarget(c, targetKey, setText(tt, 'displayName', v, !('displayName' in target)))
                }, `gpo-displayName-${targetKey}`)
              }}
            />
          </Field>
        </div>
        {dupOrders.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5" /> Link-Reihenfolge mehrfach vergeben: {dupOrders.join(', ')}
          </p>
        )}
      </Card>
      {GPO_KINDS.map((kind) => (
        <GpoTable key={kind} {...p} kind={kind} list={gpoList(target, kind)} linked={linked} />
      ))}
    </div>
  )
})

type SortKey = 'order' | 'name' | 'mode'

const modeVariant = (m: unknown): 'muted' | 'secondary' | 'info' | 'outline' =>
  m === 'create' ? 'muted' : m === 'createAndImport' ? 'secondary' : m === 'createImportAndConfigure' ? 'info' : 'outline'

function GpoTable({
  kind,
  list,
  linked,
  targetKey,
  query,
  readOnly,
  onOpen,
  onNew,
  onDuplicate,
  onRemove,
  onMove,
  onToggleLink,
}: DetailProps & { kind: GpoKind; list: Obj[]; linked: boolean }) {
  const [sort, setSort] = React.useState<{ id: SortKey; dir: SortDir }>({ id: linked ? 'order' : 'name', dir: 'asc' })
  const rows = React.useMemo(() => {
    let r = list.map((g, index) => ({ g, index }))
    if (query) r = r.filter(({ g }) => matchesQuery(g, query))
    const val = (g: Obj): string | number =>
      sort.id === 'order' ? (typeof g.linkOrder === 'number' ? g.linkOrder : Number.MAX_SAFE_INTEGER) : sort.id === 'mode' ? String(g.mode ?? '') : String(g.name ?? '')
    r.sort((a, b) => {
      const va = val(a.g)
      const vb = val(b.g)
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'de', { numeric: true })
      return (sort.dir === 'asc' ? c : -c) || a.index - b.index
    })
    return r
  }, [list, query, sort])
  const toggleSort = (id: SortKey) => setSort((s) => (s.id === id ? { id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: 'asc' }))
  const other: GpoKind = kind === 'ImportOnlyGpo' ? 'PostConfigureGpo' : 'ImportOnlyGpo'

  return (
    <Card className="@container overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-[13px] font-semibold">{kindLabels[kind]}</h4>
            <Badge variant="muted" className="tabular">{query ? `${rows.length} / ${list.length}` : list.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{kindDescriptions[kind]}</p>
        </div>
        {!readOnly && (
          <Button type="button" size="sm" variant="outline" onClick={() => onNew(targetKey, kind)}>
            <Plus /> GPO hinzufügen
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-muted-foreground">{list.length === 0 ? 'Keine GPOs in dieser Liste.' : 'Keine Treffer für die Suche.'}</p>
      ) : (
        <Table>
          <THead>
            <TR>
              {linked && <SortableTH label="#" active={sort.id === 'order'} dir={sort.dir} onClick={() => toggleSort('order')} className="w-12" />}
              <SortableTH label="Name" active={sort.id === 'name'} dir={sort.dir} onClick={() => toggleSort('name')} />
              <SortableTH label="Modus" active={sort.id === 'mode'} dir={sort.dir} onClick={() => toggleSort('mode')} className="hidden @xl:table-cell" />
              <TH className="hidden @3xl:table-cell">Status</TH>
              {linked && <TH className="w-16">Link</TH>}
              <TH className="w-10"><span className="sr-only">Aktionen</span></TH>
            </TR>
          </THead>
          <TBody>
            {rows.map(({ g, index }) => (
              <GpoRow
                key={index}
                g={g}
                index={index}
                kind={kind}
                other={other}
                linked={linked}
                targetKey={targetKey}
                readOnly={readOnly}
                onOpen={onOpen}
                onDuplicate={onDuplicate}
                onRemove={onRemove}
                onMove={onMove}
                onToggleLink={onToggleLink}
              />
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  )
}

const GpoRow = React.memo(function GpoRow({
  g,
  index,
  kind,
  linked,
  targetKey,
  readOnly,
  onOpen,
  onDuplicate,
  onRemove,
  onMove,
  onToggleLink,
}: {
  g: Obj
  index: number
  kind: GpoKind
  other: GpoKind
  linked: boolean
  targetKey: string
  readOnly: boolean
  onOpen: DetailProps['onOpen']
  onDuplicate: DetailProps['onDuplicate']
  onRemove: DetailProps['onRemove']
  onMove: DetailProps['onMove']
  onToggleLink: DetailProps['onToggleLink']
}) {
  const mode = modeMeta(g.mode)
  const status = statusMeta(g.gpoStatus)
  const extras: string[] = []
  if (Array.isArray(g.userRightsAssignments) && g.userRightsAssignments.length) extras.push(`${g.userRightsAssignments.length} Rechte`)
  if (g.restrictedGroups && !Array.isArray(g.restrictedGroups) && (g.restrictedGroups.emptyGroups?.length || g.restrictedGroups.membershipGroups?.length))
    extras.push('Eingeschr. Gruppen')
  if (Array.isArray(g.denyApplyGroupPolicy) && g.denyApplyGroupPolicy.length) extras.push('Verweigern')
  return (
    <TR
      className="group cursor-pointer"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button,a,[role=menuitem],[role=switch]')) return
        onOpen(targetKey, kind, index)
      }}
    >
      {linked && <TD className="w-12 font-mono text-xs text-muted-foreground tabular">{g.linkOrder ?? '–'}</TD>}
      <TD className="max-w-0 w-full">
        <div className="grid min-w-0 gap-0.5">
          <span className={cn('truncate text-[13px] font-medium', linked && g.linkEnabled === false && 'text-muted-foreground')} title={g.name}>
            {g.name || <span className="text-destructive">Ohne Namen</span>}
          </span>
          {(g.rename || extras.length > 0 || g.comment) && (
            <span className="truncate text-[11px] text-muted-foreground" title={g.comment || undefined}>
              {g.rename && <>Suchmuster: <span className="font-mono">{g.rename}</span>{(extras.length > 0 || g.comment) && ' · '}</>}
              {extras.length > 0 && <>{extras.join(' · ')}{g.comment && ' · '}</>}
              {g.comment}
            </span>
          )}
        </div>
      </TD>
      <TD className="hidden @xl:table-cell">
        <Badge variant={modeVariant(g.mode)} title={mode?.label ?? String(g.mode ?? '')}>
          {mode?.short ?? String(g.mode ?? '–')}
        </Badge>
      </TD>
      <TD className="hidden text-xs whitespace-nowrap text-muted-foreground @3xl:table-cell" title={status?.label}>
        {status?.short ?? String(g.gpoStatus ?? '–')}
      </TD>
      {linked && (
        <TD className="w-16">
          <Tooltip content={g.linkEnabled ? 'Verknüpfung aktiv' : 'Verknüpfung deaktiviert'}>
            <span className="inline-flex">
              <Switch
                checked={!!g.linkEnabled}
                disabled={readOnly || !('linkEnabled' in g || linked)}
                onCheckedChange={(v) => onToggleLink(targetKey, kind, index, v)}
                aria-label={`Verknüpfung von ${g.name} aktiv`}
              />
            </span>
          </Tooltip>
        </TD>
      )}
      <TD className="w-10 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="Aktionen">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onOpen(targetKey, kind, index)}>
              {readOnly ? <><Eye /> Anzeigen</> : <><Pencil /> Bearbeiten</>}
            </DropdownMenuItem>
            {!readOnly && (
              <>
                <DropdownMenuItem onSelect={() => onDuplicate(targetKey, kind, index)}>
                  <Copy /> Duplizieren
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMove(targetKey, kind, index)}>
                  <ArrowRightLeft /> Verschieben …
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onRemove(targetKey, kind, index)} destructive>
                  <Trash2 /> Entfernen
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TD>
    </TR>
  )
})

// ============================================================ move dialog

function MoveDialog({
  moving,
  keys,
  apply,
  onClose,
  onMoved,
}: {
  moving: { targetKey: string; kind: GpoKind; index: number }
  keys: string[]
  apply: Apply
  onClose: () => void
  onMoved: (key: string) => void
}) {
  const [dest, setDest] = React.useState(moving.targetKey)
  const [kind, setKind] = React.useState<GpoKind>(moving.kind === 'ImportOnlyGpo' ? 'PostConfigureGpo' : 'ImportOnlyGpo')
  const [error, setError] = React.useState<string | null>(null)
  const same = dest === moving.targetKey && kind === moving.kind

  const submit = () => {
    let err: string | null = null
    let moved = false
    apply((c) => {
      const src = gpoList(c.gpos?.[moving.targetKey], moving.kind)
      const g = src[moving.index]
      const destT = c.gpos?.[dest]
      if (!g || !destT) {
        err = 'Eintrag oder Ziel existiert nicht mehr.'
        return c
      }
      const name = String(g.name ?? '').toLowerCase()
      const clash = GPO_KINDS.some((k) => gpoList(destT, k).some((x) => x !== g && String(x?.name ?? '').toLowerCase() === name))
      if (clash) {
        err = 'Im Ziel existiert bereits eine GPO mit diesem Namen.'
        return c
      }
      let moved_: Obj = g
      if (dest !== moving.targetKey && isLinked(dest) && !('linkOrder' in g)) moved_ = { ...g, linkOrder: nextLinkOrder(destT), linkEnabled: false }
      let next = setGpoList(c, moving.targetKey, moving.kind, src.filter((_, i) => i !== moving.index))
      next = setGpoList(next, dest, kind, [...gpoList(next.gpos?.[dest], kind), moved_])
      moved = true
      return next
    })
    if (err) {
      setError(err)
      return
    }
    if (moved) {
      toast.success('GPO verschoben', { description: `${targetTitle(dest)} · ${kindLabels[kind]}` })
      onMoved(dest)
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!same) submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>GPO verschieben</DialogTitle>
            <DialogDescription>In ein anderes Verknüpfungsziel oder in die andere Liste.</DialogDescription>
          </DialogHeader>
          <Field label="Verknüpfungsziel" htmlFor="gpo-move-dest">
            <Combobox
              id="gpo-move-dest"
              value={dest}
              onChange={(v) => { setDest(v); setError(null) }}
              allowCustom={false}
              options={keys.map((k) => ({ value: k, label: targetTitle(k), hint: targetHint(k), icon: k === TEMPLATE_KEY ? <FileStack className="size-4 text-muted-foreground" /> : <TierDot tier={targetTier(k)} /> }))}
            />
          </Field>
          <Field label="Liste" htmlFor="gpo-move-kind" hint={kind === 'ImportOnlyGpo' && moving.kind === 'PostConfigureGpo' ? 'Benutzerrechte und eingeschränkte Gruppen bleiben erhalten, werden in dieser Liste aber nicht angewendet.' : undefined}>
            <Select
              id="gpo-move-kind"
              value={kind}
              onValueChange={(v) => { setKind(v as GpoKind); setError(null) }}
              options={GPO_KINDS.map((k) => ({ value: k, label: kindLabels[k] }))}
            />
          </Field>
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button type="submit" disabled={same}>Verschieben</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================ edit sheet

function GpoSheet({
  state,
  readOnly,
  onClose,
  onSubmit,
}: {
  state: EditState | null
  readOnly: boolean
  onClose: () => void
  onSubmit: (st: EditState, value: Obj) => Record<string, string> | null
}) {
  return (
    <Sheet open={!!state} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-2xl" aria-describedby={undefined}>
        {state && <GpoSheetBody key={state.id} state={state} readOnly={readOnly} onClose={onClose} onSubmit={onSubmit} />}
      </SheetContent>
    </Sheet>
  )
}

function GpoSheetBody({
  state,
  readOnly,
  onClose,
  onSubmit,
}: {
  state: EditState
  readOnly: boolean
  onClose: () => void
  onSubmit: (st: EditState, value: Obj) => Record<string, string> | null
}) {
  const [value, setValue] = React.useState<Obj>(state.initial)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const update = React.useCallback((fn: (g: Obj) => Obj) => setValue((v) => fn(v)), [])
  const changed = state.original === null || JSON.stringify(finalizeGpo(value, state.reference)) !== JSON.stringify(state.original)
  const tier = targetTier(state.targetKey)

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (readOnly) return
        const errs = onSubmit(state, value)
        if (errs) setErrors(errs)
      }}
    >
      <SheetHeader>
        <div className="flex items-center gap-2">
          {state.targetKey === TEMPLATE_KEY ? <FileStack className="size-4 text-muted-foreground" /> : <TierDot tier={tier} />}
          <SheetTitle>{readOnly ? value.name || 'GPO' : state.index === null ? 'GPO hinzufügen' : 'GPO bearbeiten'}</SheetTitle>
        </div>
        <SheetDescription>
          {targetTitle(state.targetKey)} · {kindLabels[state.kind]}
          {readOnly && ' · Nur-Lese-Ansicht'}
        </SheetDescription>
      </SheetHeader>
      <SheetBody>
        <div className="grid min-w-0 gap-6 [&>*]:min-w-0">
          <TierRuleAlerts issues={state.targetKey === TEMPLATE_KEY ? [] : gpoLinkTierIssues(value.name, state.targetKey)} />
          <GpoForm value={value} update={update} errors={errors} readOnly={readOnly} targetKey={state.targetKey} kind={state.kind} reference={state.reference} />
        </div>
      </SheetBody>
      <SheetFooter>
        {readOnly ? (
          <Button type="button" variant="outline" onClick={onClose}>Schließen</Button>
        ) : (
          <>
            {Object.keys(errors).length > 0 && <span className="mr-auto text-xs text-destructive">Bitte markierte Felder prüfen.</span>}
            <Button type="button" variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button type="submit" disabled={!changed}>{state.index === null ? 'Hinzufügen' : 'Übernehmen'}</Button>
          </>
        )}
      </SheetFooter>
    </form>
  )
}

/** Like FormSection, but its children may shrink (long mono paths must truncate, not widen the sheet). */
function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid min-w-0 gap-4 [&>*]:min-w-0">
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

const modeOptions = GPO_MODES.map((m) => ({ value: m.value, label: m.label, description: m.description }))
const statusOptions = GPO_STATUSES.map((s) => ({ value: s.value, label: s.label }))
const withUnknown = <T extends { value: string; label: React.ReactNode }>(opts: T[], v: unknown) =>
  typeof v === 'string' && v && !opts.some((o) => o.value === v) ? [...opts, { value: v, label: v } as T] : opts

function GpoForm({
  value,
  update,
  errors,
  readOnly,
  targetKey,
  kind,
  reference,
}: {
  value: Obj
  update: (fn: (g: Obj) => Obj) => void
  errors: Record<string, string>
  readOnly: boolean
  targetKey: string
  kind: GpoKind
  reference: Obj | null
}) {
  const gpoNames = useGpoNameOptions()
  const backups = useGpoBackupOptions()
  const [freeName, setFreeName] = React.useState(false)
  const set = (key: string, v: unknown) => update((g) => ({ ...g, [key]: v }))
  const had = (key: string) => !!reference && key in reference
  const showLink = isLinked(targetKey) || 'linkOrder' in value || 'linkEnabled' in value
  const mode = modeMeta(value.mode)
  const importPath = typeof value.importPath === 'string' ? value.importPath : ''
  const unknownBackup = !!importPath && backups.length > 0 && !backups.some((b) => b.value.toLowerCase() === importPath.toLowerCase())

  return (
    <>
      {/* Plain fields are disabled via fieldset; the collapsible sections below get explicit
          disabled props so their expanders keep working in the read-only view. */}
      <fieldset disabled={readOnly} className="contents">
      <Section title="Allgemein">
        <Field label="Name" htmlFor="gpo-name" required error={errors.name} hint="Anzeigename der GPO im Active Directory.">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              {freeName ? (
                <Input id="gpo-name" autoFocus value={value.name ?? ''} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} placeholder="*- Tier 0 Servers - Computer" />
              ) : (
                <Combobox
                  id="gpo-name"
                  value={value.name ?? ''}
                  onChange={(v) => set('name', v)}
                  options={gpoNames}
                  placeholder="Name wählen oder eingeben"
                  searchPlaceholder="Name suchen oder neu eingeben …"
                  invalid={!!errors.name}
                />
              )}
            </div>
            {!readOnly && (
              <Tooltip content={freeName ? 'Vorschläge anzeigen' : 'Namen direkt bearbeiten'}>
                <Button type="button" variant="outline" size="icon" onClick={() => setFreeName((f) => !f)} aria-pressed={freeName} aria-label={freeName ? 'Vorschläge anzeigen' : 'Namen direkt bearbeiten'}>
                  {freeName ? <Search /> : <Pencil />}
                </Button>
              </Tooltip>
            )}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Modus" htmlFor="gpo-mode" required error={errors.mode} hint={mode?.description}>
            <Select id="gpo-mode" value={value.mode} onValueChange={(v) => set('mode', v)} options={withUnknown(modeOptions, value.mode)} placeholder="Modus wählen" disabled={readOnly} />
          </Field>
          <Field label="Status" htmlFor="gpo-status" hint="Welche Hälfte der GPO aktiv ist.">
            <Select id="gpo-status" value={value.gpoStatus} onValueChange={(v) => set('gpoStatus', v)} options={withUnknown(statusOptions, value.gpoStatus)} placeholder="Status wählen" disabled={readOnly} />
          </Field>
        </div>
        {value.mode !== 'create' && (
          <Field label="Import-Pfad" htmlFor="gpo-import" required error={errors.importPath} hint={unknownBackup ? 'Dieser Pfad ist nicht unter den mitgelieferten GPO-Backups.' : 'GPO-Backup aus dem Framework (config\\gpo\\…\\{GUID}).'}>
            <Combobox
              id="gpo-import"
              mono
              value={importPath}
              onChange={(v) => {
                const b = backups.find((x) => x.value === v)
                update((g) => {
                  const next: Obj = { ...g, importPath: v }
                  if (!String(g.name ?? '').trim() && b?.label) next.name = `*- ${b.label}`
                  return next
                })
              }}
              options={backups}
              placeholder="GPO-Backup wählen"
              searchPlaceholder="Backup nach Name, Ordner oder GUID suchen …"
              invalid={!!errors.importPath}
            />
          </Field>
        )}
      </Section>

      {showLink && (
        <Section title="Verknüpfung">
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field label="Link-Reihenfolge" htmlFor="gpo-order" required error={errors.linkOrder}>
              <Input
                id="gpo-order"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={value.linkOrder === undefined || value.linkOrder === null ? '' : String(value.linkOrder)}
                aria-invalid={!!errors.linkOrder}
                onChange={(e) => {
                  const raw = e.target.value
                  const n = Number(raw)
                  update((g) => {
                    if (raw === '') {
                      const next = { ...g }
                      delete next.linkOrder
                      return next
                    }
                    return { ...g, linkOrder: Number.isFinite(n) ? n : raw }
                  })
                }}
              />
            </Field>
            <div className="grid content-end">
              <SwitchRow id="gpo-link" label="Verknüpfung aktiv" description="Deaktivierte Links werden angelegt, aber nicht angewendet." checked={!!value.linkEnabled} onCheckedChange={(v) => set('linkEnabled', v)} />
            </div>
          </div>
        </Section>
      )}

      <Section title="Beschreibung">
        <Field label="Umbenennen in" htmlFor="gpo-rename" hint="Optional: Suchmuster (Platzhalter * erlaubt), über das eine bereits umbenannte GPO wiedergefunden wird.">
          <Input id="gpo-rename" value={value.rename ?? ''} onChange={(e) => { const v = e.target.value; update((g) => setText(g, 'rename', v, !had('rename'))) }} placeholder="z. B. *- Tier 0 DCs SHF" />
        </Field>
        <Field label="GPO-Kommentar" htmlFor="gpo-gcomment" hint="Wird als Kommentar in die GPO geschrieben.">
          <Textarea id="gpo-gcomment" rows={3} value={value.gpoComment ?? ''} onChange={(e) => { const v = e.target.value; update((g) => setText(g, 'gpoComment', v, !had('gpoComment') && reference !== null)) }} />
        </Field>
        <Field label="Kommentar" htmlFor="gpo-comment" hint="Interne Notiz in der Konfiguration.">
          <Textarea id="gpo-comment" rows={2} value={value.comment ?? ''} onChange={(e) => { const v = e.target.value; update((g) => setText(g, 'comment', v, !had('comment') && reference !== null)) }} />
        </Field>
      </Section>
      </fieldset>

      {(kind === 'PostConfigureGpo' || 'userRightsAssignments' in value || 'restrictedGroups' in value || 'denyApplyGroupPolicy' in value) && (
        <Section title="Konfiguration" description="Wird nach dem Import auf die GPO angewendet.">
          <div className="grid min-w-0 gap-3 [&>*]:min-w-0">
            <DenyApplySection values={Array.isArray(value.denyApplyGroupPolicy) ? value.denyApplyGroupPolicy : []} update={update} disabled={readOnly} />
            <UserRightsSection rights={Array.isArray(value.userRightsAssignments) ? value.userRightsAssignments : []} update={update} disabled={readOnly} error={errors.userRightsAssignments} />
            <RestrictedGroupsSection value={value.restrictedGroups} update={update} disabled={readOnly} error={errors.restrictedGroups} />
          </div>
        </Section>
      )}
    </>
  )
}
