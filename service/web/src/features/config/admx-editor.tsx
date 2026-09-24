import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FileX2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { TemplateFile } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { SortableTH, Table, TBody, TD, TH, THead, TR, type SortDir } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { cn, formatNumber, modKey } from '@/lib/utils'
import type { EditorProps } from './editors'
import { FormSection } from './form-helpers'
import { useTemplateFiles } from './lookups'
import { mergeSubset, ObjectFields } from './object-form'
import { currentLocale, t } from '@/i18n'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

type Status = 'ok' | 'mismatch' | 'missing' | 'unknown'

export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function urlError(v: string): string | null {
  if (!v.trim()) return null
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? null : t('config.admxEditor.theLinkMustStartWith')
  } catch {
    return t('config.admxEditor.pleaseEnterACompleteAddress')
  }
}

/** "2026-02-04" or an ISO timestamp → "04.02.2026" */
export function formatDay(v: string | undefined | null) {
  if (!v) return '–'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : v
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString(currentLocale(), { maximumFractionDigits: 1 })} KB`
  return `${(bytes / 1024 / 1024).toLocaleString(currentLocale(), { maximumFractionDigits: 1 })} MB`
}

const statusMeta: Record<Status, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted'; icon: React.ReactNode; hint: string }> = {
  ok: { label: t('config.admxEditor.statusOk'), variant: 'success', icon: <CheckCircle2 />, hint: t('config.admxEditor.theConfiguredHashMatchesThe') },
  mismatch: { label: t('config.admxEditor.statusMismatch'), variant: 'warning', icon: <AlertTriangle />, hint: t('config.admxEditor.theFileHasChangedSince') },
  missing: { label: t('config.admxEditor.fileMissing'), variant: 'danger', icon: <FileX2 />, hint: t('config.admxEditor.theFileIsNotIn') },
  unknown: { label: t('config.admxEditor.statusUnknown'), variant: 'muted', icon: null, hint: t('config.admxEditor.templateFilesCouldNotBe') },
}

export function AdmxEditor({ sectionKey, content, setContent, readOnly }: EditorProps) {
  const isAdml = sectionKey.startsWith('adml')
  const lang = isAdml ? sectionKey.replace(/^adml-/, '') : ''
  const blockKey = isAdml ? 'adml' : 'admx'
  const ext = isAdml ? '.adml' : '.admx'
  const root: Record<string, Json> = content && typeof content === 'object' ? content : {}
  const block: Record<string, Json> = root[blockKey] && typeof root[blockKey] === 'object' ? root[blockKey] : {}
  const files: Record<string, Json> = block.files && typeof block.files === 'object' ? block.files : {}

  const templates = useTemplateFiles()
  const actual: TemplateFile[] | undefined = templates.data ? (isAdml ? (templates.data.adml?.[lang] ?? []) : templates.data.admx) : undefined
  const actualByName = React.useMemo(() => new Map((actual ?? []).map((f) => [f.name.toLowerCase(), f])), [actual])

  const [filter, setFilter] = React.useState('')
  const [sort, setSort] = React.useState<{ id: string; dir: SortDir }>({ id: 'name', dir: 'asc' })
  const [editing, setEditing] = React.useState<string | null>(null)
  const confirm = useConfirm()

  const setRoot = (k: string, v: Json, tag?: string) => setContent({ ...root, [k]: v }, tag)
  const setBlock = (k: string, v: Json, tag?: string) => setRoot(blockKey, { ...block, [k]: v }, tag)
  const setFiles = (next: Record<string, Json>, tag?: string) => setBlock('files', next, tag)
  const setFile = (name: string, v: Json, tag?: string) => setFiles({ ...files, [name]: v }, tag)

  const statusOf = React.useCallback(
    (name: string): Status => {
      if (!actual) return 'unknown'
      const f = actualByName.get(name.toLowerCase())
      if (!f) return 'missing'
      return String(files[name]?.hash ?? '').toUpperCase() === f.md5.toUpperCase() ? 'ok' : 'mismatch'
    },
    [actual, actualByName, files],
  )

  const names = Object.keys(files)
  const counts = names.reduce((c, n) => ({ ...c, [statusOf(n)]: (c[statusOf(n)] ?? 0) + 1 }), {} as Partial<Record<Status, number>>)
  const q = filter.trim().toLowerCase()
  const rows = names
    .filter((n) => !q || n.toLowerCase().includes(q) || String(files[n]?.comment ?? '').toLowerCase().includes(q))
    .sort((a, b) => {
      const va = sort.id === 'name' ? a : sort.id === 'date' ? String(files[a]?.hashDate ?? '') : sort.id === 'status' ? statusOf(a) : String(files[a]?.comment ?? '')
      const vb = sort.id === 'name' ? b : sort.id === 'date' ? String(files[b]?.hashDate ?? '') : sort.id === 'status' ? statusOf(b) : String(files[b]?.comment ?? '')
      const c = va.localeCompare(vb, 'de', { numeric: true, sensitivity: 'base' })
      return sort.dir === 'asc' ? c : -c
    })
  const toggleSort = (id: string) => setSort((s) => (s.id === id ? { id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: 'asc' }))

  const addOptions: ComboOption[] = React.useMemo(
    () =>
      (actual ?? [])
        .filter((f) => !names.some((n) => n.toLowerCase() === f.name.toLowerCase()))
        .map((f) => ({ value: f.name, hint: t('config.admxEditor.sizeModifiedModified', { size: formatSize(f.size), modified: formatDay(f.modified) }), icon: <FileCode2 className="size-4 text-muted-foreground" /> })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actual, names.join('|')],
  )

  const addFile = (name: string) => {
    const f = actualByName.get(name.toLowerCase())
    if (!f) return
    // New entries copy the shape (comment/link) of the most recent entry of the same template package, if any.
    const sameStem = names.find((n) => n.replace(/\.\w+$/, '').toLowerCase() === f.name.replace(/\.\w+$/, '').toLowerCase())
    const sample = sameStem ? files[sameStem] : undefined
    setFiles({
      ...files,
      [f.name]: { comment: sample?.comment ?? '', hashDate: todayIso(), downloadLink: sample?.downloadLink ?? '', hash: f.md5 },
    })
    setEditing(f.name)
    toast.success(t('config.admxEditor.nameAdded', { name: f.name }), { description: t('config.admxEditor.hashAndHashDateWere') })
  }

  const takeHash = (name: string) => {
    const f = actualByName.get(name.toLowerCase())
    if (!f) return
    setFile(name, { ...files[name], hash: f.md5, hashDate: todayIso() })
    toast.success(t('config.admxEditor.hashTakenOver'), { description: name })
  }

  const takeAll = () => {
    const next = { ...files }
    let n = 0
    for (const name of names)
      if (statusOf(name) === 'mismatch') {
        next[name] = { ...files[name], hash: actualByName.get(name.toLowerCase())!.md5, hashDate: todayIso() }
        n++
      }
    setFiles(next)
    toast.success(t('config.admxEditor.nHashesTakenOver', { n, count: n }))
  }

  const remove = async (name: string) => {
    const ok = await confirm({
      title: t('config.admxEditor.removeFile'),
      description: t('config.admxEditor.removeDescription', { name, key: `${modKey}+Z` }),
      confirmText: t('common.remove'),
      destructive: true,
    })
    if (!ok) return
    const next = { ...files }
    delete next[name]
    setFiles(next)
  }

  // Keys this editor does not know are still editable, via the generic form.
  const knownRoot = ['version', 'lastUpdated', 'comment', blockKey]
  const knownBlock = ['destinationPath', 'sourcePath', 'files']
  const extraRoot = Object.fromEntries(Object.entries(root).filter(([k]) => !knownRoot.includes(k)))
  const extraBlock = Object.fromEntries(Object.entries(block).filter(([k]) => !knownBlock.includes(k)))

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <fieldset disabled={readOnly} className="grid min-w-0 gap-5">
          <FormSection title={t('config.admxEditor.general')}>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
              <Field label={t('config.admxEditor.version')} htmlFor="ax-version">
                <Input id="ax-version" className="font-mono" value={root.version ?? ''} onChange={(e) => setRoot('version', e.target.value, 'ax-version')} placeholder="2.0.0" />
              </Field>
              <Field label={t('config.admxEditor.lastUpdated')} htmlFor="ax-updated">
                <Input id="ax-updated" type="date" value={root.lastUpdated ?? ''} onChange={(e) => setRoot('lastUpdated', e.target.value, 'ax-updated')} />
              </Field>
            </div>
            <Field label={t('config.admxEditor.comment')} htmlFor="ax-comment">
              <Textarea id="ax-comment" rows={2} value={root.comment ?? ''} onChange={(e) => setRoot('comment', e.target.value, 'ax-comment')} />
            </Field>
          </FormSection>
          <FormSection
            title={isAdml ? t('config.admxEditor.pathsOfTheAdmlFiles', { lang }) : t('config.admxEditor.pathsOfTheAdmxFiles')}
            description={t('config.admxEditor.placeholdersSuchAsDomainFqdn')}
          >
            <Field label={t('config.admxEditor.targetPath')} htmlFor="ax-dest" hint={<>{t('config.admxEditor.centralStoreInSysvolE')} <span className="font-mono">\\{'{{DOMAIN_FQDN}}'}\SYSVOL\{'{{DOMAIN_FQDN}}'}\Policies\PolicyDefinitions{isAdml ? `\\${lang}` : ''}</span></>}>
              <Input id="ax-dest" className="font-mono text-[13px]" value={block.destinationPath ?? ''} onChange={(e) => setBlock('destinationPath', e.target.value, 'ax-dest')} />
            </Field>
            <Field label={t('config.admxEditor.sourcePath')} htmlFor="ax-src" hint={t('config.admxEditor.relativeToTheFrameworkDirectory')}>
              <Input id="ax-src" className="font-mono text-[13px]" value={block.sourcePath ?? ''} onChange={(e) => setBlock('sourcePath', e.target.value, 'ax-src')} />
            </Field>
          </FormSection>
        </fieldset>
        {(Object.keys(extraRoot).length > 0 || Object.keys(extraBlock).length > 0) && (
          <div className="mt-5 grid gap-4 border-t pt-5">
            <h3 className="text-[13px] font-semibold">{t('config.admxEditor.moreFields')}</h3>
            {Object.keys(extraRoot).length > 0 && (
              <ObjectFields value={extraRoot} readOnly={readOnly} depth={1} idPrefix="ax-extra" onChange={(x) => setContent(mergeSubset(root, extraRoot, x))} />
            )}
            {Object.keys(extraBlock).length > 0 && (
              <ObjectFields value={extraBlock} readOnly={readOnly} depth={1} idPrefix="ax-extra-b" onChange={(x) => setRoot(blockKey, mergeSubset(block, extraBlock, x))} />
            )}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('config.admxEditor.filterFiles')} className="h-8 pr-8 pl-8 text-[13px]" aria-label={t('config.admxEditor.filterFiles2')} />
          {filter && (
            <button type="button" onClick={() => setFilter('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={t('config.admxEditor.clearFilter')}>
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {templates.isLoading ? (
            <Skeleton className="h-5 w-40" />
          ) : (
            (['ok', 'mismatch', 'missing'] as Status[]).map((s) =>
              counts[s] ? (
                <Badge key={s} variant={statusMeta[s].variant}>
                  {statusMeta[s].icon} {counts[s]} {statusMeta[s].label}
                </Badge>
              ) : null,
            )
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!readOnly && !!counts.mismatch && (
            <Button size="sm" variant="outline" onClick={takeAll}>
              <RefreshCw /> {t('config.admxEditor.takeOverAllHashes')}
            </Button>
          )}
          {!readOnly && (
            <div className="w-64">
              <Combobox
                value=""
                onChange={addFile}
                options={addOptions}
                allowCustom={false}
                placeholder={t('config.admxEditor.addFile')}
                searchPlaceholder={t('config.admxEditor.searchTouppercaseFile', { toUpperCase: ext.slice(1).toUpperCase() })}
                emptyText={templates.isLoading ? t('common.loading') : actual ? t('config.admxEditor.allExtFilesAreAlready', { ext }) : t('config.admxEditor.templateFolderNotReadable')}
              />
            </div>
          )}
        </div>
      </div>

      <Card className="@container overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState compact icon={<FileCode2 />} title={names.length ? t('common.noMatches') : t('config.admxEditor.noFilesConfigured')} description={names.length ? t('config.admxEditor.adjustTheFilter') : t('config.admxEditor.addExtFilesFromThe', { ext })} />
        ) : (
          <Table>
            <THead>
              <TR>
                <SortableTH label={t('config.admxEditor.file')} active={sort.id === 'name'} dir={sort.dir} onClick={() => toggleSort('name')} />
                <SortableTH label={t('config.admxEditor.comment')} active={sort.id === 'comment'} dir={sort.dir} onClick={() => toggleSort('comment')} className="hidden @2xl:table-cell" />
                <SortableTH label={t('config.admxEditor.hashDate')} active={sort.id === 'date'} dir={sort.dir} onClick={() => toggleSort('date')} className="hidden @xl:table-cell" />
                <TH className="hidden @4xl:table-cell">{t('config.admxEditor.downloadLink')}</TH>
                <TH className="hidden @5xl:table-cell">{t('config.admxEditor.hash')}</TH>
                <SortableTH label={t('common.status')} active={sort.id === 'status'} dir={sort.dir} onClick={() => toggleSort('status')} />
                <TH className="w-10"><span className="sr-only">{t('common.actions')}</span></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((name) => {
                const f = files[name] ?? {}
                const st = statusOf(name)
                return (
                  <TR key={name} className="group cursor-pointer" onClick={(e) => !(e.target as HTMLElement).closest('button,a,[role=menuitem]') && setEditing(name)}>
                    <TD><span className="font-mono text-[12.5px] font-medium whitespace-nowrap">{name}</span></TD>
                    <TD className="hidden @2xl:table-cell"><span className="line-clamp-1 max-w-[260px] text-muted-foreground" title={f.comment}>{f.comment || '–'}</span></TD>
                    <TD className="hidden whitespace-nowrap text-muted-foreground tabular @xl:table-cell">{f.hashDate ? formatDay(f.hashDate) : '–'}</TD>
                    <TD className="hidden @4xl:table-cell">
                      {f.downloadLink ? (
                        <a href={f.downloadLink} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-[220px] items-center gap-1 truncate text-primary hover:underline" title={f.downloadLink}>
                          <ExternalLink className="size-3.5 shrink-0" />
                          <span className="truncate">{(() => { try { return new URL(f.downloadLink).hostname } catch { return f.downloadLink } })()}</span>
                        </a>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </TD>
                    <TD className="hidden @5xl:table-cell">
                      <span className="font-mono text-[11.5px] text-muted-foreground" title={f.hash}>{f.hash ? `${String(f.hash).slice(0, 8)}…` : '–'}</span>
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <Tooltip content={st === 'mismatch' ? t('config.admxEditor.fileMd5', { md5: actualByName.get(name.toLowerCase())?.md5 }) : statusMeta[st].hint}>
                          <span><Badge variant={statusMeta[st].variant}>{statusMeta[st].icon} {statusMeta[st].label}</Badge></span>
                        </Tooltip>
                        {st === 'mismatch' && !readOnly && (
                          <Button type="button" size="xs" variant="outline" onClick={() => takeHash(name)}>
                            <RefreshCw /> {t('config.admxEditor.takeOverHash')}
                          </Button>
                        )}
                      </div>
                    </TD>
                    <TD className="w-10 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-xs" className="text-muted-foreground opacity-60 group-hover:opacity-100" aria-label={t('common.actions')}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(name)}><Pencil /> {readOnly ? t('config.admxEditor.view') : t('common.edit')}</DropdownMenuItem>
                          {!readOnly && (
                            <>
                              {st === 'mismatch' && <DropdownMenuItem onSelect={() => takeHash(name)}><RefreshCw /> {t('config.admxEditor.takeOverHash')}</DropdownMenuItem>}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem destructive onSelect={() => remove(name)}><Trash2 /> {t('common.remove')}</DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t bg-muted/20 px-5 py-2 text-xs text-muted-foreground">
          <span>{rows.length === names.length ? t('config.admxEditor.filesCount', { count: names.length, value: formatNumber(names.length) }) : t('config.admxEditor.filesFiltered', { shown: formatNumber(rows.length), total: formatNumber(names.length) })}</span>
          {actual && <span>{t('config.admxEditor.filesInFolder', { count: actual.length, value: formatNumber(actual.length), ext })}</span>}
        </div>
      </Card>

      <FileSheet
        name={editing}
        value={editing ? files[editing] : undefined}
        actual={editing ? actualByName.get(editing.toLowerCase()) : undefined}
        readOnly={readOnly}
        onClose={() => setEditing(null)}
        onSave={(v) => {
          if (editing) setFile(editing, v)
          setEditing(null)
        }}
      />
    </div>
  )
}

function FileSheet({
  name,
  value,
  actual,
  readOnly,
  onClose,
  onSave,
}: {
  name: string | null
  value: Json
  actual: TemplateFile | undefined
  readOnly: boolean
  onClose: () => void
  onSave: (v: Json) => void
}) {
  const [draft, setDraft] = React.useState<Json>({})
  React.useEffect(() => {
    if (name) setDraft(value ?? {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])
  const linkErr = urlError(String(draft.downloadLink ?? ''))
  const changed = JSON.stringify(draft) !== JSON.stringify(value ?? {})
  const hashOk = actual && String(draft.hash ?? '').toUpperCase() === actual.md5.toUpperCase()
  const set = (k: string, v: Json) => setDraft((d: Json) => ({ ...d, [k]: v }))

  return (
    <Sheet open={!!name} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined}>
        {name && (
          <form
            className="flex h-full flex-col"
            onSubmit={(e) => {
              e.preventDefault()
              if (!readOnly && !linkErr) onSave(draft)
            }}
          >
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 font-mono text-[15px]"><FileCode2 className="size-4 text-muted-foreground" /> {name}</SheetTitle>
              <SheetDescription>
                {actual ? t('config.admxEditor.sizeModifiedModified', { size: formatSize(actual.size), modified: formatDay(actual.modified) }) : t('config.admxEditor.theFileIsNotIn2')}
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              <fieldset disabled={readOnly} className="grid min-w-0 gap-5">
                <Field label={t('config.admxEditor.comment')} htmlFor="af-comment" hint={t('config.admxEditor.eGOriginAndVersion')}>
                  <Textarea id="af-comment" rows={2} value={draft.comment ?? ''} onChange={(e) => set('comment', e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
                  <Field label={t('config.admxEditor.hashDate')} htmlFor="af-date">
                    <Input id="af-date" type="date" value={draft.hashDate ?? ''} onChange={(e) => set('hashDate', e.target.value)} />
                  </Field>
                  <Field label={t('config.admxEditor.downloadLink')} htmlFor="af-link" error={linkErr ?? undefined}>
                    <Input id="af-link" type="url" inputMode="url" className="font-mono text-[13px]" value={draft.downloadLink ?? ''} onChange={(e) => set('downloadLink', e.target.value)} placeholder="https://www.microsoft.com/…" aria-invalid={!!linkErr || undefined} />
                  </Field>
                </div>
                <Field
                  label={t('config.admxEditor.hashMd5')}
                  htmlFor="af-hash"
                  hint={
                    !actual ? t('config.admxEditor.withoutAFileTheHash') : hashOk ? t('config.admxEditor.matchesTheFile') : t('config.admxEditor.differentCurrentHashOfThe', { md5: actual.md5 })
                  }
                >
                  <div className="flex gap-2">
                    <Input id="af-hash" readOnly className={cn('font-mono text-[12.5px]', actual && !hashOk && 'border-amber-500/60')} value={draft.hash ?? ''} />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!actual || readOnly}
                      onClick={() => actual && setDraft((d: Json) => ({ ...d, hash: actual.md5, hashDate: todayIso() }))}
                    >
                      <RefreshCw /> {t('config.admxEditor.recalculate')}
                    </Button>
                  </div>
                </Field>
              </fieldset>
            </SheetBody>
            <SheetFooter>
              {readOnly ? (
                <Button type="button" variant="outline" onClick={onClose}>{t('common.close')}</Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
                  <Button type="submit" disabled={!changed || !!linkErr}>{t('config.admxEditor.apply')}</Button>
                </>
              )}
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
