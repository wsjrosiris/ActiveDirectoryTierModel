import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, NavLink, useBlocker, useNavigate, useParams } from 'react-router'
import {
  CheckCircle2,
  Download,
  FileQuestion,
  History,
  Import,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { SectionSummary } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Kbd } from '@/components/ui/kbd'
import { Select } from '@/components/ui/select'
import { InlineSkeleton, Skeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Page } from '@/components/shared/page-header'
import { useCan } from '@/features/auth/auth'
import { useHotkey } from '@/hooks/use-hotkey'
import { sectionFallbackTitles, sectionGroups } from '@/lib/labels'
import { cn, downloadUrl, formatDateTime, formatNumber, formatRelative, modKey } from '@/lib/utils'
import { draftStore, useDirtyKeys, useHistoryAvailability, useSectionContent } from './draft-store'
import { sectionQuery, sectionsQuery } from './queries'
import { AclsEditor, GroupsEditor, UsersEditor, WinLapsEditor, type EditorProps } from './editors'
import { AdmxEditor } from './admx-editor'
import { OusSection } from './ad-view'
import { AuthSilosEditor } from './authsilo-editor'
import { DependenciesEditor } from './dependencies-editor'
import { GuidMappingsEditor } from './guid-editor'
import { GposEditor } from './gpo-editor'
import { ObjectFormEditor } from './object-form'
import { SaveDialog } from './save-dialog'
import { VersionsSheet } from './versions-sheet'
import { WizardMenu } from './wizards'
import { t } from '@/i18n'

const FORM_EDITORS: Record<string, React.ComponentType<EditorProps>> = {
  ous: OusSection,
  groups: GroupsEditor,
  users: UsersEditor,
  acls: AclsEditor,
  msa: AclsEditor,
  gmsa: AclsEditor,
  dmsa: AclsEditor,
  winlaps: WinLapsEditor,
  admx: AdmxEditor,
  'guid-mappings': GuidMappingsEditor,
  dependencies: DependenciesEditor,
  metadata: ObjectFormEditor,
  gpos: GposEditor,
  authsilos: AuthSilosEditor,
}

/** Editor for a section: a dedicated form, the ADML form for every language, else the generic structured form. */
function editorFor(key: string): React.ComponentType<EditorProps> {
  if (FORM_EDITORS[key]) return FORM_EDITORS[key]
  if (key.startsWith('adml-')) return AdmxEditor
  return ObjectFormEditor
}

