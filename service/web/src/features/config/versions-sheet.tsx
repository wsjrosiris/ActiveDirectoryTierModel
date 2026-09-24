import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { History, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useCan } from '@/features/auth/auth'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { diffSection } from '@/lib/structured-diff'
import { ChangeList } from './change-list'
import { draftStore, useDraftState } from './draft-store'
import { versionsQuery } from './queries'
import { useAfterConfigChange } from './save-dialog'
import { t } from '@/i18n'

export function VersionsSheet({
  sectionKey,
  title,
  open,
  onOpenChange,
}: {
  sectionKey: string
  title: string
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const canEdit = useCan('Editor')
  const versions = useQuery({ ...versionsQuery(sectionKey), enabled: open })
  const base = useDraftState((s) => s.bases[sectionKey])
  const [selected, setSelected] = React.useState<number | null>(null)
  const [restoreOpen, setRestoreOpen] = React.useState(false)
  const [comment, setComment] = React.useState('')
  const after = useAfterConfigChange()

  React.useEffect(() => {
    if (!open) setSelected(null)
  }, [open])
  React.useEffect(() => {
    if (open && selected === null && versions.data && versions.data.length > 1) setSelected(versions.data[1].version)
  }, [open, selected, versions.data])

  const version = useQuery({
    queryKey: ['config', 'version', sectionKey, selected],
    queryFn: () => api.config.version(sectionKey, selected!),
    enabled: open && selected !== null,
    staleTime: Infinity,
  })

  const restore = useMutation({
    mutationFn: () => api.config.restore(sectionKey, selected!, { comment: comment.trim() }),
    onSuccess: (section) => {
      draftStore.saved(section)
      after(section)
      toast.success(t('config.versionsSheet.versionSelectedRestored', { selected }), { description: t('config.versionsSheet.newVersionVersion', { version: section.version }) })
      setRestoreOpen(false)
      setComment('')
      setSelected(null)
    },
  })

  // What changed from the selected version to the current one.
  const diff = React.useMemo(
    () => (version.data && base ? diffSection(sectionKey, version.data.content, base.content) : null),
    [version.data, base, sectionKey],
  )

  const dirty = draftStore.isDirty(sectionKey)
  const isCurrent = selected === base?.version

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[min(1200px,95vw)]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><History className="size-4" /> {t('config.versionsSheet.versions')} {title}</SheetTitle>
          <SheetDescription>{t('config.versionsSheet.compareHint', { version: base?.version })}</SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[300px_1fr]">
          <div className="min-h-0 overflow-y-auto border-b p-2 md:border-r md:border-b-0">
            {versions.isLoading ? (
              <div className="grid gap-2 p-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : !versions.data?.length ? (
              <EmptyState compact icon={<History />} title={t('config.versionsSheet.noVersions')} />
            ) : (
              <ul className="grid gap-0.5" role="listbox" aria-label={t('config.versionsSheet.versions2')}>
                {versions.data.map((v) => (
                  <li key={v.version}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected === v.version}
                      onClick={() => setSelected(v.version)}
                      className={cn(
                        'grid w-full gap-0.5 rounded-md px-3 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                        selected === v.version && 'bg-primary/10 hover:bg-primary/10',
                      )}
                    >
                      <span className="flex items-center gap-2 text-[13px] font-medium">
                        {t('config.versionsSheet.v')}{v.version}
                        {v.version === base?.version && <Badge variant="success" className="text-[10px]">{t('config.versionsSheet.current')}</Badge>}
                        <span className="ml-auto text-xs font-normal text-muted-foreground" title={formatDateTime(v.createdAt)}>{formatRelative(v.createdAt)}</span>
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{v.comment || <em>{t('config.versionsSheet.noComment')}</em>}</span>
                      <span className="text-[11px] text-muted-foreground/80">{v.createdBy}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
            {selected === null ? (
              <EmptyState icon={<History />} title={t('config.versionsSheet.selectAVersion')} description={t('config.versionsSheet.selectAVersionOnThe')} />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm">
                    <span className="font-medium">{t('config.versionsSheet.v')}{selected}</span>
                    <span className="text-muted-foreground"> {t('config.versionsSheet.toCurrent', { version: base?.version })}</span>
                  </p>
                  <div className="ml-auto flex items-center gap-2">
                    {canEdit && !isCurrent && (
                      <Button size="sm" variant="outline" onClick={() => setRestoreOpen(true)}>
                        <RotateCcw /> {t('config.versionsSheet.restore')}
                      </Button>
                    )}
                  </div>
                </div>
                {version.isLoading || !base ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('common.loading')}</div>
                ) : diff ? (
                  <ChangeList key={selected} diff={diff} maxHeight="calc(100dvh - 260px)" />
                ) : null}
              </>
            )}
          </div>
        </div>
      </SheetContent>

      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('config.versionsSheet.restoreTitle', { version: selected })}</DialogTitle>
            <DialogDescription>
              {t('config.versionsSheet.restoreText', { version: selected })}
              {dirty && <span className="mt-2 block font-medium text-amber-700 dark:text-amber-400">{t('config.versionsSheet.unsavedChangesToThisSection')}</span>}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) restore.mutate() }}>
            <Field label={t('config.versionsSheet.comment')} htmlFor="restore-comment" required>
              <Textarea id="restore-comment" autoFocus rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('config.versionsSheet.reasonForTheRestore')} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRestoreOpen(false)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={!comment.trim()} loading={restore.isPending}>{t('config.versionsSheet.restore')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}
