import * as React from 'react'
import { ChevronRight, Folder, FolderOpen, Lock, ShieldOff, Ban, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { buildOuTree, type OuItem, type OuTreeNode } from '@/lib/ou'
import { tierMeta, tierOf } from '@/lib/tier'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { TierBadge } from './badges'
import { t } from '@/i18n'

/** Interactive OU tree (keyboard accessible, tier colored). */
export function OuTree({
  ous,
  onSelect,
  selectedIndex,
  renderActions,
  className,
  defaultExpandedDepth = 1,
  toolbar = true,
}: {
  ous: OuItem[]
  onSelect?: (index: number) => void
  selectedIndex?: number | null
  renderActions?: (node: OuTreeNode) => React.ReactNode
  className?: string
  defaultExpandedDepth?: number
  toolbar?: boolean
}) {
  const { roots, orphans } = React.useMemo(() => buildOuTree(ous), [ous])
  const all = React.useMemo(() => {
    const out: { dn: string; depth: number }[] = []
    const walk = (ns: OuTreeNode[], d: number) => ns.forEach((n) => { out.push({ dn: n.dn, depth: d }); walk(n.children, d + 1) })
    walk(roots, 0)
    return out
  }, [roots])
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(all.filter((n) => n.depth < defaultExpandedDepth).map((n) => n.dn)),
  )
  const toggle = (dn: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(dn)) n.delete(dn)
      else n.add(dn)
      return n
    })

  return (
    <div className={className}>
      {toolbar && (
        <div className="mb-2 flex items-center justify-end gap-1">
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setExpanded(new Set(all.map((a) => a.dn)))}>
            <ChevronsUpDown /> {t('shared.ouTree.expandAll')}
          </Button>
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setExpanded(new Set())}>
            <ChevronsDownUp /> {t('shared.ouTree.collapseAll')}
          </Button>
        </div>
      )}
      <div role="tree" aria-label={t('shared.ouTree.ouStructure')} className="text-sm">
        <div className="mb-1 flex items-center gap-2 px-2 py-1 font-mono text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-muted-foreground/50" />
          {'{{DOMAIN_DN}}'}
        </div>
        {roots.map((n) => (
          <TreeNode key={n.dn} node={n} depth={0} expanded={expanded} toggle={toggle} onSelect={onSelect} selectedIndex={selectedIndex} renderActions={renderActions} />
        ))}
        {orphans.length > 0 && (
          <div className="mt-3 rounded-md border border-dashed border-amber-500/40 p-2">
            <p className="mb-1 px-1 text-xs font-medium text-amber-700 dark:text-amber-300">{t('shared.ouTree.withoutAValidParentOu')}</p>
            {orphans.map((n) => (
              <TreeNode key={n.dn} node={n} depth={0} expanded={expanded} toggle={toggle} onSelect={onSelect} selectedIndex={selectedIndex} renderActions={renderActions} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TreeNode({
  node,
  depth,
  expanded,
  toggle,
  onSelect,
  selectedIndex,
  renderActions,
}: {
  node: OuTreeNode
  depth: number
  expanded: Set<string>
  toggle: (dn: string) => void
  onSelect?: (i: number) => void
  selectedIndex?: number | null
  renderActions?: (node: OuTreeNode) => React.ReactNode
}) {
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.dn)
  const tier = tierOf(node.dn)
  const selected = selectedIndex === node.index
  const Icon = hasChildren && isOpen ? FolderOpen : Folder

  return (
    <div role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={selected}>
      <div
        className={cn(
          'group relative flex h-8 items-center gap-1.5 rounded-md pr-2 transition-colors hover:bg-accent/70',
          selected && 'bg-primary/10 hover:bg-primary/10',
        )}
        style={{ paddingLeft: depth * 18 + 4 }}
      >
        {depth > 0 && (
          <span aria-hidden className="absolute top-0 bottom-0 border-l border-border" style={{ left: (depth - 1) * 18 + 14 }} />
        )}
        <button
          type="button"
          tabIndex={hasChildren ? 0 : -1}
          onClick={() => hasChildren && toggle(node.dn)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' && hasChildren && !isOpen) toggle(node.dn)
            if (e.key === 'ArrowLeft' && hasChildren && isOpen) toggle(node.dn)
          }}
          className={cn('grid size-5 shrink-0 place-content-center rounded text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', !hasChildren && 'invisible')}
          aria-label={isOpen ? t('shared.ouTree.collapseName', { name: node.ou.name }) : t('shared.ouTree.expandName', { name: node.ou.name })}
        >
          <ChevronRight className={cn('size-3.5 transition-transform duration-150', isOpen && 'rotate-90')} />
        </button>
        <Icon className={cn('size-4 shrink-0', tier !== null ? tierMeta[tier].text : 'text-muted-foreground')} />
        <button
          type="button"
          onClick={() => (onSelect ? onSelect(node.index) : hasChildren && toggle(node.dn))}
          className="min-w-0 flex-1 truncate rounded text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={node.dn}
        >
          {node.ou.name}
          {hasChildren && !isOpen && <span className="ml-1.5 text-xs text-muted-foreground">({node.children.length})</span>}
        </button>
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {node.ou.protectFromAccidentalDeletion && (
            <Tooltip content={t('shared.ouTree.protectedFromAccidentalDeletion')}><Lock className="size-3 opacity-60" /></Tooltip>
          )}
          {node.ou.blockGpoInheritance && (
            <Tooltip content={t('shared.ouTree.gpoInheritanceBlocked')}><Ban className="size-3 opacity-60" /></Tooltip>
          )}
          {node.ou.disableInheritance && (
            <Tooltip content={t('shared.ouTree.aclInheritanceDisabled')}><ShieldOff className="size-3 opacity-60" /></Tooltip>
          )}
        </span>
        <TierBadge tier={tier} short className="hidden sm:inline-flex" />
        {renderActions && <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{renderActions(node)}</span>}
      </div>
      {hasChildren && isOpen && (
        <div role="group">
          {node.children.map((c) => (
            <TreeNode key={c.dn} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} onSelect={onSelect} selectedIndex={selectedIndex} renderActions={renderActions} />
          ))}
        </div>
      )}
    </div>
  )
}