export function Component() {
  const { key = 'ous' } = useParams()
  const canEdit = useCan('Editor')
  const navigate = useNavigate()
  const confirm = useConfirm()
  const sections = useQuery(sectionsQuery)
  const section = useQuery(sectionQuery(key))
  const content = useSectionContent(key)
  const dirtyKeys = useDirtyKeys()
  const { canUndo, canRedo } = useHistoryAvailability()
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [versionsOpen, setVersionsOpen] = React.useState(false)

  const summary = sections.data?.find((s) => s.key === key)
  const title = summary?.title || section.data?.title || sectionFallbackTitles[key] || key
  const isDirty = dirtyKeys.includes(key)
  const FormEditor = editorFor(key)

  // ---- keyboard shortcuts (history is off while a sheet/dialog is open: it edits a snapshot of an item)
  const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
  useHotkey('mod+z', () => canEdit && !dialogOpen() && draftStore.undo() && toast(t('config.config.undone'), { duration: 1200 }))
  useHotkey(['mod+shift+z', 'mod+y'], () => canEdit && !dialogOpen() && draftStore.redo() && toast(t('config.config.restored'), { duration: 1200 }))
  useHotkey('mod+s', () => canEdit && dirtyKeys.length > 0 && setSaveOpen(true), { allowInInputs: true })

  // ---- leave-page guard
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyKeys.length > 0 && currentLocation.pathname !== nextLocation.pathname && !nextLocation.pathname.startsWith('/konfiguration'),
  )
  React.useEffect(() => {
    if (blocker.state !== 'blocked') return
    confirm({
      title: t('config.config.discardUnsavedChanges'),
      description: t('config.config.leaveDescription', { count: dirtyKeys.length }),
      confirmText: t('config.config.leavePage'),
      cancelText: t('config.config.stayHere'),
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state])
  React.useEffect(() => {
    if (!dirtyKeys.length) return
    const on = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', on)
    return () => window.removeEventListener('beforeunload', on)
  }, [dirtyKeys.length])

  const setContent = React.useCallback((next: unknown, tag?: string) => draftStore.apply({ [key]: next }, { tag }), [key])

  const discard = async () => {
    const ok = await confirm({
      title: t('config.config.discardChangesToTitle', { title }),
      description: t('config.config.theDraftIsResetTo'),
      confirmText: t('config.config.discard'),
      destructive: true,
    })
    if (ok) draftStore.discard(key)
  }

  const allSections: SectionSummary[] = sections.data ?? []
  const known = new Set(sectionGroups.flatMap((g) => g.keys))
  const groups = [
    ...sectionGroups.map((g) => ({ title: g.title, items: g.keys.map((k) => allSections.find((s) => s.key === k)).filter(Boolean) as SectionSummary[] })),
    { title: t('config.config.more'), items: allSections.filter((s) => !known.has(s.key)) },
  ].filter((g) => g.items.length)

  return (
    <Page wide className="pb-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('config.config.configuration')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('config.config.desiredStateOfTheTier')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <div className="flex items-center rounded-md border bg-card shadow-xs">
              <Tooltip content={t('config.config.undoModkeyZ', { modKey })}>
                <Button variant="ghost" size="icon-sm" className="rounded-r-none" disabled={!canUndo} onClick={() => draftStore.undo()} aria-label={t('config.config.undo')}>
                  <Undo2 />
                </Button>
              </Tooltip>
              <div className="h-5 w-px bg-border" />
              <Tooltip content={t('config.config.redoModkeyShiftZ', { modKey })}>
                <Button variant="ghost" size="icon-sm" className="rounded-l-none" disabled={!canRedo} onClick={() => draftStore.redo()} aria-label={t('config.config.redo')}>
                  <Redo2 />
                </Button>
              </Tooltip>
            </div>
          )}
          <WizardMenu />
          <Button variant="outline" size="sm" asChild>
            <Link to="/konfiguration/validierung"><CheckCircle2 /> {t('config.config.validation')}</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadUrl(api.config.exportUrl)}>
            <Download /> {t('config.config.export')}
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/konfiguration/import"><Import /> {t('config.config.import')}</Link>
            </Button>
          )}
          {canEdit && (
            <Button size="sm" disabled={!dirtyKeys.length} onClick={() => setSaveOpen(true)}>
              <Save /> {t('common.save')}
              {dirtyKeys.length > 1 && <Badge className="ml-0.5 bg-white/20 text-current">{dirtyKeys.length}</Badge>}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[232px_minmax(0,1fr)]">
        {/* Sub navigation */}
        <nav aria-label={t('config.config.configurationSections')} className="xl:sticky xl:top-20 xl:self-start">
          <div className="xl:hidden">
            <Select
              aria-label={t('config.config.selectSection')}
              value={key}
              onValueChange={(k) => navigate(`/konfiguration/${k}`)}
              options={allSections.map((s) => ({ value: s.key, label: `${s.title || sectionFallbackTitles[s.key] || s.key}${dirtyKeys.includes(s.key) ? ' •' : ''}` }))}
            />
          </div>
          <div className="hidden xl:block">
            {sections.isLoading ? (
              <div className="grid gap-1.5">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
            ) : (
              groups.map((g) => (
                <div key={g.title} className="mb-4">
                  <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.title}</p>
                  <ul className="grid gap-0.5">
                    {g.items.map((s) => (
                      <li key={s.key}>
                        <NavLink
                          to={`/konfiguration/${s.key}`}
                          className={({ isActive }) =>
                            cn(
                              'flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                              isActive && 'bg-accent font-medium text-foreground',
                            )
                          }
                        >
                          <span className="truncate">{s.title || sectionFallbackTitles[s.key] || s.key}</span>
                          <span className="ml-auto flex items-center gap-1.5">
                            {dirtyKeys.includes(s.key) && <span className="size-1.5 rounded-full bg-amber-500" aria-label="ungespeichert" />}
                            {s.itemCount !== null && <span className="text-[11px] text-muted-foreground tabular">{formatNumber(s.itemCount)}</span>}
                          </span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </nav>

        {/* Editor */}
        <div className="min-w-0">
          {section.isError ? (
            <Card>
              <EmptyState icon={<FileQuestion />} title={t('config.config.sectionNotFound')} description={t('config.config.theSectionKeyDoesNot', { key })} action={<Button size="sm" variant="outline" asChild><Link to="/konfiguration/ous">{t('config.config.toTheOus')}</Link></Button>} />
            </Card>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
                    {section.data && <Badge variant="outline" className="font-mono">v{section.data.version}</Badge>}
                    {isDirty && <Badge variant="warning">{t('config.config.unsaved')}</Badge>}
                    {!canEdit && <Badge variant="muted"><Eye /> {t('config.config.readOnly')}</Badge>}
                  </div>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {section.data ? (
                      <>
                        <span className="font-mono">{section.data.fileName}</span>
                        {' · '}{t('config.config.lastModified')}{' '}
                        <span title={formatDateTime(section.data.updatedAt)}>{formatRelative(section.data.updatedAt)}</span>
                        {t('config.config.by')}{section.data.updatedBy}
                      </>
                    ) : (
                      <InlineSkeleton className="h-4 w-72" />
                    )}
                  </p>
                  {(summary?.description || section.data?.description) && (
                    <p className="mt-1 max-w-3xl text-[13px] text-muted-foreground">{summary?.description || section.data?.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isDirty && canEdit && (
                    <Button variant="ghost" size="sm" onClick={discard} className="text-muted-foreground">
                      <RotateCcw /> {t('config.config.discard')}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setVersionsOpen(true)}>
                    <History /> {t('config.config.versions')}
                  </Button>
                </div>
              </div>

              {section.isLoading || content === undefined ? (
                <Card className="p-5">
                  <div className="mb-4 flex gap-2"><Skeleton className="h-8 w-64" /><Skeleton className="h-8 w-72" /></div>
                  <div className="grid gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
                </Card>
              ) : (
                <FormEditor key={key} sectionKey={key} content={content} setContent={setContent} readOnly={!canEdit} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating unsaved-changes bar */}
      {canEdit && dirtyKeys.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border bg-popover/95 py-2 pr-2 pl-4 shadow-xl shadow-black/10 backdrop-blur animate-in">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-50" />
              <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
            </span>
            <span className="text-[13px]">
              {t('common.unsavedChanges')}
              <span className="text-muted-foreground"> {t('config.config.in')} {dirtyKeys.map((k) => sectionFallbackTitles[k] ?? k).join(', ')}</span>
            </span>
            <Button size="sm" onClick={() => setSaveOpen(true)}>
              {t('common.save')} <Kbd className="border-white/20 bg-white/15 text-current">{modKey}S</Kbd>
            </Button>
          </div>
        </div>
      )}

      {saveOpen && <SaveDialog open={saveOpen} onOpenChange={setSaveOpen} keys={dirtyKeys} />}
      <VersionsSheet sectionKey={key} title={title} open={versionsOpen} onOpenChange={setVersionsOpen} />
    </Page>
  )
}
