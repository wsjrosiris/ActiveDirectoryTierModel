import * as React from 'react'
import { Package, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import type { EditorProps } from './editors'
import { FormSection } from './form-helpers'
import { isPlainObject, mergeSubset, ObjectFields } from './object-form'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

export const VERSION_RE = /^\d+(\.\d+){1,3}([-+][0-9A-Za-z.-]+)?$/
const versionError = (v: string) => (!v.trim() ? 'Version erforderlich' : VERSION_RE.test(v.trim()) ? null : 'Format: 1.2.3 oder 1.0.1.0')

const MODULE_OPTIONS: ComboOption[] = [
  { value: 'ActiveDirectory', hint: 'RSAT: Active Directory-Modul', icon: <Package className="size-4 text-muted-foreground" /> },
  { value: 'GroupPolicy', hint: 'RSAT: Gruppenrichtlinienverwaltung', icon: <Package className="size-4 text-muted-foreground" /> },
  { value: 'Pester', hint: 'Test-Framework für PowerShell', icon: <Package className="size-4 text-muted-foreground" /> },
]

function VersionInput({ id, value, onChange, readOnly, label }: { id?: string; value: string; onChange: (v: string) => void; readOnly: boolean; label?: string }) {
  const err = versionError(value)
  return (
    <div className="grid gap-1">
      <Input id={id} aria-label={label} readOnly={readOnly} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!err || undefined} className="h-9 font-mono text-[12.5px]" placeholder="1.0.0" />
      {err && <span className="text-[11px] text-destructive">{err}</span>}
    </div>
  )
}

export function DependenciesEditor({ content, setContent, readOnly }: EditorProps) {
  const root: Record<string, Json> = isPlainObject(content) ? content : {}
  const modules: Record<string, Json> = isPlainObject(root.modules) ? root.modules : {}
  const set = (k: string, v: Json, tag?: string) => setContent({ ...root, [k]: v }, tag)
  const entries = Object.entries(modules)
  const [newName, setNewName] = React.useState('')
  const [newVersion, setNewVersion] = React.useState('')
  const dup = entries.some(([k]) => k.toLowerCase() === newName.trim().toLowerCase())
  const canAdd = !!newName.trim() && !dup && !versionError(newVersion)

  const renameModule = (from: string, to: string) => {
    if (!to || to === from || entries.some(([k]) => k.toLowerCase() === to.toLowerCase())) return
    const next: Record<string, Json> = {}
    for (const [k, v] of entries) next[k === from ? to : k] = v
    set('modules', next)
  }
  const add = () => {
    if (!canAdd) return
    set('modules', { ...modules, [newName.trim()]: newVersion.trim() })
    setNewName('')
    setNewVersion('')
  }

  const pesterErr = typeof root.pester === 'string' ? versionError(root.pester) : null
  const schemaErr = typeof root.schemaVersion === 'string' ? versionError(root.schemaVersion) : null
  const extra = Object.fromEntries(Object.entries(root).filter(([k]) => !['pester', 'modules', 'schemaVersion'].includes(k)))
  const available = MODULE_OPTIONS.filter((o) => !entries.some(([k]) => k.toLowerCase() === o.value.toLowerCase()))

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <FormSection title="Versionen" description="Mindestversionen, die das Framework vor dem Deploy prüft.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pester-Version" htmlFor="dep-pester" error={pesterErr ?? undefined} hint="Für die Tests des Frameworks">
              <Input id="dep-pester" readOnly={readOnly} className="font-mono" value={root.pester ?? ''} onChange={(e) => set('pester', e.target.value, 'dep-pester')} aria-invalid={!!pesterErr || undefined} placeholder="5.7.1" />
            </Field>
            <Field label="Schema-Version" htmlFor="dep-schema" error={schemaErr ?? undefined} hint="Version dieses Dateiformats">
              <Input id="dep-schema" readOnly={readOnly} className="font-mono" value={root.schemaVersion ?? ''} onChange={(e) => set('schemaVersion', e.target.value, 'dep-schema')} aria-invalid={!!schemaErr || undefined} placeholder="1.0.0" />
            </Field>
          </div>
        </FormSection>
      </Card>
      <Card className="p-5">
        <FormSection title="PowerShell-Module" description="Module mit Mindestversion, die auf dem ausführenden Server installiert sein müssen.">
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_36px] gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              <span>Modul</span>
              <span>Mindestversion</span>
              <span />
            </div>
            <div className="divide-y">
              {entries.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">Keine Module.</p>}
              {entries.map(([name, version], i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_36px] items-start gap-2 px-3 py-2">
                  <Combobox
                    value={name}
                    onChange={(v) => renameModule(name, v)}
                    options={[{ value: name, icon: <Package className="size-4 text-muted-foreground" /> }, ...available]}
                    disabled={readOnly}
                    mono
                    placeholder="Modul wählen"
                  />
                  <VersionInput value={String(version ?? '')} readOnly={readOnly} label={`Version von ${name}`} onChange={(v) => set('modules', { ...modules, [name]: v }, `dep-mod-${name}`)} />
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`${name} entfernen`}
                      onClick={() => {
                        const next = { ...modules }
                        delete next[name]
                        set('modules', next)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_36px] items-start gap-2 bg-muted/20 px-3 py-2">
                  <div className="grid gap-1">
                    <Combobox value={newName} onChange={setNewName} options={available} mono placeholder="Modul hinzufügen …" searchPlaceholder="Modulname suchen oder eingeben …" invalid={dup} />
                    {dup && <span className="text-[11px] text-destructive">Modul bereits vorhanden</span>}
                  </div>
                  <div className="grid gap-1">
                    <Input aria-label="Mindestversion" value={newVersion} onChange={(e) => setNewVersion(e.target.value)} placeholder="1.0" className="h-9 font-mono text-[12.5px]" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} aria-invalid={(!!newVersion && !!versionError(newVersion)) || undefined} />
                    {newVersion && versionError(newVersion) && <span className="text-[11px] text-destructive">{versionError(newVersion)}</span>}
                  </div>
                  <Button type="button" variant="outline" size="icon-xs" disabled={!canAdd} onClick={add} aria-label="Modul hinzufügen">
                    <Plus />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </FormSection>
      </Card>
      {Object.keys(extra).length > 0 && (
        <Card className="p-5">
          <h3 className="mb-4 text-[13px] font-semibold">Weitere Felder</h3>
          <ObjectFields value={extra} readOnly={readOnly} depth={1} idPrefix="dep-x" onChange={(x) => setContent(mergeSubset(root, extra, x))} />
        </Card>
      )}
    </div>
  )
}
