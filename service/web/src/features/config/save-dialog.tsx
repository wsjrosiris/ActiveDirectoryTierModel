import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Save } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/api/client'
import type { Section } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { errorMessage } from '@/lib/query'
import { sectionFallbackTitles } from '@/lib/labels'
import { diffSection, type SectionDiff } from '@/lib/structured-diff'
import { ChangeList, DiffCounts } from './change-list'
import { draftStore } from './draft-store'
import { sectionQuery } from './queries'
import { t } from '@/i18n'

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
    const out: Record<string, SectionDiff> = {}
    for (const k of keys) out[k] = diffSection(k, s.bases[k]?.content ?? null, s.drafts[k])
    return out
  }, [open, keys])

  const save = async () => {
    const invalid = draftStore.invalidJsonKeys()
    if (invalid.length) {
      toast.error(t('config.saveDialog.invalidInput'), {
        description: t('config.saveDialog.joinContainsInvalidInputPlease', { join: invalid.map((k) => sectionFallbackTitles[k] ?? k).join(t('config.saveDialog.quoteSeparator')) }),
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
          toast.error(t('config.saveDialog.sessionExpired'), {
            description: t('config.saveDialog.yourChangesAreStillThere'),
            duration: 15000,
          })
        } else {
          toast.error(t('config.saveDialog.savingValueFailed', { value: sectionFallbackTitles[key] ?? key }), { description: errorMessage(e) })
        }
        if (done.length) toast.success(t('config.saveDialog.lengthSectionSSaved', { length: done.length }))
        return
      }
    }
    setSaving(false)
    toast.success(keys.length === 1 ? t('config.saveDialog.changesSaved') : t('config.saveDialog.lengthSectionsSaved', { length: keys.length, count: keys.length }), {
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
    toast(t('config.saveDialog.latestVersionLoaded'), { description: t('config.saveDialog.yourChangesToThisSection') })
  }

  const keepEditing = async (key: string) => {
    try {
      // Rebase the draft onto the latest server version on purpose; the next save diff
      // shows the other user's changes that this save would revert.
      await qc.fetchQuery({ ...sectionQuery(key), staleTime: 0 })
      draftStore.rebase(key)
    } catch (e) {
      toast.error(t('config.saveDialog.latestVersionCouldNotBe'), { description: errorMessage(e) })
    }
    setConflict(null)
    onOpenChange(false)
    toast(t('config.saveDialog.draftUpdatedToTheLatest'), {
      description: t('config.saveDialog.yourChangesAreKeptThe'),
    })
  }

  const d = diffs[active]

  return (
    <>
      <Dialog open={open && !conflict} onOpenChange={(o) => !saving && onOpenChange(o)}>
        <DialogContent className="max-w-4xl gap-5">
          <DialogHeader>
            <DialogTitle>{t('config.saveDialog.saveChanges')}</DialogTitle>
            <DialogDescription>
              {t('config.saveDialog.reviewTheChangesEverySaved')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {keys.length > 1 ? (
              <Tabs value={active} onValueChange={setActive}>
                <TabsList className="h-auto flex-wrap">
                  {keys.map((k) => (
                    <TabsTrigger key={k} value={k} className="gap-2">
                      {sectionFallbackTitles[k] ?? k}
                      {diffs[k] && <DiffCounts diff={diffs[k]} />}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium">{sectionFallbackTitles[active] ?? active}</span>
                {d && <DiffCounts diff={d} />}
              </div>
            )}
          </div>
          {d && <ChangeList key={active} diff={d} maxHeight="45vh" />}
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (comment.trim()) save()
            }}
          >
            <Field label={t('config.saveDialog.comment')} htmlFor="save-comment" required hint={t('config.saveDialog.shownInTheVersionHistory')}>
              <Textarea
                id="save-comment"
                autoFocus
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('config.saveDialog.whatWasChangedAndWhy')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && comment.trim()) {
                    e.preventDefault()
                    save()
                  }
                }}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={!comment.trim()} loading={saving}>
                {!saving && <Save />} {keys.length > 1 ? t('config.saveDialog.saveLengthSections', { length: keys.length, count: keys.length }) : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent className="max-w-lg" hideClose>
          {conflict && (
            <>
              <DialogHeader className="pr-0">
                <div className="flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-content-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-4" />
                  </div>
                  <div className="grid min-w-0 gap-1.5">
                    <DialogTitle>{t('config.saveDialog.conflictWhileSaving')}</DialogTitle>
                    <DialogDescription>
                      {t('config.saveDialog.conflictText', { section: sectionFallbackTitles[conflict.key] ?? conflict.key })}
                      {conflict.remaining.length > 1 && t('config.saveDialog.valueFurtherSectionSHave', { value: conflict.remaining.length - 1 })}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <DialogFooter className="flex-wrap">
                <Button variant="outline" onClick={() => keepEditing(conflict.key)}>
                  {t('config.saveDialog.continueEditing')}
                </Button>
                <Button variant="destructive" onClick={() => reload(conflict.key)}>
                  {t('config.saveDialog.reloadDiscardChanges')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
