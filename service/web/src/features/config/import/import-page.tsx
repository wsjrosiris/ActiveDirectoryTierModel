import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  FileArchive,
  Import,
  Info,
  Plus,
  RefreshCw,
  Replace,
  Server,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { transferApi, type ImportApplyResult, type ImportIssue, type ImportPreview, type ImportPreviewSection, type ReplacementRule } from '@/api/transfer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Page, PageHeader } from '@/components/shared/page-header'
import { RequireAuth } from '@/features/auth/auth'
import { errorMessage } from '@/lib/query'
import { diffSection, type SectionDiff } from '@/lib/structured-diff'
import { cn, formatDateTime } from '@/lib/utils'
import { ChangeList, DiffCounts } from '../change-list'
import { RemoteInstancePicker } from './remote-instances'

export function Component() {
  return (
    <RequireAuth role="Editor">
      <ImportPage />
    </RequireAuth>
  )
}

type Source = 'file' | 'remote'

const statusMeta: Record<ImportPreviewSection['status'], { label: string; variant: 'warning' | 'info' | 'muted' | 'danger' | 'outline' }> = {
  changed: { label: 'Geändert', variant: 'warning' },
  new: { label: 'Neu', variant: 'info' },
  unchanged: { label: 'Unverändert', variant: 'muted' },
  invalid: { label: 'Ungültig', variant: 'danger' },
  unknown: { label: 'Unbekannt', variant: 'outline' },
}

function ImportPage() {
  const qc = useQueryClient()
  const [source, setSource] = React.useState<Source>('file')
  const [file, setFile] = React.useState<File | null>(null)
  const [instanceId, setInstanceId] = React.useState('')
  const [remoteDomain, setRemoteDomain] = React.useState('')
  const [preview, setPreview] = React.useState<ImportPreview | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [comment, setComment] = React.useState('')
  const [conflict, setConflict] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ImportApplyResult | null>(null)
  const topRef = React.useRef<HTMLDivElement>(null)

  const adopt = React.useCallback((p: ImportPreview) => {
    setPreview(p)
    setSelected(new Set(p.sections.filter((s) => s.status === 'changed' || s.status === 'new').map((s) => s.key)))
    setConflict(null)
  }, [])

  const load = useMutation({
    meta: { silent: true },
    mutationFn: () => (source === 'file' ? transferApi.uploadZip(file!) : transferApi.pullRemote(instanceId, [], remoteDomain)),
    onSuccess: (p) => {
      adopt(p)
      requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    },
    onError: (e) =>
      toast.error(source === 'file' ? 'Datei konnte nicht gelesen werden' : 'Abruf fehlgeschlagen', {
        description: e instanceof ApiError ? e.detail || e.title : errorMessage(e),
        duration: 10000,
      }),
  })

  const apply = useMutation({
    meta: { silent: true },
    mutationFn: () => transferApi.apply(preview!.id, [...selected], comment.trim()),
    onSuccess: (r) => {
      setResult(r)
      setPreview(null)
      setComment('')
      qc.invalidateQueries({ queryKey: ['config'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['changelog'] })
      toast.success(r.applied.length === 1 ? '1 Bereich übernommen' : `${r.applied.length} Bereiche übernommen`)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(e.detail || e.title)
      else if (e instanceof ApiError && e.status === 404) {
        toast.error('Vorschau abgelaufen', { description: 'Bitte die Quelle erneut laden.' })
        setPreview(null)
      } else toast.error('Übernahme fehlgeschlagen', { description: errorMessage(e) })
    },
  })

  const refresh = useMutation({
    meta: { silent: true },
    mutationFn: (rules: ReplacementRule[]) => transferApi.replacements(preview!.id, rules),
    onSuccess: (p) => {
      const keep = selected
      adopt(p)
      // Keep the user's choice where it still applies.
      setSelected(new Set(p.sections.filter((s) => (s.status === 'changed' || s.status === 'new') && (keep.has(s.key) || !preview?.sections.some((o) => o.key === s.key && (o.status === 'changed' || o.status === 'new')))).map((s) => s.key)))
    },
    onError: (e) => toast.error('Vorschau konnte nicht aktualisiert werden', { description: errorMessage(e) }),
  })

  const reset = () => {
    setPreview(null)
    setResult(null)
    setFile(null)
    setConflict(null)
  }

  const step = result ? 3 : !preview ? 1 : selected.size > 0 && comment.trim() ? 3 : 2

  return (
    <Page className="max-w-5xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2 text-muted-foreground">
        <Link to="/konfiguration"><ArrowLeft /> Konfiguration</Link>
      </Button>
      <PageHeader
        icon={<Import />}
        title="Import"
        description="Konfiguration aus einer Export-Datei oder einer anderen TierModel-Instanz übernehmen – etwa von Test nach Produktion."
      />
      <div ref={topRef} className="scroll-mt-20" />
      <Stepper step={step} done={!!result} />

      {result ? (
        <ResultCard result={result} onRestart={reset} />
      ) : !preview ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Quelle wählen</CardTitle>
              <CardDescription>Es wird noch nichts geändert – zuerst folgt eine Vorschau aller Unterschiede.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Segmented
              aria-label="Quelle"
              value={source}
              onValueChange={setSource}
              className="w-full sm:w-auto"
              options={[
                { value: 'file', label: 'Datei hochladen', icon: <Upload /> },
                { value: 'remote', label: 'Andere Instanz', icon: <Server /> },
              ]}
            />
            {source === 'file' ? <DropZone file={file} onFile={setFile} /> : <RemoteInstancePicker value={instanceId} onChange={(id) => { setInstanceId(id); setRemoteDomain('') }} remoteDomain={remoteDomain} onRemoteDomainChange={setRemoteDomain} />}
            <div className="flex justify-end">
              <Button onClick={() => load.mutate()} loading={load.isPending} disabled={source === 'file' ? !file : !instanceId}>
                Vorschau erstellen {!load.isPending && <ArrowRight />}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <PreviewView
          preview={preview}
          selected={selected}
          setSelected={setSelected}
          refreshing={refresh.isPending}
          onReplacements={(rules) => refresh.mutate(rules)}
          onBack={reset}
          comment={comment}
          setComment={setComment}
          conflict={conflict}
          applying={apply.isPending}
          onApply={() => apply.mutate()}
        />
      )}
    </Page>
  )
}

