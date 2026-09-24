import * as React from 'react'
import { useSearchParams } from 'react-router'
import { Copy, Eye, MoreHorizontal, Pencil, Plus, Search, Trash2, X, Inbox } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { SortableTH, Table, TBody, TD, TH, THead, TR, type SortDir } from '@/components/ui/table'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { TierDot } from '@/components/shared/badges'
import { matchesTierFilter, type Tier, type TierFilter } from '@/lib/tier'
import { cn, formatNumber } from '@/lib/utils'
import { useHotkey } from '@/hooks/use-hotkey'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Item = Record<string, any>

export interface Column {
  id: string
  header: string
  cell: (item: Item, index: number) => React.ReactNode
  sortValue?: (item: Item) => string | number
  className?: string
}

export interface FormProps {
  value: Item
  onChange: (next: Item) => void
  errors: Record<string, string>
  readOnly: boolean
  index: number | null
}

export interface ExtraAction {
  label: string
  icon: React.ReactNode
  onSelect: (item: Item, index: number) => void
}

export interface ListEditorProps {
  items: Item[]
  onItemsChange: (next: Item[], tag?: string) => void
  columns: Column[]
  searchText: (item: Item) => string
  tierOf: (item: Item) => Tier
  itemLabel: (item: Item) => string
  newItem: () => Item
  Form: React.ComponentType<FormProps>
  validate?: (item: Item, all: Item[], index: number | null) => Record<string, string>
  entity: { singular: string; plural: string; article: 'den' | 'die' | 'das' }
  readOnly: boolean
  extraActions?: ExtraAction[]
  toolbarExtra?: React.ReactNode
  defaultSort?: string
  /** Rendered instead of the table (e.g. tree view). Receives the edit opener. */
  alternateView?: (open: (index: number) => void) => React.ReactNode
}

