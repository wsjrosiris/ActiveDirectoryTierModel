import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import {
  ArrowRightLeft,
  Ban,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  Download,
  Folder,
  FolderOpen,
  GitCompareArrows,
  Link2,
  ListChecks,
  Lock,
  Network,
  Pencil,
  RefreshCw,
  ServerOff,
  ShieldAlert,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { AdAce, AdCompare, AdObject, AdTree, CompareStatus, OuComparison } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { TierBadge } from '@/components/shared/badges'
import { useCan } from '@/features/auth/auth'
import { useLocalStorage } from '@/hooks/use-local-storage'
import { objectClassLabels } from '@/lib/labels'
import { DOMAIN, ouFullDn, type OuItem } from '@/lib/ou'
import { tierMeta, tierOf } from '@/lib/tier'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { draftStore } from './draft-store'
import { OusEditor, type EditorProps } from './editors'

/* Live view of Active Directory next to the configuration (roadmap 14): Soll | Ist | Vergleich. */

// ---------------------------------------------------------------- data

export const adTreeKey = ['ad', 'tree'] as const
export const adCompareKey = ['ad', 'compare'] as const

export function useAdTree() {
  return useQuery({ queryKey: adTreeKey, queryFn: () => api.ad.tree(), staleTime: 60_000 })
}

export function useAdCompare() {
  return useQuery({ queryKey: adCompareKey, queryFn: () => api.ad.compare(), staleTime: 60_000 })
}

/** Reads the directory again (bypassing the server's 60 s cache) and refreshes both views. */
export function useAdRefresh() {
  const qc = useQueryClient()
  const [busy, setBusy] = React.useState(false)
  const refresh = React.useCallback(async () => {
    setBusy(true)
    try {
      const compare = await api.ad.compare(true)
      qc.setQueryData(adCompareKey, compare)
      qc.setQueryData(adTreeKey, await api.ad.tree(false))
      qc.invalidateQueries({ queryKey: ['ad', 'object'] })
    } catch (e) {
      toast.error('Active Directory konnte nicht gelesen werden', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }, [qc])
  return { refresh, busy }
}

// ---------------------------------------------------------------- labels

export const compareStatusMeta: Record<CompareStatus, { label: string; variant: 'success' | 'danger' | 'info' | 'warning'; icon: React.ReactNode }> = {
  same: { label: 'gleich', variant: 'success', icon: <CircleCheck /> },
  missing: { label: 'fehlt im AD', variant: 'danger', icon: <CircleMinus /> },
  extra: { label: 'nur im AD', variant: 'info', icon: <CirclePlus /> },
  different: { label: 'abweichend', variant: 'warning', icon: <TriangleAlert /> },
}

export function CompareBadge({ status }: { status: CompareStatus }) {
  const m = compareStatusMeta[status]
  return <Badge variant={m.variant}>{m.icon}{m.label}</Badge>
}

const inheritanceText: Record<string, string> = {
  None: 'Nur dieses Objekt',
  All: 'Objekt und alle Nachfolger',
  Descendents: 'Nur Nachfolger',
  SelfAndChildren: 'Objekt und direkte Kinder',
  Children: 'Nur direkte Kinder',
}

/** "OU=Tier 0,OU=Admin,DC=contoso,DC=local" → "Admin › Tier 0" */
export function adPath(dn: string, domainDn?: string | null) {
  const rel = domainDn && dn.toLowerCase().endsWith(domainDn.toLowerCase()) ? dn.slice(0, dn.length - domainDn.length).replace(/,$/, '') : dn
  if (!rel) return 'Domänenstamm'
  return rel
    .split(/,(?=\s*[A-Za-z]+=)/)
    .filter((p) => !/^DC=/i.test(p.trim()))
    .map((p) => p.trim().replace(/^[A-Za-z]+=/, ''))
    .reverse()
    .join(' › ')
}

// ---------------------------------------------------------------- generic tree

interface TreeNodeData {
  dn: string
  name: string
  parentDn: string | null
}

interface Built<T> {
  node: T
  children: Built<T>[]
}

function buildTree<T extends TreeNodeData>(nodes: T[]): Built<T>[] {
  const byDn = new Map<string, Built<T>>()
  for (const n of nodes) byDn.set(n.dn.toLowerCase(), { node: n, children: [] })
  const roots: Built<T>[] = []
  for (const b of byDn.values()) {
    const parent = b.node.parentDn ? byDn.get(b.node.parentDn.toLowerCase()) : undefined
    if (parent) parent.children.push(b)
    else roots.push(b)
  }
  const sort = (list: Built<T>[]) => {
    list.sort((a, b) => a.node.name.localeCompare(b.node.name, 'de'))
    list.forEach((c) => sort(c.children))
  }
  sort(roots)
  return roots
}

function LiveTree<T extends TreeNodeData>({
  nodes,
  rootLabel,
  onSelect,
  renderExtra,
  defaultDepth = 2,
  label,
}: {
  nodes: T[]
  rootLabel: string
  onSelect: (n: T) => void
  renderExtra?: (n: T) => React.ReactNode
  defaultDepth?: number
  label: string
}) {
  const roots = React.useMemo(() => buildTree(nodes), [nodes])
  const all = React.useMemo(() => {
    const out: { dn: string; depth: number }[] = []
    const walk = (ns: Built<T>[], d: number) => ns.forEach((n) => { out.push({ dn: n.node.dn, depth: d }); walk(n.children, d + 1) })
    walk(roots, 0)
    return out
  }, [roots])
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(all.filter((n) => n.depth < defaultDepth).map((n) => n.dn)))
  const toggle = (dn: string) => setExpanded((s) => { const n = new Set(s); if (n.has(dn)) n.delete(dn); else n.add(dn); return n })

  const renderNode = (b: Built<T>, depth: number): React.ReactNode => {
    const n = b.node
    const hasChildren = b.children.length > 0
    const open = expanded.has(n.dn)
    const tier = tierOf(n.dn)
    const Icon = hasChildren && open ? FolderOpen : Folder
    return (
      <div key={n.dn} role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={false}>
        <div className="group relative flex min-h-8 items-center gap-1.5 rounded-md py-0.5 pr-2 transition-colors hover:bg-accent/70" style={{ paddingLeft: Math.min(depth, 8) * 16 + 4 }}>
          {depth > 0 && <span aria-hidden className="absolute top-0 bottom-0 border-l border-border" style={{ left: (Math.min(depth, 8) - 1) * 16 + 14 }} />}
          <button
            type="button"
            tabIndex={hasChildren ? 0 : -1}
            onClick={() => hasChildren && toggle(n.dn)}
            className={cn('grid size-5 shrink-0 place-content-center rounded text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', !hasChildren && 'invisible')}
            aria-label={open ? `${n.name} zuklappen` : `${n.name} aufklappen`}
          >
            <ChevronRight className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')} />
          </button>
          <Icon className={cn('size-4 shrink-0', tier !== null ? tierMeta[tier].text : 'text-muted-foreground')} />
          <button type="button" onClick={() => onSelect(n)} className="min-w-0 flex-1 truncate rounded text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" title={n.dn}>
            {n.name}
            {hasChildren && !open && <span className="ml-1.5 text-xs text-muted-foreground">({b.children.length})</span>}
          </button>
          {renderExtra?.(n)}
        </div>
        {hasChildren && open && <div role="group">{b.children.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-1">
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setExpanded(new Set(all.map((a) => a.dn)))}>
          <ChevronsUpDown /> Alle öffnen
        </Button>
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setExpanded(new Set())}>
          <ChevronsDownUp /> Alle schließen
        </Button>
      </div>
      <div role="tree" aria-label={label} className="text-sm">
        <div className="mb-1 flex items-center gap-2 px-2 py-1 text-[12px] text-muted-foreground">
          <Network className="size-3.5" />
          <span className="truncate">{rootLabel}</span>
        </div>
        {roots.map((r) => renderNode(r, 0))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- header / states

function SourceHeader({ data, refresh, busy, children }: { data: Pick<AdTree, 'source' | 'readAt' | 'domain'> | undefined; refresh: () => void; busy: boolean; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      {data?.domain && (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Network className="size-4 shrink-0" />
          <span className="truncate font-medium text-foreground">{data.domain.dnsName}</span>
        </span>
      )}
      {data?.source === 'Testdaten' && (
        <Tooltip content="Entwicklungsmodus: Die Daten stammen aus einem simulierten Active Directory.">
          <Badge variant="warning">Testdaten</Badge>
        </Tooltip>
      )}
      {data?.readAt && <span title={formatDateTime(data.readAt)}>Stand {formatRelative(data.readAt)}</span>}
      {children}
      <Button variant="outline" size="sm" className="ml-auto" onClick={refresh} disabled={busy}>
        <RefreshCw className={cn(busy && 'animate-spin')} /> Neu laden
      </Button>
    </div>
  )
}

function Unavailable({ message }: { message: string | null }) {
  return (
    <Card>
      <EmptyState
        icon={<ServerOff />}
        title="Active Directory nicht verfügbar"
        description={message ?? 'Die Ist-Ansicht kann das Active Directory derzeit nicht lesen.'}
      />
    </Card>
  )
}

function Loading() {
  return (
    <Card className="p-5">
      <div className="grid gap-2">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-7" style={{ marginLeft: (i % 3) * 16 }} />)}</div>
    </Card>
  )
}

// ---------------------------------------------------------------- Ist

export function AdTreeView() {
  const tree = useAdTree()
  const { refresh, busy } = useAdRefresh()
  const [selected, setSelected] = React.useState<string | null>(null)
  if (tree.isLoading) return <Loading />
  if (tree.isError || !tree.data?.available) return <Unavailable message={tree.data?.message ?? null} />
  const d = tree.data
  return (
    <>
      <SourceHeader data={d} refresh={refresh} busy={busy}>
        <span>{d.nodes.length} OUs</span>
      </SourceHeader>
      {d.truncated && <p className="mb-3 text-[13px] text-amber-700 dark:text-amber-300">Es werden nur die ersten {d.nodes.length} OUs angezeigt.</p>}
      <Card className="p-4">
        <LiveTree
          label="OU-Struktur im Active Directory"
          nodes={d.nodes.map((n) => ({ ...n, parentDn: n.parentDn }))}
          rootLabel={d.domain?.distinguishedName ?? ''}
          onSelect={(n) => setSelected(n.dn)}
          renderExtra={(n) => (
            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
              {n.protected && <Tooltip content="Vor versehentlichem Löschen geschützt"><Lock className="size-3 opacity-60" /></Tooltip>}
              {n.blockInheritance && <Tooltip content="GPO-Vererbung blockiert"><Ban className="size-3 opacity-60" /></Tooltip>}
              {n.gpos.length > 0 && (
                <Tooltip content={`Verknüpfte GPOs: ${n.gpos.join(', ')}`}>
                  <span className="inline-flex items-center gap-0.5 text-[11px]"><Link2 className="size-3" />{n.gpos.length}</span>
                </Tooltip>
              )}
              <TierBadge tier={tierOf(n.dn)} short className="hidden sm:inline-flex" />
            </span>
          )}
        />
      </Card>
      <AdObjectSheet dn={selected} domainDn={d.domain?.distinguishedName} onOpenChange={(o) => !o && setSelected(null)} onNavigate={setSelected} />
    </>
  )
}

function AceTable({ aces }: { aces: AdAce[] }) {
  const [showDefault, setShowDefault] = React.useState(false)
  const own = aces.filter((a) => !a.isDefault)
  const list = showDefault ? aces : own
  return (
    <div className="grid gap-2">
      {aces.length > own.length && (
        <Button variant="ghost" size="xs" className="justify-self-start text-muted-foreground" onClick={() => setShowDefault((v) => !v)}>
          {showDefault ? 'Standardberechtigungen ausblenden' : `${aces.length - own.length} Standardberechtigungen einblenden`}
        </Button>
      )}
      {list.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Keine eigenen Berechtigungen – nur geerbte.</p>
      ) : (
        <div className="grid gap-2">
          {list.map((a, i) => (
            <div key={i} className={cn('rounded-lg border px-3 py-2 text-[13px]', a.isDefault && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 font-medium break-all">{a.principal}</span>
                {a.type === 'Deny' ? <Badge variant="danger">Verweigern</Badge> : <Badge variant="success">Zulassen</Badge>}
                {a.isDefault && <Badge variant="muted">Standard</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {a.rights.map((r) => <Badge key={r} variant="secondary" className="font-normal">{r}</Badge>)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {a.objectType ? `Für „${a.objectType}“` : 'Für alle Objekte'}
                {a.inheritedObjectType ? ` auf „${a.inheritedObjectType}“-Objekten` : ''} · {inheritanceText[a.inheritance] ?? a.inheritance}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">{icon}{title}</h3>
      {children}
    </section>
  )
}

/** Details of one directory object: child OUs, object counts, GPO links, members and explicit ACEs. */
export function AdObjectSheet({ dn, domainDn, onOpenChange, onNavigate }: { dn: string | null; domainDn?: string | null; onOpenChange: (o: boolean) => void; onNavigate?: (dn: string) => void }) {
  const q = useQuery({ queryKey: ['ad', 'object', dn], queryFn: () => api.ad.object(dn!), enabled: !!dn, staleTime: 60_000 })
  const o: AdObject | undefined = q.data
  return (
    <Sheet open={!!dn} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Folder className={cn('size-4', tierOf(dn) !== null ? tierMeta[tierOf(dn) as 0].text : 'text-muted-foreground')} />
            <SheetTitle className="min-w-0 truncate">{o?.name ?? (dn ? adPath(dn, domainDn).split(' › ').pop() : '')}</SheetTitle>
          </div>
          <SheetDescription className="break-all">{dn ? adPath(dn, domainDn) : ''}</SheetDescription>
        </SheetHeader>
        <SheetBody className="grid content-start gap-6">
          {q.isLoading ? (
            <div className="grid gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : q.isError || !o?.available ? (
            <p className="text-[13px] text-muted-foreground">{o?.message ?? 'Das Objekt konnte nicht gelesen werden.'}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{o.kind === 'organizationalUnit' ? 'Organisationseinheit' : objectClassLabels[o.kind] ?? o.kind}</Badge>
                {o.ou?.protected && <Badge variant="muted"><Lock /> Löschschutz</Badge>}
                {o.ou?.blockInheritance && <Badge variant="muted"><Ban /> GPO-Vererbung blockiert</Badge>}
                <TierBadge tier={tierOf(o.dn)} />
              </div>
              {o.ou && (
                <>
                  {o.ou.counts && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        ['Benutzer', o.ou.counts.users],
                        ['Gruppen', o.ou.counts.groups],
                        ['Computer', o.ou.counts.computers],
                        ['Sonstige', o.ou.counts.other],
                      ].map(([label, n]) => (
                        <div key={label} className="rounded-lg border bg-card px-3 py-2">
                          <p className="text-[11px] text-muted-foreground uppercase">{label}</p>
                          <p className="text-lg font-semibold tabular">{n}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <Section title={`Untergeordnete OUs (${o.ou.childOus.length})`} icon={<Folder />}>
                    {o.ou.childOus.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">Keine.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {o.ou.childOus.map((c) => (
                          <Button key={c.dn} variant="outline" size="xs" onClick={() => onNavigate?.(c.dn)}>{c.name}</Button>
                        ))}
                      </div>
                    )}
                  </Section>
                  <Section title={`GPO-Verknüpfungen (${o.ou.gpoLinks.length})`} icon={<Link2 />}>
                    {o.ou.gpoLinks.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">Keine.</p>
                    ) : (
                      <Card className="overflow-hidden">
                        <Table>
                          <THead><TR><TH className="w-12">Nr.</TH><TH>GPO</TH><TH>Status</TH></TR></THead>
                          <TBody>
                            {o.ou.gpoLinks.map((l) => (
                              <TR key={`${l.order}-${l.name}`}>
                                <TD className="tabular">{l.order}</TD>
                                <TD><span className="break-words">{l.name}</span></TD>
                                <TD>
                                  <div className="flex flex-wrap gap-1">
                                    {l.enabled ? <Badge variant="success">aktiv</Badge> : <Badge variant="muted">deaktiviert</Badge>}
                                    {l.enforced && <Badge variant="warning">erzwungen</Badge>}
                                  </div>
                                </TD>
                              </TR>
                            ))}
                          </TBody>
                        </Table>
                      </Card>
                    )}
                  </Section>
                </>
              )}
              {o.members && (
                <Section title={`Mitglieder (${o.members.length})`} icon={<Users />}>
                  {o.members.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">Keine direkten Mitglieder.</p>
                  ) : (
                    <div className="grid gap-1.5">
                      {o.members.map((m) => (
                        <div key={m.distinguishedName} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[13px]">
                          <span className="font-medium">{m.name}</span>
                          <span className="text-muted-foreground">{m.samAccountName}</span>
                          <Badge variant="outline">{objectClassLabels[m.objectClass] ?? m.objectClass}</Badge>
                          {m.enabled === false && <Badge variant="muted">deaktiviert</Badge>}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}
              <Section title="Eigene Berechtigungen" icon={<ShieldAlert />}>
                <AceTable aces={o.aces} />
              </Section>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------- Vergleich

/** Adds OUs that exist only in AD to the ous draft (parents first, missing parents that are also only in AD included). */
export function adoptOus(selected: OuComparison[], all: OuComparison[]): number {
  const content = draftStore.current('ous') ?? { organizationUnits: [] }
  const existing: OuItem[] = Array.isArray(content.organizationUnits) ? content.organizationUnits : []
  const known = new Set(existing.map((o) => ouFullDn(o).toLowerCase()))
  const byDn = new Map(all.map((i) => [i.dn.toLowerCase(), i]))
  const wanted = new Map<string, OuComparison>()
  const add = (i: OuComparison) => {
    if (i.status !== 'extra' || wanted.has(i.dn.toLowerCase())) return
    const parent = i.parentDn ? byDn.get(i.parentDn.toLowerCase()) : undefined
    if (parent) add(parent)
    wanted.set(i.dn.toLowerCase(), i)
  }
  selected.forEach(add)
  const next = [...existing]
  let added = 0
  for (const i of wanted.values()) {
    const item = {
      name: i.name,
      path: i.suggestedPath ?? DOMAIN,
      protectFromAccidentalDeletion: i.protected ?? true,
      disableInheritance: false,
      blockGpoInheritance: i.blockInheritance ?? false,
      comment: 'Aus dem Active Directory übernommen',
    }
    if (known.has(ouFullDn(item).toLowerCase())) continue
    known.add(ouFullDn(item).toLowerCase())
    next.push(item)
    added++
  }
  if (added) draftStore.apply({ ous: { ...content, organizationUnits: next } })
  return added
}

const kindIcon: Record<string, React.ReactNode> = {
  'ou-missing': <CircleMinus className="text-rose-500" />,
  'ou-extra': <CirclePlus className="text-sky-500" />,
  'ace-missing': <CircleMinus className="text-rose-500" />,
  'ace-extra': <CirclePlus className="text-sky-500" />,
  'ace-rights': <ArrowRightLeft className="text-amber-500" />,
  'gpo-missing': <CircleMinus className="text-rose-500" />,
  'gpo-extra': <CirclePlus className="text-sky-500" />,
  'gpo-order': <ArrowRightLeft className="text-amber-500" />,
  'gpo-enabled': <ArrowRightLeft className="text-amber-500" />,
  protect: <Lock className="text-amber-500" />,
  'block-inheritance': <Ban className="text-amber-500" />,
}

function CompareSheet({
  item,
  data,
  onOpenChange,
  onEdit,
  onShowAd,
}: {
  item: OuComparison | null
  data: AdCompare
  onOpenChange: (o: boolean) => void
  onEdit?: (index: number) => void
  onShowAd: (dn: string) => void
}) {
  const canEdit = useCan('Editor')
  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" aria-describedby={undefined}>
        {item && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>{item.isRoot ? 'Domänenstamm' : item.name}</SheetTitle>
                <CompareBadge status={item.status} />
              </div>
              <SheetDescription className="break-all">{adPath(item.dn, data.domain?.distinguishedName)}</SheetDescription>
            </SheetHeader>
            <SheetBody className="grid content-start gap-5">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-[11px] text-muted-foreground uppercase">Berechtigungen</p>
                  <p className="text-[13px]">Soll {item.desiredAces} · Ist {item.actualAces}</p>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-[11px] text-muted-foreground uppercase">GPO-Verknüpfungen</p>
                  <p className="text-[13px]">Soll {item.desiredLinks} · Ist {item.actualLinks}</p>
                </div>
              </div>
              <section className="grid gap-2">
                <h3 className="text-[13px] font-semibold">Unterschiede</h3>
                {item.differences.length === 0 ? (
                  <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><CircleCheck className="size-4 text-emerald-500" /> Soll und Ist stimmen überein.</p>
                ) : (
                  <ul className="grid gap-2">
                    {item.differences.map((d, i) => (
                      <li key={i} className="flex gap-2.5 rounded-lg border px-3 py-2 text-[13px] [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
                        {kindIcon[d.kind] ?? <TriangleAlert className="text-amber-500" />}
                        <span className="min-w-0 break-words">{d.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </SheetBody>
            <SheetFooter className="flex-wrap">
              {item.inAd && (
                <Button variant="outline" size="sm" onClick={() => onShowAd(item.dn)}>
                  <Network /> Im AD anzeigen
                </Button>
              )}
              {item.configIndex !== null && onEdit && (
                <Button variant="outline" size="sm" onClick={() => onEdit(item.configIndex!)}>
                  <Pencil /> {canEdit ? 'Im Soll bearbeiten' : 'Im Soll anzeigen'}
                </Button>
              )}
              {item.status === 'extra' && canEdit && (
                <Button
                  size="sm"
                  onClick={() => {
                    const n = adoptOus([item], data.result?.items ?? [])
                    if (n) toast.success(n === 1 ? 'OU in den Entwurf übernommen' : `${n} OUs in den Entwurf übernommen`, { description: 'Zum Übernehmen speichern.' })
                    else toast('Die OU ist bereits im Entwurf.')
                  }}
                >
                  <Download /> In Konfiguration übernehmen
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

type CompareFilter = 'all' | CompareStatus

export function AdCompareView({ onEdit }: { onEdit?: (index: number) => void }) {
  const compare = useAdCompare()
  const { refresh, busy } = useAdRefresh()
  const [filter, setFilter] = React.useState<CompareFilter>('all')
  const [selected, setSelected] = React.useState<OuComparison | null>(null)
  const [adDn, setAdDn] = React.useState<string | null>(null)
  const [layout, setLayout] = useLocalStorage<'tree' | 'list'>('tm.adCompare.layout', 'tree')
  if (compare.isLoading) return <Loading />
  if (compare.isError || !compare.data?.available || !compare.data.result) return <Unavailable message={compare.data?.message ?? null} />
  const d = compare.data
  const result = d.result!
  const items = result.items.filter((i) => !i.isRoot)
  const root = result.items.find((i) => i.isRoot)
  const s = result.summary
  const visible = filter === 'all' ? items : items.filter((i) => i.status === filter)
  const visibleDns = new Set(visible.map((v) => v.dn.toLowerCase()))
  // In the tree, keep the ancestors of visible entries so the hierarchy stays readable.
  const byDn = new Map(items.map((i) => [i.dn.toLowerCase(), i]))
  const treeItems = items.filter((i) => {
    if (visibleDns.has(i.dn.toLowerCase())) return true
    return visible.some((v) => v.dn.toLowerCase().endsWith(',' + i.dn.toLowerCase()))
  })

  return (
    <>
      <SourceHeader data={d} refresh={refresh} busy={busy} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<CompareFilter>
          aria-label="Vergleich filtern"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'all', label: `Alle · ${items.length}` },
            { value: 'missing', label: `fehlt im AD · ${s.missing}`, icon: <CircleMinus className="text-rose-500" /> },
            { value: 'extra', label: `nur im AD · ${s.extra}`, icon: <CirclePlus className="text-sky-500" /> },
            { value: 'different', label: `abweichend · ${s.different - (root?.status === 'different' ? 1 : 0)}`, icon: <TriangleAlert className="text-amber-500" /> },
            { value: 'same', label: `gleich · ${s.same - (root?.status === 'same' ? 1 : 0)}`, icon: <CircleCheck className="text-emerald-500" /> },
          ]}
          className="[&_button]:h-7 [&_button]:px-2.5 [&_button]:text-xs"
        />
        <Segmented<'tree' | 'list'>
          aria-label="Darstellung"
          value={layout}
          onValueChange={setLayout}
          options={[
            { value: 'tree', label: 'Baum', icon: <Network /> },
            { value: 'list', label: 'Liste', icon: <ListChecks /> },
          ]}
          className="ml-auto [&_button]:h-7 [&_button]:px-2.5 [&_button]:text-xs"
        />
      </div>
      {root && root.status !== 'same' && (
        <button
          type="button"
          onClick={() => setSelected(root)}
          className="mb-3 flex w-full items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-left text-[13px] text-amber-900 hover:bg-amber-500/15 dark:text-amber-200"
        >
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">Am Domänenstamm gibt es {root.differences.length} Abweichung{root.differences.length === 1 ? '' : 'en'}.</span>
          <ChevronRight className="size-4" />
        </button>
      )}
      <Card className="p-4">
        {visible.length === 0 ? (
          <EmptyState compact icon={<GitCompareArrows />} title="Keine Einträge" description="Für diesen Filter gibt es keine OUs." />
        ) : layout === 'tree' ? (
          <LiveTree
            key={filter}
            label="Vergleich Soll und Ist"
            nodes={treeItems.map((i) => ({ ...i, parentDn: i.parentDn && byDn.has(i.parentDn.toLowerCase()) ? i.parentDn : null }))}
            rootLabel={d.domain?.distinguishedName ?? ''}
            defaultDepth={filter === 'all' ? 2 : 10}
            onSelect={(n) => setSelected(n)}
            renderExtra={(n) => (
              <span className={cn('flex shrink-0 items-center gap-1.5', !visibleDns.has(n.dn.toLowerCase()) && 'opacity-40')}>
                {n.differences.length > 0 && n.status === 'different' && <span className="text-[11px] text-muted-foreground">{n.differences.length}</span>}
                {n.builtin ? <Badge variant="muted">integriert</Badge> : <CompareBadge status={n.status} />}
              </span>
            )}
          />
        ) : (
          <ul className="divide-y">
            {visible.map((i) => (
              <li key={i.dn}>
                <button type="button" onClick={() => setSelected(i)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2.5 text-left hover:bg-accent/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{i.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{adPath(i.dn, d.domain?.distinguishedName)}</span>
                    {i.status === 'different' && <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{i.differences[0]?.text}</span>}
                  </span>
                  <CompareBadge status={i.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <CompareSheet
        item={selected}
        data={d}
        onOpenChange={(o) => !o && setSelected(null)}
        onEdit={onEdit ? (index) => { setSelected(null); onEdit(index) } : undefined}
        onShowAd={(dn) => setAdDn(dn)}
      />
      <AdObjectSheet dn={adDn} domainDn={d.domain?.distinguishedName} onOpenChange={(o) => !o && setAdDn(null)} onNavigate={setAdDn} />
    </>
  )
}

// ---------------------------------------------------------------- OU section with the switch

type View = 'soll' | 'ist' | 'vergleich'

/** The OU section of the configuration page: desired state (editor), live AD tree or comparison. */
export function OusSection(props: EditorProps) {
  const [params, setParams] = useSearchParams()
  const param = params.get('ansicht')
  const view: View = param === 'ist' || param === 'vergleich' ? param : 'soll'
  const setView = (v: View) => {
    const p = new URLSearchParams(params)
    if (v === 'soll') p.delete('ansicht')
    else p.set('ansicht', v)
    setParams(p, { replace: true })
  }
  const edit = (index: number) => {
    const p = new URLSearchParams(params)
    p.delete('ansicht')
    p.set('edit', String(index))
    setParams(p, { replace: true })
  }
  return (
    <div className="grid gap-3">
      <Segmented<View>
        aria-label="Soll, Ist oder Vergleich"
        value={view}
        onValueChange={setView}
        options={[
          { value: 'soll', label: 'Soll', icon: <Pencil /> },
          { value: 'ist', label: 'Ist', icon: <Network /> },
          { value: 'vergleich', label: 'Vergleich', icon: <GitCompareArrows /> },
        ]}
        className="justify-self-start"
      />
      {view === 'soll' && <OusEditor {...props} />}
      {view === 'ist' && <AdTreeView />}
      {view === 'vergleich' && <AdCompareView onEdit={edit} />}
    </div>
  )
}
