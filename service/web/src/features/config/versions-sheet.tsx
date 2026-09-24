import * as React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Columns2, History, Loader2, RotateCcw, Rows3 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useCan } from '@/features/auth/auth'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'
import { DiffView } from './diff-view'
import { draftStore, useDraftState } from './draft-store'
import { versionsQuery } from './queries'
import { useAfterConfigChange } from './save-dialog'

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
  const [mode, setMode] = React.useState<'unified' | 'split'>('unified')
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
      toast.success(`Version ${selected} wiederhergestellt`, { description: `Neue Version ${section.version}` })
      setRestoreOpen(false)
      setComment('')
      setSelected(null)
    },
  })

  const dirty = draftStore.isDirty(sectionKey)
  const isCurrent = selected === base?.version

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[min(1200px,95vw)]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><History className="size-4" /> Versionen – {title}</SheetTitle>
          <SheetDescription>Vergleichen Sie frühere Stände mit der aktuell gespeicherten Version (v{base?.version}).</SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[300px_1fr]">
          <div className="min-h-0 overflow-y-auto border-b p-2 md:border-r md:border-b-0">
            {versions.isLoading ? (
              <div className="grid gap-2 p-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : !versions.data?.length ? (
              <EmptyState compact icon={<History />} title="Keine Versionen" />
            ) : (
              <ul className="grid gap-0.5" role="listbox" aria-label="Versionen">
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
                        v{v.version}
                        {v.version === base?.version && <Badge variant="success" className="text-[10px]">aktuell</Badge>}
                        <span className="ml-auto text-xs font-normal text-muted-foreground" title={formatDateTime(v.createdAt)}>{formatRelative(v.createdAt)}</span>
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{v.comment || <em>Kein Kommentar</em>}</span>
                      <span className="text-[11px] text-muted-foreground/80">{v.createdBy}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
            {selected === null ? (
              <EmptyState icon={<History />} title="Version auswählen" description="Wählen Sie links eine Version für den Vergleich." />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm">
                    <span className="font-medium">v{selected}</span>
                    <span className="text-muted-foreground"> → aktuell (v{base?.version})</span>
                  </p>
                  <div className="ml-auto flex items-center gap-2">
                    <Segmented
                      aria-label="Diff-Darstellung"
                      value={mode}
                      onValueChange={setMode}
                      options={[
                        { value: 'unified', label: 'Einheitlich', icon: <Rows3 /> },
                        { value: 'split', label: 'Nebeneinander', icon: <Columns2 /> },
                      ]}
                      className="[&_button]:h-7 [&_button]:text-xs"
                    />
                    {canEdit && !isCurrent && (
                      <Button size="sm" variant="outline" onClick={() => setRestoreOpen(true)}>
                        <RotateCcw /> Wiederherstellen
                      </Button>
                    )}
                  </div>
                </div>
                {version.isLoading || !base ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Lädt …</div>
                ) : version.data ? (
                  <DiffView
                    key={`${selected}-${mode}`}
                    before={JSON.stringify(version.data.content, null, 2)}
                    after={JSON.stringify(base.content, null, 2)}
                    mode={mode}
                    maxHeight="calc(100dvh - 220px)"
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </SheetContent>

      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Version {selected} wiederherstellen?</DialogTitle>
            <DialogDescription>
              Der Stand von v{selected} wird als neue Version gespeichert. Die bisherige Historie bleibt erhalten.
              {dirty && <span className="mt-2 block font-medium text-amber-700 dark:text-amber-400">Ungespeicherte Änderungen an dieser Sektion werden verworfen.</span>}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) restore.mutate() }}>
            <Field label="Kommentar" htmlFor="restore-comment" required>
              <Textarea id="restore-comment" autoFocus rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Grund für die Wiederherstellung" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRestoreOpen(false)}>Abbrechen</Button>
              <Button type="submit" disabled={!comment.trim()} loading={restore.isPending}>Wiederherstellen</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}
