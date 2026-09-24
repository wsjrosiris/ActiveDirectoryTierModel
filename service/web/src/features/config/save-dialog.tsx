import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Columns2, Rows3, Save } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import type { Section } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { errorMessage } from '@/lib/query'
import { sectionFallbackTitles } from '@/lib/labels'
import { computeDiff, DiffStats, DiffView } from './diff-view'
import { draftStore } from './draft-store'
import { sectionQuery } from './queries'

export function useAfterConfigChange() {
  const qc = useQueryClient()
  return React.useCallback(
    (section: Section) => {
      qc.setQueryData(sectionQuery(section.key).queryKey, section)
      qc.invalidateQueries({ queryKey: ['config', 'sections'] })
      qc.invalidateQueries({ queryKey: ['config', 'versions', section.key] })
      qc.invalidateQueries({ queryKey: ['config', 'validate'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['changelog'] })
    },
    [qc],
  )
}

export function SaveDialog({ open, onOpenChange, keys }: { open: boolean; onOpenChange: (o: boolean) => void; keys: string[] }) {
  const [active, setActive] = React.useState(keys[0])
  const [comment, setComment] = React.useState('')
  const [mode, setMode] = React.useState<'unified' | 'split'>('unified')
  const [saving, setSaving] = React.useState(false)
  const [conflict, setConflict] = React.useState<{ key: string; remaining: string[] } | null>(null)
  const after = useAfterConfigChange()
  const qc = useQueryClient()

  React.useEffect(() => {
    if (open) {
      setActive((a) => (keys.includes(a) ? a : keys[0]))
    }
  }, [open, keys])

  const diffs = React.useMemo(() => {
    if (!open) return {}
    const s = draftStore.getState()
    const out: Record<string, { before: string; after: string; added: number; removed: number }> = {}
    for (const k of keys) {
      const before = JSON.stringify(s.bases[k]?.content ?? null, null, 2)
      const aft = JSON.stringify(s.drafts[k], null, 2)
      const { added, removed } = computeDiff(before, aft)
      out[k] = { before, after: aft, added, removed }
    }
    return out
  }, [open, keys])

  const save = async () => {
    const invalid = draftStore.invalidJsonKeys()
    if (invalid.length) {
      toast.error('Ungültiges JSON', {
        description: `„${invalid.map((k) => sectionFallbackTitles[k] ?? k).join('“, „')}“ enthält einen Syntaxfehler. Bitte zuerst korrigieren – sonst würde der letzte gültige Stand gespeichert.`,
      })
      return
    }
    setSaving(true)
    const done: string[] = []
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const s = draftStore.getState()
      try {
        const saved = await api.config.save(key, { content: s.drafts[key], comment: comment.trim(), baseVersion: draftStore.baseVersionOf(key)! })
        draftStore.saved(saved)
        after(saved)
        done.push(key)
      } catch (e) {
        setSaving(false)
        if (e instanceof ApiError && e.status === 409) {
          setConflict({ key, remaining: keys.slice(i) })
        } else if (e instanceof ApiError && e.status === 401) {
          toast.error('Sitzung abgelaufen', {
            description: 'Ihre Änderungen sind noch da. Bitte in einem neuen Tab anmelden und dann hier erneut speichern.',
            duration: 15000,
          })
        } else {
          toast.error(`Speichern von „${sectionFallbackTitles[key] ?? key}“ fehlgeschlagen`, { description: errorMessage(e) })
        }
        if (done.length) toast.success(`${done.length} Sektion(en) gespeichert`)
        return
      }
    }
    setSaving(false)
    toast.success(keys.length === 1 ? 'Änderungen gespeichert' : `${keys.length} Sektionen gespeichert`, {
      description: comment.trim(),
    })
    setComment('')
    onOpenChange(false)
  }

  const reload = async (key: string) => {
    draftStore.discard(key)
    await qc.invalidateQueries({ queryKey: sectionQuery(key).queryKey })
    await qc.refetchQueries({ queryKey: sectionQuery(key).queryKey })
    setConflict(null)
    onOpenChange(false)
    toast('Neueste Version geladen', { description: 'Ihre Änderungen an dieser Sektion wurden verworfen.' })
  }

  const keepEditing = async (key: string) => {
    try {
      // Rebase the draft onto the latest server version on purpose; the next save diff
      // shows the other user's changes that this save would revert.
      await qc.fetchQuery({ ...sectionQuery(key), staleTime: 0 })
      draftStore.rebase(key)
    } catch (e) {
      toast.error('Neueste Version konnte nicht geladen werden', { description: errorMessage(e) })
    }
    setConflict(null)
    onOpenChange(false)
    toast('Entwurf auf neuesten Stand gesetzt', {
      description: 'Ihre Änderungen bleiben erhalten. Der Diff zeigt jetzt auch, welche Änderungen der anderen Person Ihr Speichern zurücknehmen würde.',
    })
  }

  const d = diffs[active]
  const total = Object.values(diffs).reduce((a, x) => ({ added: a.added + x.added, removed: a.removed + x.removed }), { added: 0, removed: 0 })

  return (
    <>
      <Dialog open={open && !conflict} onOpenChange={(o) => !saving && onOpenChange(o)}>
        <DialogContent className="max-w-5xl gap-5">
          <DialogHeader>
            <DialogTitle>Änderungen speichern</DialogTitle>
            <DialogDescription>
              Prüfen Sie die Änderungen. Jede gespeicherte Sektion erhält eine neue Version, die später wiederhergestellt werden kann.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {keys.length > 1 ? (
              <Tabs value={active} onValueChange={setActive}>
                <TabsList className="h-auto flex-wrap">
                  {keys.map((k) => (
                    <TabsTrigger key={k} value={k} className="gap-2">
                      {sectionFallbackTitles[k] ?? k}
                      {diffs[k] && <DiffStats added={diffs[k].added} removed={diffs[k].removed} />}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium">{sectionFallbackTitles[active] ?? active}</span>
                <DiffStats added={total.added} removed={total.removed} />
              </div>
            )}
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
          </div>
          {d && <DiffView key={active + mode} before={d.before} after={d.after} mode={mode} maxHeight="45vh" />}
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (comment.trim()) save()
            }}
          >
            <Field label="Kommentar" htmlFor="save-comment" required hint="Wird in der Versionshistorie und im Änderungsprotokoll angezeigt.">
              <Textarea
                id="save-comment"
                autoFocus
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Was wurde geändert und warum?"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && comment.trim()) {
                    e.preventDefault()
                    save()
                  }
                }}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Abbrechen</Button>
              <Button type="submit" disabled={!comment.trim()} loading={saving}>
                {!saving && <Save />} {keys.length > 1 ? `${keys.length} Sektionen speichern` : 'Speichern'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent className="max-w-md" hideClose>
          {conflict && (
            <>
              <DialogHeader className="pr-0">
                <div className="flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-content-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-4" />
                  </div>
                  <div className="grid gap-1.5">
                    <DialogTitle>Konflikt beim Speichern</DialogTitle>
                    <DialogDescription>
                      „{sectionFallbackTitles[conflict.key] ?? conflict.key}“ wurde inzwischen von jemand anderem geändert. Ihre Version basiert auf einem veralteten Stand. „Neu laden“ verwirft Ihre Änderungen; „Weiter bearbeiten“ behält sie und vergleicht sie künftig mit dem neuesten Stand.
                      {conflict.remaining.length > 1 && ` ${conflict.remaining.length - 1} weitere Sektion(en) wurden noch nicht gespeichert.`}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => keepEditing(conflict.key)}>
                  Weiter bearbeiten
                </Button>
                <Button variant="destructive" onClick={() => reload(conflict.key)}>
                  Neu laden (Änderungen verwerfen)
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
