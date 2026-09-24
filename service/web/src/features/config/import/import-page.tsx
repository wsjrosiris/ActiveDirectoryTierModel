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
import { currentLocale, t } from '@/i18n'

export function Component() {
  return (
    <RequireAuth role="Editor">
      <ImportPage />
    </RequireAuth>
  )
}

type Source = 'file' | 'remote'

const statusMeta: Record<ImportPreviewSection['status'], { label: string; variant: 'warning' | 'info' | 'muted' | 'danger' | 'outline' }> = {
  changed: { label: t('config.import.import.changed'), variant: 'warning' },
  new: { label: t('config.import.import.new'), variant: 'info' },
  unchanged: { label: t('config.import.import.unchanged'), variant: 'muted' },
  invalid: { label: t('config.import.import.invalid'), variant: 'danger' },
  unknown: { label: t('config.import.import.unknown'), variant: 'outline' },
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
      toast.error(source === 'file' ? t('config.import.import.fileCouldNotBeRead') : t('config.import.import.retrievalFailed'), {
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
      toast.success(t('config.import.import.areasApplied', { count: r.applied.length }))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(e.detail || e.title)
      else if (e instanceof ApiError && e.status === 404) {
        toast.error(t('config.import.import.previewExpired'), { description: t('config.import.import.pleaseLoadTheSourceAgain') })
        setPreview(null)
      } else toast.error(t('config.import.import.importFailed'), { description: errorMessage(e) })
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
    onError: (e) => toast.error(t('config.import.import.previewCouldNotBeRefreshed'), { description: errorMessage(e) }),
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
        <Link to="/konfiguration"><ArrowLeft /> {t('config.import.import.configuration')}</Link>
      </Button>
      <PageHeader
        icon={<Import />}
        title={t('config.import.import.import')}
        description={t('config.import.import.takeOverConfigurationFromAn')}
      />
      <div ref={topRef} className="scroll-mt-20" />
      <Stepper step={step} done={!!result} />

      {result ? (
        <ResultCard result={result} onRestart={reset} />
      ) : !preview ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('config.import.import.selectSource')}</CardTitle>
              <CardDescription>{t('config.import.import.nothingIsChangedYetFirst')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Segmented
              aria-label={t('config.import.import.source')}
              value={source}
              onValueChange={setSource}
              className="w-full sm:w-auto"
              options={[
                { value: 'file', label: t('config.import.import.uploadFile'), icon: <Upload /> },
                { value: 'remote', label: t('config.import.import.otherInstance'), icon: <Server /> },
              ]}
            />
            {source === 'file' ? <DropZone file={file} onFile={setFile} /> : <RemoteInstancePicker value={instanceId} onChange={(id) => { setInstanceId(id); setRemoteDomain('') }} remoteDomain={remoteDomain} onRemoteDomainChange={setRemoteDomain} />}
            <div className="flex justify-end">
              <Button onClick={() => load.mutate()} loading={load.isPending} disabled={source === 'file' ? !file : !instanceId}>
                {t('config.import.import.createPreview')} {!load.isPending && <ArrowRight />}
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
  const steps = [t('config.import.import.source'), t('config.import.import.preview'), t('config.import.import.apply')]
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" aria-label={t('config.import.import.steps')}>
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
          <p className="text-xs text-muted-foreground">{t('config.import.import.fileSize', { size: (file.size / 1024).toLocaleString(currentLocale(), { maximumFractionDigits: 0 }) })}</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">{t('config.import.import.dragTheExportFileZip')}</p>
          <p className="max-w-md text-xs text-muted-foreground">{t('config.import.import.theFileFromConfigurationExport')}</p>
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
            <CardDescription>{t('config.import.import.previewOf')} {formatDateTime(preview.createdAt)}</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
            {t('config.import.import.otherSource')}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="warning">{importable.filter((s) => s.status === 'changed').length} {t('config.import.import.changed2')}</Badge>
            {importable.some((s) => s.status === 'new') && <Badge variant="info">{importable.filter((s) => s.status === 'new').length} {t('config.import.import.new2')}</Badge>}
            <Badge variant="muted">{unchanged.length} {t('config.import.import.unchanged2')}</Badge>
            {invalid.length > 0 && <Badge variant="danger">{invalid.length} {t('config.import.import.invalid2')}</Badge>}
            {unknown.length > 0 && <Badge variant="outline">{unknown.length} {t('config.import.import.unknown2')}</Badge>}
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
        <h2 className="text-base font-semibold tracking-tight">{t('config.import.import.changesPerArea')}</h2>
        {importable.length > 1 && (
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={allOn ? true : selected.size ? 'indeterminate' : false} onCheckedChange={(c) => setSelected(new Set(c === true ? importable.map((s) => s.key) : []))} aria-label={t('config.import.import.selectAll')} />
            {t('config.import.import.selectAll')}
          </label>
        )}
      </div>
      {importable.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
          {t('config.import.import.theSourceMatchesTheCurrent')}
        </Card>
      ) : (
        importable.map((s) => <SectionCard key={s.key} section={s} diff={diffs[s.key]} checked={selected.has(s.key)} onChecked={(on) => toggle(s.key, on)} />)
      )}
      {invalid.map((s) => (
        <Card key={s.key} className="flex items-start gap-3 border-rose-500/30 px-5 py-4">
          <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{s.title} <span className="font-normal text-muted-foreground">{t('config.import.import.willNotBeTakenOver')}</span></p>
            <p className="mt-0.5 text-[13px] break-words text-muted-foreground">{s.error}</p>
          </div>
        </Card>
      ))}
      {unchanged.length > 0 && (
        <p className="px-1 text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">{t('config.import.import.unchanged3')}</span> {unchanged.map((s) => s.title).join(', ')}
        </p>
      )}

      <ValidationCard previewId={preview.id} initial={preview.issues} selected={selected} />

      {/* Apply */}
      <Card className="border-primary/30">
        <CardHeader>
          <div>
            <CardTitle>{t('config.import.import.apply')}</CardTitle>
            <CardDescription>
              {t('config.import.import.everySelectedAreaIsSaved')}
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
            <Field label={t('config.import.import.comment')} htmlFor="imp-comment" required hint={t('config.import.import.savedAsImportFromLabel', { label: preview.label })}>
              <Textarea id="imp-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('config.import.import.whyIsThisTakenOver')} />
            </Field>
            {conflict && (
              <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1 basis-60">{conflict}</span>
                <Button type="button" size="xs" variant="outline" onClick={() => onReplacements(preview.replacements)} loading={refreshing}>
                  {!refreshing && <RefreshCw />} {t('config.import.import.refreshPreview')}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-muted-foreground">
                {selected.size === 0 ? t('config.import.import.noAreaSelected') : selected.size === 1 ? t('config.import.import.n1AreaSelected') : t('config.import.import.sizeAreasSelected', { size: selected.size, count: selected.size })}
              </p>
              <Button type="submit" disabled={!selected.size || !comment.trim()} loading={applying}>
                {!applying && <Import />} {selected.size > 1 ? t('config.import.import.applySizeAreas', { size: selected.size, count: selected.size }) : t('config.import.import.apply')}
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
        <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChecked(c === true)} aria-label={t('config.import.import.applyTitle', { title: s.title })} />
        <label htmlFor={id} className="min-w-0 flex-1 basis-40 cursor-pointer">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{s.title}</span>
            <Badge variant={statusMeta[s.status].variant}>{statusMeta[s.status].label}</Badge>
            {s.replacements > 0 && (
              <Badge variant="outline"><Replace /> {t('config.import.import.replacementsCount', { count: s.replacements })}</Badge>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            <span className="font-mono">{s.fileName}</span>
            {' · '}
            {s.baseVersion ? t('config.import.import.currentVBaseversionVValue', { baseVersion: s.baseVersion, value: s.baseVersion + 1 }) : t('config.import.import.willBeCreatedV1')}
            {s.sourceVersion ? t('config.import.import.sourceVSourceversion', { sourceVersion: s.sourceVersion }) : ''}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <DiffCounts diff={diff} />
          <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`${id}-changes`}>
            <ChevronRight className={cn('transition-transform', open && 'rotate-90')} /> {open ? t('config.import.import.hide') : t('config.import.import.changes')}
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
          <CardTitle className="flex items-center gap-2"><Replace className="size-4 text-muted-foreground" /> {t('config.import.import.replacements')}</CardTitle>
          <CardDescription>
            {t('config.import.import.optionalReplaceTextsOfThe')} {'{{DOMAIN_DN}}'} {t('config.import.import.isInsertedPerEnvironmentAnyway')}
          </CardDescription>
        </div>
        {preview.replacements.length > 0 && <Badge variant="default">{t('config.import.import.hitsCount', { count: total })}</Badge>}
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.length > 0 && (
          <ul className="grid gap-2">
            {rows.map((r, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
                <Input aria-label={t('config.import.import.searchValue', { value: i + 1 })} value={r.search} onChange={(e) => update(i, { search: e.target.value })} placeholder={t('config.import.import.searchEGDc01Test')} className="font-mono text-[13px]" />
                <ArrowRight className="hidden size-4 text-muted-foreground sm:block" />
                <Input aria-label={t('config.import.import.replaceValue', { value: i + 1 })} value={r.replace} onChange={(e) => update(i, { replace: e.target.value })} placeholder={t('config.import.import.replaceWith')} className="col-start-1 font-mono text-[13px] sm:col-start-auto" />
                <Button variant="ghost" size="icon-sm" aria-label={t('config.import.import.removeReplacementValue', { value: i + 1 })} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="row-span-2 row-start-1 col-start-2 sm:row-span-1 sm:col-start-auto sm:row-start-auto">
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => setRows((r) => [...r, { search: '', replace: '' }])} disabled={rows.length >= 50}>
            <Plus /> {t('config.import.import.addReplacement')}
          </Button>
          {(changed || busy) && (
            <Button size="sm" onClick={() => onApply(clean)} loading={busy}>
              {!busy && <RefreshCw />} {t('config.import.import.applyAndRefreshPreview')}
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
            {t('config.import.import.validationOfTheResult')} {loading && <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />}
          </CardTitle>
          <CardDescription>{t('config.import.import.checkOfTheConfigurationAs')}</CardDescription>
        </div>
        <Segmented
          aria-label={t('config.import.import.show')}
          value={onlyNew ? 'new' : 'all'}
          onValueChange={(v) => setOnlyNew(v === 'new')}
          options={[
            { value: 'new', label: t('config.import.import.causedByImportLength', { length: issues.filter((i) => i.isNew).length }) },
            { value: 'all', label: t('config.import.import.allLength', { length: issues.length }) },
          ]}
        />
      </CardHeader>
      <CardContent>
        {newErrors > 0 && (
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-900 dark:text-rose-200">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            {newWarnings ? t('config.import.import.newProblemsWarnings', { errors: newErrors, warnings: newWarnings }) : t('config.import.import.newProblems', { errors: newErrors })}
          </p>
        )}
        {shown.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-500" /> {onlyNew ? t('config.import.import.noNewProblemsCausedBy') : t('config.import.import.noProblems')}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {shown.slice(0, 100).map((i, idx) => (
              <li key={idx} className="flex items-start gap-3 px-3 py-2.5">
                {i.severity === 'Error' ? (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" aria-label={t('config.import.import.error')} />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-label={t('config.import.import.warning')} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] break-words">{i.message}</p>
                  {i.item && <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{i.item}</p>}
                </div>
                {i.isNew && !onlyNew && <Badge variant="info" className="shrink-0">{t('config.import.import.new2')}</Badge>}
              </li>
            ))}
            {shown.length > 100 && <li className="px-3 py-2 text-xs text-muted-foreground">{t('config.import.import.andMore', { count: shown.length - 100 })}</li>}
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
            <p className="text-base font-semibold">{t('config.import.import.importCompleted')}</p>
            <p className="text-[13px] text-muted-foreground">{t('config.import.import.theAreasWereSavedAs')}</p>
          </div>
        </div>
        <ul className="divide-y rounded-lg border">
          {result.applied.map((a) => (
            <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
              <span className="font-medium">{a.title}</span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{a.fromVersion ? `v${a.fromVersion} → v${a.toVersion}` : t('config.import.import.vToversionNew', { toVersion: a.toVersion })}</span>
                <Button variant="ghost" size="xs" asChild>
                  <Link to={`/konfiguration/${a.key}`}>{t('config.import.import.open')}</Link>
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onRestart}>{t('config.import.import.startAnotherImport')}</Button>
          <Button asChild>
            <Link to="/deploy">{t('config.import.import.toDeploy')}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
