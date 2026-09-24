import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { AlertTriangle, FlaskConical, Info, Rocket, ShieldAlert, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { RunRequest } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { Page, PageHeader } from '@/components/shared/page-header'
import { useCan } from '@/features/auth/auth'
import { useDirtyKeys } from '@/features/config/draft-store'
import { scopeLabels } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { emptyRunRequest, includesFromRequest, RunRequestFields, runRequestError } from './run-request-form'

type Mode = 'plan' | 'apply'

export function Component() {
  const canEdit = useCan('Editor')
  const canApply = useCan('Operator')
  const [req, setReq] = React.useState<RunRequest>(emptyRunRequest)
  const [mode, setMode] = React.useState<Mode>('plan')
  const confirm = useConfirm()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const dirty = useDirtyKeys()
  const error = runRequestError(req)

  const deploy = useMutation({
    mutationFn: (confirmApply: boolean) =>
      api.runs.deploy({ ...req, preferredDc: req.preferredDc.trim(), confirmApply }),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(`Deploy #${run.id} eingereiht`, { description: run.mode === 'Apply' ? 'Änderungen werden angewendet.' : 'Planungslauf (WhatIf).' })
      navigate(`/laeufe/${run.id}`)
    },
  })

  const submit = async () => {
    if (error) return
    if (mode === 'apply') {
      const ok = await confirm({
        title: 'Änderungen im Active Directory anwenden?',
        description: (
          <div className="grid gap-2">
            <p>
              Dieser Lauf verändert das produktive Active Directory über <span className="font-mono font-medium text-foreground">{req.preferredDc}</span>.
              Führen Sie vorher einen Planungslauf aus und prüfen Sie dessen Ausgabe.
            </p>
            <p className="text-foreground">
              Bereich: <strong>{req.scope ? scopeLabels[req.scope] : 'Nur Add-ons'}</strong>
              {includesFromRequest(req).length > 0 && <> · Add-ons: <strong>{includesFromRequest(req).join(', ')}</strong></>}
            </p>
          </div>
        ),
        confirmText: 'Jetzt anwenden',
        destructive: true,
        typeToConfirm: 'ANWENDEN',
      })
      if (!ok) return
      deploy.mutate(true)
    } else deploy.mutate(false)
  }

  return (
    <Page>
      <PageHeader
        icon={<Rocket />}
        title="Deploy"
        description="Soll-Konfiguration ins Active Directory übertragen – zuerst planen, dann anwenden."
      />
      {!canEdit && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          <Info className="size-4" /> Ihre Rolle (Betrachter) erlaubt keine Deploys.
        </div>
      )}
      {dirty.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-900 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" /> Es gibt ungespeicherte Konfigurationsänderungen. Deploys verwenden immer die zuletzt gespeicherte Version.
        </div>
      )}
      <form
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Modus</CardTitle>
                <CardDescription>Ein Planungslauf zeigt, was sich ändern würde, ohne das AD zu verändern.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div role="radiogroup" aria-label="Modus" className="grid gap-3 sm:grid-cols-2">
                <ModeCard
                  checked={mode === 'plan'}
                  onSelect={() => setMode('plan')}
                  icon={<FlaskConical />}
                  title="Planen (WhatIf)"
                  description="Simulation – keine Änderungen am AD"
                  tone="sky"
                  disabled={!canEdit}
                />
                <Tooltip content={canApply ? undefined : 'Erfordert die Rolle Operator'} disabled={canApply}>
                  <div>
                    <ModeCard
                      checked={mode === 'apply'}
                      onSelect={() => setMode('apply')}
                      icon={<Zap />}
                      title="Anwenden"
                      description={canApply ? 'Änderungen werden ins AD geschrieben' : 'Nur für Operatoren'}
                      tone="rose"
                      disabled={!canApply}
                    />
                  </div>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Parameter</CardTitle>
                <CardDescription>Ziel-DC, Bereich und optionale Add-ons</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <RunRequestFields value={req} onChange={setReq} idPrefix="deploy" disabled={!canEdit} />
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card className={cn('overflow-hidden', mode === 'apply' && 'border-rose-500/40')}>
            <div className={cn('h-1', mode === 'apply' ? 'bg-gradient-to-r from-rose-500 to-orange-500' : 'bg-gradient-to-r from-sky-500 to-indigo-500')} />
            <CardHeader>
              <CardTitle>Zusammenfassung</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <dl className="grid gap-2.5 text-[13px]">
                <Row label="Modus">{mode === 'apply' ? <span className="font-medium text-rose-600 dark:text-rose-400">Anwenden</span> : 'Planen (WhatIf)'}</Row>
                <Row label="Domain Controller"><span className="font-mono">{req.preferredDc || '–'}</span></Row>
                <Row label="Bereich">{req.scope ? scopeLabels[req.scope] : 'Kein Bereich'}</Row>
                <Row label="Add-ons">{includesFromRequest(req).join(', ') || '–'}</Row>
                {req.admlLanguage && <Row label="ADML-Sprache"><span className="font-mono">{req.admlLanguage}</span></Row>}
              </dl>
              {mode === 'apply' && (
                <div className="flex gap-2 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-xs text-rose-800 dark:text-rose-200">
                  <ShieldAlert className="size-4 shrink-0" />
                  Dieser Lauf ändert das Active Directory. Sie müssen die Ausführung mit „ANWENDEN“ bestätigen.
                </div>
              )}
              {error && canEdit && <p className="text-xs text-muted-foreground">{error}</p>}
              <Button
                type="submit"
                size="lg"
                variant={mode === 'apply' ? 'destructive' : 'default'}
                disabled={!canEdit || !!error}
                loading={deploy.isPending}
                className="w-full"
              >
                {!deploy.isPending && (mode === 'apply' ? <Zap /> : <FlaskConical />)}
                {mode === 'apply' ? 'Deploy anwenden …' : 'Planungslauf starten'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>
    </Page>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  )
}

function ModeCard({
  checked,
  onSelect,
  icon,
  title,
  description,
  tone,
  disabled,
}: {
  checked: boolean
  onSelect: () => void
  icon: React.ReactNode
  title: string
  description: string
  tone: 'sky' | 'rose'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border bg-card p-3.5 text-left transition-all outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked && tone === 'sky' && 'border-sky-500/50 bg-sky-500/5 ring-1 ring-sky-500/30 hover:bg-sky-500/5',
        checked && tone === 'rose' && 'border-rose-500/50 bg-rose-500/5 ring-1 ring-rose-500/30 hover:bg-rose-500/5',
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-content-center rounded-lg [&_svg]:size-4',
          tone === 'sky' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
        )}
      >
        {icon}
      </span>
      <span className="grid">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
