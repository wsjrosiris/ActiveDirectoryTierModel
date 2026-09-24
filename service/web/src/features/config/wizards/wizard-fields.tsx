import * as React from 'react'
import { RadioGroup } from 'radix-ui'
import { TriangleAlert } from 'lucide-react'
import { Segmented } from '@/components/ui/segmented'
import { TierDot } from '@/components/shared/badges'
import { cn } from '@/lib/utils'
import { INHERITANCE_LABELS, objectTypeText, type AclTemplate, type TierNum } from './wizard-model'

/** German labels of Active Directory rights (technical name stays visible in the chip). */
export const RIGHT_LABELS: Record<string, string> = {
  GenericAll: 'Vollzugriff',
  GenericRead: 'Lesen',
  GenericWrite: 'Schreiben',
  CreateChild: 'Objekte erstellen',
  DeleteChild: 'Objekte löschen',
  ReadProperty: 'Eigenschaften lesen',
  WriteProperty: 'Eigenschaften schreiben',
  ExtendedRight: 'Erweitertes Recht',
  ListChildren: 'Inhalt auflisten',
  Delete: 'Löschen',
  DeleteTree: 'Unterstruktur löschen',
  WriteDacl: 'Berechtigungen ändern',
  WriteOwner: 'Besitzer ändern',
  Self: 'Validierte Schreibvorgänge',
}

export function TierPicker({ id, value, onChange, allowed = [0, 1, 2] }: { id?: string; value: TierNum; onChange: (t: TierNum) => void; allowed?: TierNum[] }) {
  return (
    <div id={id}>
      <Segmented
        aria-label="Tier"
        value={String(value) as '0' | '1' | '2'}
        onValueChange={(v) => onChange(Number(v) as TierNum)}
        options={allowed.map((t) => ({ value: String(t) as '0' | '1' | '2', label: `Tier ${t}`, icon: <TierDot tier={t} /> }))}
      />
    </div>
  )
}

export function RightsChips({ rights, className }: { rights: string[]; className?: string }) {
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {rights.map((r) => (
        <span key={r} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-1.5 py-0.5 text-[11.5px]" title={r}>
          {RIGHT_LABELS[r] ?? r}
          <span className="font-mono text-[10.5px] text-muted-foreground">{r}</span>
        </span>
      ))}
    </span>
  )
}

/** One ACL entry as a compact, readable line: object type · inheritance, then rights chips. */
export function AclTemplateLine({ t, allow = true }: { t: AclTemplate; allow?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-[12px] text-muted-foreground">
        <span className={cn('font-medium', allow ? 'text-foreground' : 'text-destructive')}>{allow ? 'Zulassen' : 'Verweigern'}</span> auf{' '}
        <span className="font-medium text-foreground">{objectTypeText(t.objecttype)}</span>
        {t.inheritedObjectType && <> (nur {objectTypeText(t.inheritedObjectType)})</>} · {INHERITANCE_LABELS[t.activeDirectorysecurityinheritance] ?? t.activeDirectorysecurityinheritance}
      </p>
      <RightsChips rights={t.activedirectoryrights} />
    </div>
  )
}

export function RadioCards({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  options: { value: string; title: string; description?: string; extra?: React.ReactNode }[]
}) {
  return (
    <RadioGroup.Root value={value} onValueChange={onChange} aria-label={label} className="grid gap-2">
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className="group grid gap-2 rounded-lg border bg-card px-3.5 py-3 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary/50 data-[state=checked]:bg-primary/5"
        >
          <span className="flex items-start gap-3">
            <span className="mt-0.5 grid size-4 shrink-0 place-content-center rounded-full border border-input bg-card group-data-[state=checked]:border-primary">
              <RadioGroup.Indicator className="size-2 rounded-full bg-primary" />
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="text-[13px] font-medium">{o.title}</span>
              {o.description && <span className="text-xs text-muted-foreground">{o.description}</span>}
            </span>
          </span>
          {o.extra && <span className="grid gap-2 pl-7">{o.extra}</span>}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}

/** Preview box for a distinguished name (shortened, with tier badge slot). */
export function DnPreview({ label, dn, badge }: { label: string; dn: string; badge?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="min-w-0 flex-1 font-mono text-[12px] break-all">{dn || '–'}</p>
        {badge}
      </div>
    </div>
  )
}

export function Callout({ tone = 'warning', children }: { tone?: 'warning' | 'info'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-xl border px-4 py-3 text-[13px]',
        tone === 'warning' ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200' : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-200',
      )}
      role="note"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export const shortDn = (dn: string) => (dn === '{{DOMAIN_DN}}' ? 'Domänenstamm' : dn.replace(/,\{\{DOMAIN_DN\}\}$/, ''))

/** Keeps wide children (chips of a MultiCombobox, long DNs) inside the column instead of widening the dialog. */
export function Contained({ children }: { children: React.ReactNode }) {
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] [&>div]:min-w-0 [&>div]:grid-cols-[minmax(0,1fr)]">{children}</div>
}