export function ListEditor(props: ListEditorProps) {
  const { items, onItemsChange, columns, searchText, tierOf, itemLabel, newItem, Form, validate, entity, readOnly } = props
  const [search, setSearch] = React.useState('')
  const [tier, setTier] = React.useState<TierFilter>('all')
  const [sort, setSort] = React.useState<{ id: string; dir: SortDir } | null>(props.defaultSort ? { id: props.defaultSort, dir: 'asc' } : null)
  const [editing, setEditing] = React.useState<{ index: number | null; value: Item; original: Item | null } | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [params, setParams] = useSearchParams()
  const confirm = useConfirm()
  const searchRef = React.useRef<HTMLInputElement>(null)

  useHotkey('mod+f', () => searchRef.current?.focus(), { allowInInputs: true })
  useHotkey('n', () => !readOnly && openNew(), { enabled: !readOnly && !editing })

  // Deep link: ?edit=<index>
  const editParam = params.get('edit')
  React.useEffect(() => {
    if (editParam === null) return
    const i = Number(editParam)
    if (Number.isInteger(i) && items[i]) open(i)
    const p = new URLSearchParams(params)
    p.delete('edit')
    setParams(p, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, items.length])

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    let r = items.map((item, index) => ({ item, index }))
    if (q) r = r.filter(({ item }) => searchText(item).toLowerCase().includes(q))
    if (tier !== 'all') r = r.filter(({ item }) => matchesTierFilter(tierOf(item), tier))
    if (sort) {
      const col = columns.find((c) => c.id === sort.id)
      if (col?.sortValue) {
        const f = col.sortValue
        r = [...r].sort((a, b) => {
          const va = f(a.item)
          const vb = f(b.item)
          const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'de', { numeric: true })
          return sort.dir === 'asc' ? c : -c
        })
      }
    }
    return r
  }, [items, search, tier, sort, columns, searchText, tierOf])

  const tierCounts = React.useMemo(() => {
    const c = { '0': 0, '1': 0, '2': 0 }
    items.forEach((i) => {
      const t = tierOf(i)
      if (t === 0 || t === 1 || t === 2) c[String(t) as '0'] += 1
    })
    return c
  }, [items, tierOf])

  function open(index: number) {
    setErrors({})
    setEditing({ index, value: JSON.parse(JSON.stringify(items[index])), original: items[index] })
  }
  function openNew() {
    setErrors({})
    setEditing({ index: null, value: newItem(), original: null })
  }
  function duplicate(index: number) {
    const copy = JSON.parse(JSON.stringify(items[index]))
    setErrors({})
    setEditing({ index: null, value: copy, original: null })
  }
  async function remove(index: number) {
    const ok = await confirm({
      title: `${entity.singular} löschen?`,
      description: (
        <>
          <span className="font-medium text-foreground">{itemLabel(items[index])}</span> wird aus dem Entwurf entfernt. Die Änderung wird erst beim Speichern übernommen und kann mit {`Strg+Z`} rückgängig gemacht werden.
        </>
      ),
      confirmText: 'Löschen',
      destructive: true,
    })
    if (!ok) return
    const next = items.filter((_, i) => i !== index)
    onItemsChange(next)
    toast(`${entity.singular} entfernt`, { description: itemLabel(items[index]) })
  }

  function submit() {
    if (!editing) return
    const errs = validate?.(editing.value, items, editing.index) ?? {}
    setErrors(errs)
    if (Object.keys(errs).length) return
    const next = [...items]
    if (editing.index === null) next.push(editing.value)
    else next[editing.index] = editing.value
    onItemsChange(next)
    toast.success(editing.index === null ? `${entity.singular} hinzugefügt` : `${entity.singular} aktualisiert`, {
      description: 'Im Entwurf – zum Übernehmen speichern.',
    })
    setEditing(null)
  }

  const changed = editing && editing.original && JSON.stringify(editing.original) !== JSON.stringify(editing.value)
  const toggleSort = (id: string) =>
    setSort((s) => (s?.id === id ? (s.dir === 'asc' ? { id, dir: 'desc' } : null) : { id, dir: 'asc' }))

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${entity.plural} filtern …`}
            className="h-8 pr-8 pl-8 text-[13px]"
            aria-label={`${entity.plural} filtern`}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Filter leeren">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Segmented<TierFilter>
          aria-label="Tier-Filter"
          value={tier}
          onValueChange={setTier}
          options={[
            { value: 'all', label: 'Alle' },
            { value: '0', label: `T0 · ${tierCounts['0']}`, icon: <TierDot tier={0} /> },
            { value: '1', label: `T1 · ${tierCounts['1']}`, icon: <TierDot tier={1} /> },
            { value: '2', label: `T2 · ${tierCounts['2']}`, icon: <TierDot tier={2} /> },
            { value: 'none', label: 'Sonstige' },
          ]}
          className="[&_button]:h-7 [&_button]:px-2.5 [&_button]:text-xs"
        />
        <div className="ml-auto flex items-center gap-2">
          {props.toolbarExtra}
          {!readOnly && (
            <Button size="sm" onClick={openNew}>
              <Plus /> {entity.singular} hinzufügen
            </Button>
          )}
        </div>
      </div>

      {props.alternateView ? (
        props.alternateView(open)
      ) : (
        <Card className="@container overflow-hidden">
          {rows.length === 0 ? (
            items.length === 0 ? (
              <EmptyState
                icon={<Inbox />}
                title={`Keine ${entity.plural} konfiguriert`}
                description={readOnly ? undefined : `Legen Sie ${entity.article === 'den' ? 'den ersten' : entity.article === 'das' ? 'das erste' : 'die erste'} ${entity.singular} an.`}
                action={!readOnly && <Button size="sm" onClick={openNew}><Plus /> {entity.singular} hinzufügen</Button>}
              />
            ) : (
              <EmptyState
                icon={<Search />}
                title="Keine Treffer"
                description="Passen Sie Suche oder Tier-Filter an."
                action={<Button size="sm" variant="outline" onClick={() => { setSearch(''); setTier('all') }}>Filter zurücksetzen</Button>}
              />
            )
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-3 pr-0" aria-label="Tier" />
                  {columns.map((c) =>
                    c.sortValue ? (
                      <SortableTH key={c.id} label={c.header} active={sort?.id === c.id} dir={sort?.dir ?? 'asc'} onClick={() => toggleSort(c.id)} className={c.className} />
                    ) : (
                      <TH key={c.id} className={c.className}>{c.header}</TH>
                    ),
                  )}
                  <TH className="w-10"><span className="sr-only">Aktionen</span></TH>
                </TR>
              </THead>
              <TBody>
                {rows.map(({ item, index }) => (
                  <TR
                    key={index}
                    className="group cursor-pointer"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button,a,[role=menuitem]')) return
                      open(index)
                    }}
                  >
                    <TD className="w-3 pr-0"><TierDot tier={tierOf(item)} /></TD>
                    {columns.map((c) => (
                      <TD key={c.id} className={c.className}>{c.cell(item, index)}</TD>
                    ))}
                    <TD className="w-10 text-right">
                      <RowMenu
                        readOnly={readOnly}
                        onEdit={() => open(index)}
                        onDuplicate={() => duplicate(index)}
                        onDelete={() => remove(index)}
                        extra={props.extraActions?.map((a) => ({ ...a, run: () => a.onSelect(item, index) }))}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t bg-muted/20 px-5 py-2 text-xs text-muted-foreground">
            <span>
              {rows.length === items.length ? `${formatNumber(items.length)} ${entity.plural}` : `${formatNumber(rows.length)} von ${formatNumber(items.length)} ${entity.plural}`}
            </span>
            {!readOnly && <span className="hidden sm:inline">Zeile anklicken zum Bearbeiten · <kbd className="font-sans">N</kbd> für neu</span>}
          </div>
        </Card>
      )}

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="sm:max-w-2xl" aria-describedby={undefined}>
          {editing && (
            <form
              className="flex h-full flex-col"
              onSubmit={(e) => {
                e.preventDefault()
                if (!readOnly) submit()
              }}
            >
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <TierDot tier={tierOf(editing.value)} />
                  <SheetTitle>
                    {readOnly
                      ? itemLabel(editing.value) || entity.singular
                      : editing.index === null
                        ? `${entity.singular} hinzufügen`
                        : `${entity.singular} bearbeiten`}
                  </SheetTitle>
                </div>
                <SheetDescription>
                  {readOnly
                    ? 'Nur-Lese-Ansicht – Ihre Rolle erlaubt keine Änderungen.'
                    : editing.index === null
                      ? 'Neuer Eintrag im Entwurf. Wird erst beim Speichern der Sektion übernommen.'
                      : itemLabel(editing.original ?? editing.value)}
                </SheetDescription>
              </SheetHeader>
              <SheetBody>
                <fieldset disabled={readOnly} className="grid min-w-0 gap-5">
                  <Form
                    value={editing.value}
                    onChange={(v) => setEditing((e) => (e ? { ...e, value: v } : e))}
                    errors={errors}
                    readOnly={readOnly}
                    index={editing.index}
                  />
                </fieldset>
              </SheetBody>
              <SheetFooter>
                {readOnly ? (
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>Schließen</Button>
                ) : (
                  <>
                    {Object.keys(errors).length > 0 && (
                      <span className="mr-auto text-xs text-destructive">Bitte markierte Felder prüfen.</span>
                    )}
                    <Button type="button" variant="outline" onClick={() => setEditing(null)}>Abbrechen</Button>
                    <Button type="submit" disabled={editing.index !== null && !changed}>
                      {editing.index === null ? 'Hinzufügen' : 'Übernehmen'}
                    </Button>
                  </>
                )}
              </SheetFooter>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function RowMenu({
  readOnly,
  onEdit,
  onDuplicate,
  onDelete,
  extra,
}: {
  readOnly: boolean
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  extra?: { label: string; icon: React.ReactNode; run: () => void }[]
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn('text-muted-foreground opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100')}
          aria-label="Aktionen"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          {readOnly ? <><Eye /> Anzeigen</> : <><Pencil /> Bearbeiten</>}
        </DropdownMenuItem>
        {!readOnly && (
          <>
            {extra?.map((a) => (
              <DropdownMenuItem key={a.label} onSelect={a.run}>
                {a.icon} {a.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy /> Duplizieren
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} destructive>
              <Trash2 /> Löschen
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