function Stepper({ step, done }: { step: number; done: boolean }) {
  const steps = ['Quelle', 'Vorschau', 'Übernehmen']
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" aria-label="Schritte">
      {steps.map((s, i) => {
        const n = i + 1
        const state = done || n < step ? 'done' : n === step ? 'current' : 'todo'
        return (
          <li key={s} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={cn(
                'grid size-6 place-content-center rounded-full border text-xs font-semibold tabular',
                state === 'done' && 'border-primary bg-primary text-primary-foreground',
                state === 'current' && 'border-primary text-primary',
                state === 'todo' && 'text-muted-foreground',
              )}
            >
              {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : n}
            </span>
            <span className={cn(state === 'todo' ? 'text-muted-foreground' : 'font-medium')}>{s}</span>
            {n < steps.length && <ChevronRight className="size-4 text-muted-foreground" />}
          </li>
        )
      })}
    </ol>
  )
}

function DropZone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const [over, setOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  return (
    <label
      htmlFor="imp-file"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors hover:bg-accent/40',
        over && 'border-primary bg-primary/5',
      )}
    >
      <input
        ref={inputRef}
        id="imp-file"
        type="file"
        accept=".zip,application/zip"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <div className="grid size-11 place-content-center rounded-xl border bg-card text-muted-foreground shadow-sm">
        <FileArchive className="size-5" />
      </div>
      {file ? (
        <>
          <p className="max-w-full truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-muted-foreground">{(file.size / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB · Klicken, um eine andere Datei zu wählen</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">Export-Datei (ZIP) hierher ziehen oder klicken</p>
          <p className="max-w-md text-xs text-muted-foreground">Die Datei aus „Konfiguration → Export“ einer TierModel-Instanz, höchstens 20 MB.</p>
        </>
      )}
    </label>
  )
}

