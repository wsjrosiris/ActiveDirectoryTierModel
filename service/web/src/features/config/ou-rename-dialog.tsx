import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { planOuRename, ouFullDn, ouParentOptions, type OuItem } from '@/lib/ou'
import { Combobox } from '@/components/ui/combobox'
import { sectionFallbackTitles } from '@/lib/labels'
import { errorMessage } from '@/lib/query'
import { ApiError } from '@/api/client'
import { draftStore } from './draft-store'
import { sectionQuery } from './queries'

const AFFECTED = ['ous', 'groups', 'users', 'acls', 'msa', 'gmsa', 'dmsa', 'winlaps', 'gpos']

export function OuRenameDialog({
  open,
  onOpenChange,
  index,
  onApplied,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  index: number
  onApplied?: (newName: string, newPath: string) => void
}) {
  const qc = useQueryClient()
  const [contents, setContents] = React.useState<Record<string, unknown> | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [deferred, setDeferred] = React.useState('')
  const [parent, setParent] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setContents(null)
    setLoadError(null)
    Promise.all(
      AFFECTED.map(async (k) => {
        try {
          await qc.ensureQueryData(sectionQuery(k))
          return [k, draftStore.current(k)] as const
        } catch (e) {
          // A section that does not exist has nothing to update; any other failure must stop the rename.
          if (e instanceof ApiError && e.status === 404) return [k, undefined] as const
          throw new Error(`„${sectionFallbackTitles[k] ?? k}“ konnte nicht geladen werden: ${errorMessage(e)}`)
        }
      }),
    )
      .then((entries) => {
        if (cancelled) return
        const c = Object.fromEntries(entries.filter(([, v]) => v !== undefined))
        setContents(c)
        const ou = (c.ous as { organizationUnits: OuItem[] } | undefined)?.organizationUnits?.[index]
        setName(ou?.name ?? '')
        setDeferred(ou?.name ?? '')
        setParent(ou?.path ?? '')
      })
      .catch((e) => !cancelled && setLoadError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [open, index, qc])

  React.useEffect(() => {
    const tt = setTimeout(() => setDeferred(name), 150)
    return () => clearTimeout(tt)
  }, [name])

  const ous = ((contents?.ous as { organizationUnits?: OuItem[] } | undefined)?.organizationUnits ?? []) as OuItem[]
  const ou = ous[index]
  const trimmed = deferred.trim()
  const invalid = !trimmed ? 'Name ist erforderlich.' : /[,=+<>#;\\"]/.test(trimmed) ? 'Unzulässige Zeichen.' : null
  const parentOptions = React.useMemo(() => (ou ? ouParentOptions(ous, ouFullDn(ou)) : []), [ous, ou])
  const duplicate =
    ou && trimmed && ous.some((o, i) => i !== index && ouFullDn(o).toLowerCase() === ouFullDn({ ...ou, name: trimmed, path: parent }).toLowerCase())
  const plan = React.useMemo(() => {
    if (!contents || !ou || invalid || !parent || (trimmed === ou.name && parent === ou.path)) return null
    return planOuRename(contents as Record<string, unknown>, index, trimmed, parent)
  }, [contents, ou, index, trimmed, parent, invalid])

  const bySection = React.useMemo(() => {
    const m = new Map<string, number>()
    plan?.changes.forEach((c) => m.set(c.section, (m.get(c.section) ?? 0) + 1))
    return [...m.entries()]
  }, [plan])
  const refCount = (plan?.changes.length ?? 1) - 1

  const apply = () => {
    if (!ou) return
    // Rebuild from the current store state and the typed (not debounced) name, so neither a
    // background refresh since opening nor the preview's debounce can lose changes.
    const newName = name.trim()
    const current = Object.fromEntries(
      Object.keys(contents ?? {}).map((k) => [k, draftStore.current(k)] as const).filter(([, v]) => v !== undefined),
    )
    const currentOu = (current.ous as { organizationUnits?: OuItem[] } | undefined)?.organizationUnits?.[index]
    if (!currentOu || currentOu.name !== ou.name || currentOu.path !== ou.path) {
      toast.error('Die OU wurde zwischenzeitlich geändert', { description: 'Bitte den Dialog erneut öffnen.' })
      onOpenChange(false)
      return
    }
    const finalPlan = planOuRename(current, index, newName, parent)
    if (finalPlan.conflicts.length) {
      toast.error('Umbenennen nicht möglich', { description: finalPlan.conflicts.join(' ') })
      return
    }
    draftStore.apply(finalPlan.updated)
    const refs = finalPlan.changes.length - 1
    const sections = new Set(finalPlan.changes.map((c) => c.section)).size
    toast.success(newName !== ou.name ? `OU umbenannt: „${ou.name}“ → „${newName}“` : `OU verschoben: „${ou.name}“`, {
      description: `${refs} Referenz${refs === 1 ? '' : 'en'} in ${sections} Sektion${sections === 1 ? '' : 'en'} aktualisiert – noch nicht gespeichert.`,
    })
    onApplied?.(newName, parent)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>OU umbenennen oder verschieben</DialogTitle>
          <DialogDescription>
            Alle Referenzen (untergeordnete OUs, Gruppen, Benutzer, ACL-/MSA-/LAPS-Delegationen, GPO-Verknüpfungen) werden automatisch angepasst.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : !contents ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Referenzen werden ermittelt …</div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (plan && !duplicate && !plan.conflicts.length && name.trim() === trimmed) apply()
            }}
          >
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <Field label="Aktueller Name">
                <Input value={ou?.name ?? ''} readOnly />
              </Field>
              <ArrowRight className="mb-2.5 hidden size-4 text-muted-foreground sm:block" />
              <Field label="Neuer Name" htmlFor="rename-new" error={name.trim() !== ou?.name ? (invalid ?? (duplicate ? 'Eine OU mit diesem Namen existiert bereits.' : undefined)) : undefined}>
                <Input id="rename-new" autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
              </Field>
            </div>
            <Field label="Übergeordnete OU" htmlFor="rename-parent" hint="Zum Verschieben eine andere übergeordnete OU wählen.">
              <Combobox id="rename-parent" mono value={parent} onChange={setParent} options={parentOptions} placeholder="Übergeordnete OU wählen" />
            </Field>
            {plan && plan.conflicts.length > 0 && (
              <p className="text-sm text-destructive" role="alert">{plan.conflicts.join(' ')}</p>
            )}
            {plan && !duplicate && !plan.conflicts.length && (
              <div className="rounded-lg border">
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 text-[13px]">
                  <span className="font-medium">Vorschau:</span>
                  <span className="text-muted-foreground">{refCount} Referenz{refCount === 1 ? '' : 'en'} ändern sich</span>
                  <span className="ml-auto flex flex-wrap gap-1">
                    {bySection.map(([s, n]) => (
                      <Badge key={s} variant="secondary">{sectionFallbackTitles[s] ?? s}: {n}</Badge>
                    ))}
                  </span>
                </div>
                <ul className="max-h-64 divide-y overflow-y-auto text-[12px]">
                  {plan.changes.map((c, i) => (
                    <li key={i} className="grid gap-0.5 px-3 py-1.5">
                      <span className="text-muted-foreground">
                        <span className="font-medium text-foreground">{sectionFallbackTitles[c.section] ?? c.section}</span> · {c.label} · <span className="font-mono">{c.field}</span>
                      </span>
                      <span className="font-mono break-all text-rose-700 line-through decoration-rose-400/60 dark:text-rose-300">{c.before}</span>
                      <span className="font-mono break-all text-emerald-700 dark:text-emerald-300">{c.after}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
              <Button type="submit" disabled={!plan || !!duplicate || plan.conflicts.length > 0 || name.trim() !== trimmed}>
                Übernehmen{plan ? ` (${refCount} Referenzen)` : ''}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
