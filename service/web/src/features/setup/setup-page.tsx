import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  FolderInput,
  Network,
  Play,
  Rocket,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  Tag,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { PrefixPreview, RunSummary } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox } from '@/components/ui/combobox'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Page, PageHeader } from '@/components/shared/page-header'
import { OuTree } from '@/components/shared/ou-tree'
import { TierDot } from '@/components/shared/badges'
import { useCan } from '@/features/auth/auth'
import { adPath, adoptOus, CompareBadge, useAdCompare, useAdTree } from '@/features/config/ad-view'
import { draftStore, useDirtyKeys, useSectionContent } from '@/features/config/draft-store'
import { useDomainControllerOptions } from '@/features/config/lookups'
import { sectionQuery } from '@/features/config/queries'
import { SaveDialog } from '@/features/config/save-dialog'
import { settingsQuery } from '@/features/runs/run-request-form'
import { sectionFallbackTitles } from '@/lib/labels'
import type { OuItem } from '@/lib/ou'
import { errorMessage } from '@/lib/query'
import { tierOf } from '@/lib/tier'
import { cn } from '@/lib/utils'
import { setupStateKey } from './setup-card'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const STEPS = [
  { key: 'domain', title: 'Domäne', icon: Network },
  { key: 'structure', title: 'Struktur', icon: Tag },
  { key: 'ous', title: 'Vorhandene OUs', icon: FolderInput },
  { key: 'plan', title: 'Erste Planung', icon: Rocket },
] as const

const levelText = (level: string) => {
  const m = /^Windows(\d{4}(?:R2)?)(Domain|Forest)$/.exec(level)
  return m ? `Windows Server ${m[1].replace('R2', ' R2')}` : level || '–'
}

export function Component() {
  const isAdmin = useCan('Admin')
  const [step, setStep] = React.useState(0)
  const navigate = useNavigate()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const dirty = useDirtyKeys()
  const [saveOpen, setSaveOpen] = React.useState(false)
  // Drafts are made against these sections; their bases must be loaded first.
  const sections = [useQuery(sectionQuery('ous')), useQuery(sectionQuery('gpos')), useQuery(sectionQuery('winlaps')), useQuery(sectionQuery('groups'))]
  const ready = sections.every((s) => s.isSuccess)

  const complete = useMutation({
    mutationFn: (skipped: boolean) => api.setup.complete(skipped),
    onSuccess: (_d, skipped) => {
      qc.invalidateQueries({ queryKey: setupStateKey })
      toast.success(skipped ? 'Einrichtungsassistent übersprungen' : 'Einrichtung abgeschlossen')
      navigate('/')
    },
    onError: (e) => toast.error('Nicht gespeichert', { description: errorMessage(e) }),
  })

  if (!isAdmin)
    return (
      <Page>
        <Card><EmptyState icon={<ShieldCheck />} title="Nur für Administratoren" description="Die Einrichtung kann nur ein Administrator durchführen." /></Card>
      </Page>
    )

  const skip = async () => {
    const ok = await confirm({
      title: 'Einrichtung überspringen?',
      description: 'Der Hinweis auf dem Dashboard wird ausgeblendet. Alle Schritte lassen sich später auch einzeln in der Konfiguration erledigen.',
      confirmText: 'Überspringen',
    })
    if (ok) complete.mutate(true)
  }

  return (
    <Page className="pb-24">
      <PageHeader
        title="Einrichtung"
        description="In vier Schritten von der mitgelieferten Vorlage zur ersten Planung."
        actions={<Button variant="ghost" onClick={skip} disabled={complete.isPending}>Überspringen</Button>}
      />
      <ol className="mb-5 grid grid-cols-4 gap-1.5" aria-label="Schritte">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const done = i < step
          const active = i === step
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'border-primary/40 bg-primary/5 font-medium text-foreground' : 'bg-card text-muted-foreground hover:bg-accent/50',
                )}
              >
                <span className={cn('grid size-6 shrink-0 place-content-center rounded-full text-xs', done ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : active ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <Icon className="hidden size-4 shrink-0 sm:block" />
                <span className="hidden truncate sm:inline">{s.title}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mb-3 text-[13px] font-medium sm:hidden">Schritt {step + 1}: {STEPS[step].title}</p>

      {!ready ? (
        <Card className="p-5"><div className="grid gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div></Card>
      ) : step === 0 ? (
        <DomainStep onNext={() => setStep(1)} />
      ) : step === 1 ? (
        <StructureStep />
      ) : step === 2 ? (
        <OusStep />
      ) : (
        <PlanStep onFinish={() => complete.mutate(false)} finishing={complete.isPending} onSave={() => setSaveOpen(true)} />
      )}

      {step > 0 && step < 3 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={() => setStep(step - 1)}><ArrowLeft /> Zurück</Button>
          <Button onClick={() => setStep(step + 1)}>Weiter <ArrowRight /></Button>
        </div>
      )}

      {dirty.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-3 rounded-xl border bg-popover/95 py-2 pr-2 pl-4 shadow-xl shadow-black/10 backdrop-blur">
            <span className="size-2 rounded-full bg-amber-500" />
            <span className="min-w-0 text-[13px]">
              Ungespeicherte Änderungen<span className="text-muted-foreground"> in {dirty.map((k) => sectionFallbackTitles[k] ?? k).join(', ')}</span>
            </span>
            <Button size="sm" onClick={() => setSaveOpen(true)}><Save /> Speichern …</Button>
          </div>
        </div>
      )}
      {saveOpen && <SaveDialog open={saveOpen} onOpenChange={setSaveOpen} keys={dirty} />}
    </Page>
  )
}