function PreviewView({
  preview,
  selected,
  setSelected,
  refreshing,
  onReplacements,
  onBack,
  comment,
  setComment,
  conflict,
  applying,
  onApply,
}: {
  preview: ImportPreview
  selected: Set<string>
  setSelected: (s: Set<string>) => void
  refreshing: boolean
  onReplacements: (rules: ReplacementRule[]) => void
  onBack: () => void
  comment: string
  setComment: (c: string) => void
  conflict: string | null
  applying: boolean
  onApply: () => void
}) {
  const importable = preview.sections.filter((s) => s.status === 'changed' || s.status === 'new')
  const unchanged = preview.sections.filter((s) => s.status === 'unchanged')
  const invalid = preview.sections.filter((s) => s.status === 'invalid')
  const unknown = preview.sections.filter((s) => s.status === 'unknown')
  const diffs = React.useMemo(() => {
    const out: Record<string, SectionDiff> = {}
    for (const s of importable) out[s.key] = diffSection(s.key, s.current ?? null, s.incoming)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

  const toggle = (key: string, on: boolean) => {
    const n = new Set(selected)
    if (on) n.add(key)
    else n.delete(key)
    setSelected(n)
  }
  const allOn = importable.length > 0 && importable.every((s) => selected.has(s.key))

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {/* Summary */}
      <Card>
        <CardHeader className="flex-wrap">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {preview.sourceKind === 'file' ? <FileArchive className="size-4 text-muted-foreground" /> : <Server className="size-4 text-muted-foreground" />}
              <span className="min-w-0 break-words">{preview.label}</span>
            </CardTitle>
            <CardDescription>Vorschau vom {formatDateTime(preview.createdAt)}</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
            Andere Quelle
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="warning">{importable.filter((s) => s.status === 'changed').length} geändert</Badge>
            {importable.some((s) => s.status === 'new') && <Badge variant="info">{importable.filter((s) => s.status === 'new').length} neu</Badge>}
            <Badge variant="muted">{unchanged.length} unverändert</Badge>
            {invalid.length > 0 && <Badge variant="danger">{invalid.length} ungültig</Badge>}
            {unknown.length > 0 && <Badge variant="outline">{unknown.length} unbekannt</Badge>}
          </div>
          {preview.notices.length > 0 && (
            <ul className="grid gap-1.5">
              {preview.notices.map((n) => (
                <li key={n} className="flex items-start gap-2 rounded-lg border border-sky-500/25 bg-sky-500/8 px-3 py-2 text-[13px] text-sky-900 dark:text-sky-200">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 break-words">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ReplacementsCard preview={preview} busy={refreshing} onApply={onReplacements} />

      {/* Sections */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <h2 className="text-base font-semibold tracking-tight">Änderungen je Bereich</h2>
        {importable.length > 1 && (
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={allOn ? true : selected.size ? 'indeterminate' : false} onCheckedChange={(c) => setSelected(new Set(c === true ? importable.map((s) => s.key) : []))} aria-label="Alle auswählen" />
            Alle auswählen
          </label>
        )}
      </div>
      {importable.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
          Die Quelle stimmt mit der aktuellen Konfiguration überein – es gibt nichts zu übernehmen.
        </Card>
      ) : (
        importable.map((s) => <SectionCard key={s.key} section={s} diff={diffs[s.key]} checked={selected.has(s.key)} onChecked={(on) => toggle(s.key, on)} />)
      )}
      {invalid.map((s) => (
        <Card key={s.key} className="flex items-start gap-3 border-rose-500/30 px-5 py-4">
          <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{s.title} <span className="font-normal text-muted-foreground">· wird nicht übernommen</span></p>
            <p className="mt-0.5 text-[13px] break-words text-muted-foreground">{s.error}</p>
          </div>
        </Card>
      ))}
      {unchanged.length > 0 && (
        <p className="px-1 text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">Unverändert:</span> {unchanged.map((s) => s.title).join(', ')}
        </p>
      )}

      <ValidationCard previewId={preview.id} initial={preview.issues} selected={selected} />

      {/* Apply */}
      <Card className="border-primary/30">
        <CardHeader>
          <div>
            <CardTitle>Übernehmen</CardTitle>
            <CardDescription>
              Jeder ausgewählte Bereich wird als neue Version gespeichert – mit Kommentar und Quellenangabe in der Versionshistorie und im Änderungsprotokoll. Ältere Versionen bleiben wiederherstellbar.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (selected.size && comment.trim()) onApply()
            }}
          >
            <Field label="Kommentar" htmlFor="imp-comment" required hint={`Wird gespeichert als „Import aus ${preview.label}: …“`}>
              <Textarea id="imp-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Warum wird übernommen? z. B. Freigabe CAB-1234" />
            </Field>
            {conflict && (
              <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1 basis-60">{conflict}</span>
                <Button type="button" size="xs" variant="outline" onClick={() => onReplacements(preview.replacements)} loading={refreshing}>
                  {!refreshing && <RefreshCw />} Vorschau aktualisieren
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-muted-foreground">
                {selected.size === 0 ? 'Kein Bereich ausgewählt.' : selected.size === 1 ? '1 Bereich ausgewählt.' : `${selected.size} Bereiche ausgewählt.`}
              </p>
              <Button type="submit" disabled={!selected.size || !comment.trim()} loading={applying}>
                {!applying && <Import />} {selected.size > 1 ? `${selected.size} Bereiche übernehmen` : 'Übernehmen'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function SectionCard({ section: s, diff, checked, onChecked }: { section: ImportPreviewSection; diff: SectionDiff; checked: boolean; onChecked: (on: boolean) => void }) {
  const [open, setOpen] = React.useState(false)
  const id = `imp-sec-${s.key}`
  return (
    <Card className={cn('overflow-hidden transition-colors', checked && 'border-primary/40')} data-section={s.key}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
        <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChecked(c === true)} aria-label={`${s.title} übernehmen`} />
        <label htmlFor={id} className="min-w-0 flex-1 basis-40 cursor-pointer">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{s.title}</span>
            <Badge variant={statusMeta[s.status].variant}>{statusMeta[s.status].label}</Badge>
            {s.replacements > 0 && (
              <Badge variant="outline"><Replace /> {s.replacements} {s.replacements === 1 ? 'Ersetzung' : 'Ersetzungen'}</Badge>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            <span className="font-mono">{s.fileName}</span>
            {' · '}
            {s.baseVersion ? `aktuell v${s.baseVersion} → v${s.baseVersion + 1}` : 'wird neu angelegt (v1)'}
            {s.sourceVersion ? ` · Quelle v${s.sourceVersion}` : ''}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <DiffCounts diff={diff} />
          <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`${id}-changes`}>
            <ChevronRight className={cn('transition-transform', open && 'rotate-90')} /> {open ? 'Ausblenden' : 'Änderungen'}
          </Button>
        </div>
      </div>
      {open && (
        <div id={`${id}-changes`} className="border-t bg-muted/20 p-3 sm:p-4">
          <ChangeList diff={diff} maxHeight="55vh" />
        </div>
      )}
    </Card>
  )
}

function ReplacementsCard({ preview, busy, onApply }: { preview: ImportPreview; busy: boolean; onApply: (rules: ReplacementRule[]) => void }) {
  const [rows, setRows] = React.useState<ReplacementRule[]>(preview.replacements.length ? preview.replacements : [])
  React.useEffect(() => setRows(preview.replacements), [preview.replacements])
  const clean = rows.filter((r) => r.search)
  const changed = JSON.stringify(clean) !== JSON.stringify(preview.replacements)
  const total = preview.sections.reduce((n, s) => n + s.replacements, 0)
  const update = (i: number, patch: Partial<ReplacementRule>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2"><Replace className="size-4 text-muted-foreground" /> Ersetzungen</CardTitle>
          <CardDescription>
            Optional: Texte der Quelle vor dem Vergleich ersetzen, etwa Namen von Domänencontrollern oder Präfixe der Testumgebung. {'{{DOMAIN_DN}}'} wird ohnehin je Umgebung eingesetzt.
          </CardDescription>
        </div>
        {preview.replacements.length > 0 && <Badge variant="default">{total} {total === 1 ? 'Treffer' : 'Treffer'}</Badge>}
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.length > 0 && (
          <ul className="grid gap-2">
            {rows.map((r, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
                <Input aria-label={`Suchen ${i + 1}`} value={r.search} onChange={(e) => update(i, { search: e.target.value })} placeholder="Suchen, z. B. dc01.test.local" className="font-mono text-[13px]" />
                <ArrowRight className="hidden size-4 text-muted-foreground sm:block" />
                <Input aria-label={`Ersetzen ${i + 1}`} value={r.replace} onChange={(e) => update(i, { replace: e.target.value })} placeholder="Ersetzen durch" className="col-start-1 font-mono text-[13px] sm:col-start-auto" />
                <Button variant="ghost" size="icon-sm" aria-label={`Ersetzung ${i + 1} entfernen`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="row-span-2 row-start-1 col-start-2 sm:row-span-1 sm:col-start-auto sm:row-start-auto">
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => setRows((r) => [...r, { search: '', replace: '' }])} disabled={rows.length >= 50}>
            <Plus /> Ersetzung hinzufügen
          </Button>
          {(changed || busy) && (
            <Button size="sm" onClick={() => onApply(clean)} loading={busy}>
              {!busy && <RefreshCw />} Anwenden und Vorschau aktualisieren
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ValidationCard({ previewId, initial, selected }: { previewId: string; initial: ImportIssue[]; selected: Set<string> }) {
  const [issues, setIssues] = React.useState(initial)
  const [loading, setLoading] = React.useState(false)
  const [onlyNew, setOnlyNew] = React.useState(true)
  const key = [...selected].sort().join(',')
  const first = React.useRef(true)

  React.useEffect(() => {
    setIssues(initial)
  }, [initial])
  React.useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    let cancelled = false
    setLoading(true)
    const tt = setTimeout(() => {
      transferApi
        .validate(previewId, key ? key.split(',') : [])
        .then((r) => !cancelled && setIssues(r))
        .catch(() => {})
        .finally(() => !cancelled && setLoading(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(tt)
    }
  }, [previewId, key])

  const shown = onlyNew ? issues.filter((i) => i.isNew) : issues
  const newErrors = issues.filter((i) => i.isNew && i.severity === 'Error').length
  const newWarnings = issues.filter((i) => i.isNew && i.severity === 'Warning').length

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            Validierung des Ergebnisses {loading && <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />}
          </CardTitle>
          <CardDescription>Prüfung der Konfiguration, wie sie nach der Übernahme der ausgewählten Bereiche wäre – einschließlich der Tier-Regeln.</CardDescription>
        </div>
        <Segmented
          aria-label="Anzeige"
          value={onlyNew ? 'new' : 'all'}
          onValueChange={(v) => setOnlyNew(v === 'new')}
          options={[
            { value: 'new', label: `Durch Import · ${issues.filter((i) => i.isNew).length}` },
            { value: 'all', label: `Alle · ${issues.length}` },
          ]}
        />
      </CardHeader>
      <CardContent>
        {newErrors > 0 && (
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-900 dark:text-rose-200">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            Die Übernahme führt zu {newErrors} neuen Fehler(n){newWarnings ? ` und ${newWarnings} Warnung(en)` : ''}. Bitte prüfen, ob weitere Bereiche mit übernommen werden müssen.
          </p>
        )}
        {shown.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-500" /> {onlyNew ? 'Keine neuen Probleme durch den Import.' : 'Keine Probleme.'}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {shown.slice(0, 100).map((i, idx) => (
              <li key={idx} className="flex items-start gap-3 px-3 py-2.5">
                {i.severity === 'Error' ? (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" aria-label="Fehler" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-label="Warnung" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] break-words">{i.message}</p>
                  {i.item && <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{i.item}</p>}
                </div>
                {i.isNew && !onlyNew && <Badge variant="info" className="shrink-0">neu</Badge>}
              </li>
            ))}
            {shown.length > 100 && <li className="px-3 py-2 text-xs text-muted-foreground">… und {shown.length - 100} weitere</li>}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function ResultCard({ result, onRestart }: { result: ImportApplyResult; onRestart: () => void }) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-content-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold">Import abgeschlossen</p>
            <p className="text-[13px] text-muted-foreground">Die Bereiche wurden als neue Versionen gespeichert. Vor dem Anwenden im AD wie gewohnt planen.</p>
          </div>
        </div>
        <ul className="divide-y rounded-lg border">
          {result.applied.map((a) => (
            <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
              <span className="font-medium">{a.title}</span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{a.fromVersion ? `v${a.fromVersion} → v${a.toVersion}` : `v${a.toVersion} (neu)`}</span>
                <Button variant="ghost" size="xs" asChild>
                  <Link to={`/konfiguration/${a.key}`}>Öffnen</Link>
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onRestart}>Weiteren Import starten</Button>
          <Button asChild>
            <Link to="/deploy">Zum Deploy</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