function StepCard({ title, description, children, icon }: { title: string; description: React.ReactNode; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="mb-5 flex gap-3">
        <span className="grid size-9 shrink-0 place-content-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="text-[13px] text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}

function Fact({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground uppercase">{label}</p>
      <p className={cn('text-[13px] font-medium break-words', mono && 'font-mono text-[12px]')}>{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------- 1 domain

function DomainStep({ onNext }: { onNext: () => void }) {
  const tree = useAdTree()
  const settings = useQuery(settingsQuery)
  const qc = useQueryClient()
  const dcOptions = useDomainControllerOptions()
  const [dc, setDc] = React.useState<string | null>(null)
  const domain = tree.data?.domain
  const value = dc ?? settings.data?.defaultPreferredDc ?? ''
  const options = React.useMemo(() => {
    const o = (domain?.domainControllers ?? []).map((d) => ({
      value: d.name,
      hint: [d.site ? `Standort ${d.site}` : null, d.isGlobalCatalog ? 'Globaler Katalog' : null].filter(Boolean).join(' · ') || 'Domänencontroller',
      icon: <Server className="size-4 text-muted-foreground" />,
    }))
    for (const x of dcOptions) if (!o.some((y) => y.value.toLowerCase() === x.value.toLowerCase())) o.push({ ...x, hint: x.hint ?? '', icon: <Server className="size-4 text-muted-foreground" /> })
    return o
  }, [domain, dcOptions])

  const save = useMutation({
    mutationFn: async () => {
      const { frameworkPath: _f, pwshPath: _p, ...rest } = settings.data!
      return api.settings.update({ ...rest, defaultPreferredDc: value.trim() })
    },
    onSuccess: (s) => {
      qc.setQueryData(settingsQuery.queryKey, s)
      toast.success('Domänencontroller gespeichert', { description: s.defaultPreferredDc })
      onNext()
    },
    onError: (e) => toast.error('Nicht gespeichert', { description: errorMessage(e) }),
  })

  return (
    <StepCard icon={<Network />} title="Domäne erkennen" description="Die Domäne, in der der Dienst läuft, und der Domänencontroller für Planungen, Deploys und Audits.">
      {tree.isLoading ? (
        <Skeleton className="h-28" />
      ) : domain ? (
        <>
          {tree.data?.source === 'Testdaten' && <p className="mb-3 text-[13px] text-amber-700 dark:text-amber-300">Entwicklungsmodus: Es werden Testdaten angezeigt.</p>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="DNS-Name" value={domain.dnsName} />
            <Fact label="NetBIOS-Name" value={domain.netBiosName} />
            <Fact label="Distinguished Name" value={domain.distinguishedName} mono />
            <Fact label="Domänenfunktionsebene" value={levelText(domain.domainFunctionalLevel)} />
            <Fact label="Gesamtstruktur" value={`${domain.forestName} (${levelText(domain.forestFunctionalLevel)})`} />
            <Fact label="Domänencontroller" value={domain.domainControllers.length} />
          </div>
        </>
      ) : (
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>{tree.data?.message ?? 'Die Domäne konnte nicht erkannt werden.'} Den Domänencontroller können Sie trotzdem angeben.</p>
        </div>
      )}
      <div className="mt-5 grid max-w-xl gap-3">
        <Field label="Bevorzugter Domänencontroller" htmlFor="setup-dc" hint="Wird als Vorgabe für alle Läufe gespeichert (Einstellungen).">
          <Combobox id="setup-dc" value={value} onChange={setDc} options={options} placeholder="Domänencontroller wählen" searchPlaceholder="DC suchen oder eingeben …" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={!value.trim() || !settings.data || save.isPending}>
            Speichern und weiter <ArrowRight />
          </Button>
          <Button variant="ghost" onClick={onNext}>Ohne Änderung weiter</Button>
        </div>
      </div>
    </StepCard>
  )
}

// ---------------------------------------------------------------- 2 structure and prefix

function StructureStep() {
  const ous = (useSectionContent('ous')?.organizationUnits ?? []) as OuItem[]
  const groups = (useSectionContent('groups')?.groups ?? []) as Json[]
  const gpos = useSectionContent('gpos')
  const counts = React.useMemo(() => {
    const c = [0, 1, 2].map((t) => ({ tier: t as 0 | 1 | 2, ous: 0, groups: 0, gpos: 0 }))
    for (const o of ous) {
      const t = tierOf(`${o.name},${o.path}`)
      if (t === 0 || t === 1 || t === 2) c[t].ous++
    }
    for (const g of groups) {
      const t = tierOf(g.name ?? g.samaccountname)
      if (t === 0 || t === 1 || t === 2) c[t].groups++
    }
    const names = new Set<string>()
    for (const v of Object.values((gpos?.gpos ?? {}) as Record<string, Json>))
      for (const list of Object.values(v ?? {})) if (Array.isArray(list)) list.forEach((g: Json) => g?.name && names.add(g.name))
    for (const n of names) {
      const t = tierOf(n)
      if (t === 0 || t === 1 || t === 2) c[t].gpos++
    }
    return c
  }, [ous, groups, gpos])

  return (
    <div className="grid min-w-0 gap-4 [&>*]:min-w-0">
      <StepCard icon={<Sparkles />} title="Vorgeschlagene Tier-Struktur" description="So legt der erste Deploy die OUs an. Anpassen können Sie die Struktur jederzeit unter Konfiguration › Organisationseinheiten.">
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          {counts.map((c) => (
            <div key={c.tier} className="rounded-lg border bg-card px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[13px] font-medium"><TierDot tier={c.tier} /> Tier {c.tier}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{c.ous} OUs · {c.groups} Gruppen · {c.gpos} GPOs</p>
            </div>
          ))}
        </div>
        <div className="max-h-96 overflow-auto rounded-lg border p-2 sm:p-3">
          <OuTree ous={ous} defaultExpandedDepth={2} />
        </div>
      </StepCard>
      <PrefixCard />
    </div>
  )
}

function PrefixCard() {
  const [prefix, setPrefix] = React.useState('')
  const [preview, setPreview] = React.useState<PrefixPreview | null>(null)
  const run = useMutation({
    mutationFn: () => api.setup.prefixPreview(prefix.trim()),
    onSuccess: setPreview,
    onError: (e) => toast.error('Keine Vorschau', { description: errorMessage(e) }),
  })
  const apply = () => {
    if (!preview) return
    const map = new Map(preview.renames.map((r) => [r.from, r.to]))
    const gpos = draftStore.current('gpos')
    const winlaps = draftStore.current('winlaps')
    const rename = (g: Json) => {
      if (!g || typeof g !== 'object') return g
      const n = { ...g }
      for (const f of ['name', 'rename']) if (typeof n[f] === 'string' && map.has(n[f])) n[f] = map.get(n[f])
      return n
    }
    const nextGpos = {
      ...gpos,
      gpos: Object.fromEntries(
        Object.entries((gpos?.gpos ?? {}) as Record<string, Json>).map(([target, byKind]) => [
          target,
          Object.fromEntries(Object.entries(byKind ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(rename) : v])),
        ]),
      ),
    }
    const changes: Record<string, Json> = { gpos: nextGpos }
    if (winlaps && Array.isArray(winlaps.winLapsDelegations))
      changes.winlaps = {
        ...winlaps,
        winLapsDelegations: winlaps.winLapsDelegations.map((w: Json) => (w?.decryptorGpoName && map.has(w.decryptorGpoName) ? { ...w, decryptorGpoName: map.get(w.decryptorGpoName) } : w)),
      }
    draftStore.apply(changes)
    toast.success(`${preview.renames.length} Namen im Entwurf geändert`, { description: 'Zum Übernehmen speichern.' })
    setPreview(null)
  }
  const shown = preview?.renames.slice(0, 8) ?? []
  const lapsCount = preview?.renames.filter((r) => r.section === 'winlaps').length ?? 0

  return (
    <StepCard
      icon={<Tag />}
      title="Namenspräfix der GPOs"
      description={<>Die mitgelieferten GPO-Namen beginnen mit dem Platzhalter <span className="font-medium text-foreground">„*-“</span>, z. B. „*- Tier 0 DCs SOE - Computer“. Ersetzen Sie ihn durch ein eigenes Präfix wie „CONTOSO -“. Optional.</>}
    >
      <form
        className="flex max-w-xl flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (prefix.trim()) run.mutate()
        }}
      >
        <Field label="Neues Präfix" htmlFor="setup-prefix" className="min-w-48 flex-1" hint="Höchstens 20 Zeichen, ohne \ / : * ? &quot; < > |">
          <Input id="setup-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="z. B. CONTOSO -" maxLength={20} />
        </Field>
        <Button type="submit" variant="outline" disabled={!prefix.trim() || run.isPending} className="mb-5">Vorschau</Button>
      </form>
      {preview && (
        <div className="mt-2 grid gap-3">
          {preview.renames.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Kein GPO-Name beginnt mit „{preview.current}“ – es gibt nichts umzubenennen.</p>
          ) : (
            <>
              <p className="text-[13px]">
                „{preview.current}“ wird in <span className="font-medium">{preview.gpoCount} GPO-Namen</span>
                {preview.renames.length - preview.gpoCount - lapsCount > 0 && <> und {preview.renames.length - preview.gpoCount - lapsCount} Umbenennungen</>}
                {lapsCount > 0 && <> sowie {lapsCount} LAPS-{lapsCount === 1 ? 'Eintrag' : 'Einträgen'}</>} durch „{preview.prefix}“ ersetzt:
              </p>
              <ul className="grid gap-1.5">
                {shown.map((r, i) => (
                  <li key={i} className="grid gap-0.5 rounded-lg border px-3 py-2 text-[13px] sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-2">
                    <span className="min-w-0 break-words text-muted-foreground line-through decoration-muted-foreground/40">{r.from}</span>
                    <ArrowRight className="hidden size-3.5 text-muted-foreground sm:block" />
                    <span className="min-w-0 break-words font-medium">{r.to}</span>
                  </li>
                ))}
              </ul>
              {preview.renames.length > shown.length && <p className="text-xs text-muted-foreground">… und {preview.renames.length - shown.length} weitere.</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={apply}><Check /> Im Entwurf übernehmen</Button>
                <Button variant="ghost" onClick={() => setPreview(null)}>Verwerfen</Button>
              </div>
            </>
          )}
        </div>
      )}
    </StepCard>
  )
}

// ---------------------------------------------------------------- 3 existing OUs

function OusStep() {
  const compare = useAdCompare()
  const canEdit = useCan('Editor')
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const ous = useSectionContent('ous')
  const items = compare.data?.result?.items ?? []
  const extra = items.filter((i) => i.status === 'extra')
  const configured = new Set(((ous?.organizationUnits ?? []) as OuItem[]).map((o) => `${o.name}|${o.path}`.toLowerCase()))
  const adopted = (i: (typeof extra)[number]) => configured.has(`${i.name}|${i.suggestedPath}`.toLowerCase())

  return (
    <StepCard icon={<FolderInput />} title="Vorhandene OUs übernehmen" description="OUs, die es im Active Directory gibt, die aber nicht in der Konfiguration stehen. Übernommene OUs landen im Entwurf und werden erst beim Speichern Teil der Konfiguration.">
      {compare.isLoading ? (
        <Skeleton className="h-40" />
      ) : !compare.data?.available ? (
        <p className="text-[13px] text-muted-foreground">{compare.data?.message ?? 'Active Directory ist nicht verfügbar.'}</p>
      ) : extra.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><CircleCheck className="size-4 text-emerald-500" /> Im AD gibt es keine OUs außerhalb der Konfiguration.</p>
      ) : (
        <div className="grid gap-3">
          <ul className="grid gap-1.5">
            {extra.map((i) => {
              const done = adopted(i)
              const id = `adopt-${i.dn}`
              return (
                <li key={i.dn}>
                  <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-accent/40', picked.has(i.dn) && 'border-primary/40 bg-primary/5', done && 'opacity-60')}>
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      disabled={done || !canEdit}
                      checked={done || picked.has(i.dn)}
                      onCheckedChange={(c) => setPicked((s) => { const n = new Set(s); if (c) n.add(i.dn); else n.delete(i.dn); return n })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{i.name}</span>
                      <span className="block text-xs break-words text-muted-foreground">{adPath(i.dn, compare.data?.domain?.distinguishedName)}</span>
                      {i.differences.slice(1).map((d, k) => <span key={k} className="block text-xs text-muted-foreground">{d.text}</span>)}
                    </span>
                    {done ? <Badge variant="success">im Entwurf</Badge> : <CompareBadge status={i.status} />}
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!picked.size || !canEdit}
              onClick={() => {
                const n = adoptOus(extra.filter((i) => picked.has(i.dn)), items)
                setPicked(new Set())
                toast.success(n === 1 ? '1 OU in den Entwurf übernommen' : `${n} OUs in den Entwurf übernommen`, { description: 'Übergeordnete OUs werden bei Bedarf mit übernommen. Zum Übernehmen speichern.' })
              }}
            >
              <FolderInput /> Ausgewählte übernehmen{picked.size ? ` (${picked.size})` : ''}
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/konfiguration/ous?ansicht=vergleich">Vollständigen Vergleich öffnen</Link>
            </Button>
          </div>
        </div>
      )}
    </StepCard>
  )
}

// ---------------------------------------------------------------- 4 first plan

function PlanStep({ onFinish, finishing, onSave }: { onFinish: () => void; finishing: boolean; onSave: () => void }) {
  const settings = useQuery(settingsQuery)
  const dirty = useDirtyKeys()
  const [run, setRun] = React.useState<RunSummary | null>(null)
  const dc = settings.data?.defaultPreferredDc ?? ''
  const start = useMutation({
    mutationFn: () => api.runs.deploy({ preferredDc: dc, scope: 'FullDeployment', includeMsa: false, includeGmsa: false, includeDmsa: false, includeWinLaps: false, confirmApply: false, admlLanguage: settings.data?.admlLanguage }),
    onSuccess: (r) => {
      setRun(r)
      toast.success(`Planung #${r.id} gestartet`)
    },
    onError: (e) => toast.error('Planung nicht gestartet', { description: errorMessage(e) }),
  })
  return (
    <StepCard icon={<Rocket />} title="Erste Planung" description="Eine Planung ändert nichts im Active Directory. Sie zeigt, was ein vollständiger Deploy anlegen und ändern würde.">
      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Fact label="Domänencontroller" value={dc || 'nicht festgelegt'} />
          <Fact label="Bereich" value="Vollständig (ohne Add-ons)" />
        </div>
        {dirty.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
            <TriangleAlert className="size-4 shrink-0" />
            <p className="min-w-0 flex-1">Es gibt ungespeicherte Änderungen. Die Planung verwendet die gespeicherte Konfiguration.</p>
            <Button size="sm" variant="outline" onClick={onSave}><Save /> Jetzt speichern …</Button>
          </div>
        )}
        {run ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px]">
            <CircleCheck className="size-4 shrink-0 text-emerald-600" />
            <p className="min-w-0 flex-1">Planung #{run.id} läuft. Das Ergebnis erscheint in der Laufansicht.</p>
            <Button size="sm" variant="outline" asChild><Link to={`/laeufe/${run.id}`}>Planung öffnen <ArrowRight /></Link></Button>
          </div>
        ) : (
          <div>
            <Button onClick={() => start.mutate()} disabled={!dc || start.isPending}><Play /> Planung starten</Button>
            {!dc && <p className="mt-1.5 text-xs text-muted-foreground">Bitte zuerst im Schritt „Domäne“ einen Domänencontroller festlegen.</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button onClick={onFinish} disabled={finishing}><Check /> Einrichtung abschließen</Button>
        </div>
      </div>
    </StepCard>
  )
}
