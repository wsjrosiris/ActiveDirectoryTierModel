import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { AlertTriangle, Info, Loader2, RefreshCw, SearchCheck, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { jitApi, type JitOverview } from '@/api/jit'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/label'
import { useDomainControllerOptions } from '@/features/config/lookups'
import { errorMessage } from '@/lib/query'
import { cn, formatDateTime, formatRelative } from '@/lib/utils'

/** State of the forest prerequisite (Privileged Access Management feature) with an explanation when it is missing. */
export function PrerequisiteCard({ overview }: { overview: JitOverview }) {
  const p = overview.prerequisite
  const [checkOpen, setCheckOpen] = React.useState(false)
  const checkButton = overview.canCheck && (
    <Button variant="outline" size="sm" onClick={() => setCheckOpen(true)} disabled={p.status === 'Running'}>
      {p.status === 'Running' ? <Loader2 className="animate-spin" /> : p.status === 'Unknown' ? <SearchCheck /> : <RefreshCw />}
      {p.status === 'Unknown' ? 'Jetzt prüfen' : 'Erneut prüfen'}
    </Button>
  )
  const checked = p.checkedAt && (
    <span title={formatDateTime(p.checkedAt)}>geprüft {formatRelative(p.checkedAt)}{p.dc && <> über <span className="font-mono">{p.dc}</span></>}</span>
  )

  let body: React.ReactNode
  if (p.status === 'Ready') {
    body = (
      <Row tone="emerald" icon={<ShieldCheck />} title="Voraussetzungen erfüllt" action={checkButton}>
        Privileged Access Management Feature ist aktiviert{p.forestMode && <>, Funktionsebene {p.forestMode}</>} – {checked}. Active Directory entfernt befristete Mitgliedschaften selbstständig.
      </Row>
    )
  } else if (p.status === 'NotReady') {
    body = (
      <div className="grid gap-4 p-5">
        <Row tone="rose" icon={<ShieldOff />} title="Privileged Access Management Feature ist nicht aktiviert" action={checkButton} bare>
          Befristete Gruppenmitgliedschaften (Time-to-Live) setzen dieses optionale Feature der Gesamtstruktur voraus – {checked}. Bis eine erneute Prüfung erfolgreich ist, können keine Anträge gestellt werden.
        </Row>
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-4 py-3 text-[13px]">
          <p className="font-medium">Der Dienst schaltet das Feature nicht ein – Hinweise:</p>
          <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-muted-foreground marker:text-rose-500">
            <li><span className="text-foreground">Das Aktivieren ist endgültig</span> und lässt sich nicht rückgängig machen. Es gilt für die gesamte Gesamtstruktur.</li>
            <li>
              Die Funktionsebene der Gesamtstruktur muss mindestens Windows Server 2016 sein
              {p.forestMode && <> (aktuell: <span className="font-mono text-foreground">{p.forestMode}</span>{p.forestLevelSufficient === false ? ' – zu niedrig' : ''})</>}.
            </li>
            <li>
              Ein Organisations-Administrator aktiviert das Feature nach eigener Prüfung, z. B. mit
              <code className="mt-1 block rounded-md border bg-muted/60 px-2 py-1.5 font-mono text-[12px] break-all text-foreground">
                Enable-ADOptionalFeature 'Privileged Access Management Feature' -Scope ForestOrConfigurationSet -Target contoso.com
              </code>
            </li>
            <li>Kerberos-Tickets von Mitgliedern einer befristeten Mitgliedschaft laufen spätestens mit der Mitgliedschaft ab.</li>
          </ul>
          {p.messages.length > 0 && (
            <div className="mt-3 border-t border-rose-500/20 pt-2">
              <p className="text-xs font-medium text-muted-foreground">Meldungen der Prüfung</p>
              <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
                {p.messages.map((m) => <li key={m} className="break-words">{m}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    )
  } else if (p.status === 'Running') {
    body = (
      <Row tone="sky" icon={<Loader2 className="animate-spin" />} title="Voraussetzungen werden geprüft …" action={checkButton}>
        Lesende Prüfung über <span className="font-mono">{p.dc}</span> – es wird nichts verändert.
        {p.runId && <> <Link to={`/laeufe/${p.runId}`} className="text-primary hover:underline">Lauf #{p.runId}</Link></>}
      </Row>
    )
  } else if (p.status === 'Error') {
    body = (
      <Row tone="rose" icon={<AlertTriangle />} title="Prüfung fehlgeschlagen" action={checkButton}>
        {p.error} {p.runId && <Link to={`/laeufe/${p.runId}`} className="text-primary hover:underline">Protokoll von Lauf #{p.runId}</Link>}
      </Row>
    )
  } else {
    body = (
      <Row tone="sky" icon={<Info />} title="Voraussetzungen noch nicht geprüft" action={checkButton}>
        Befristete Mitgliedschaften brauchen das <span className="text-foreground">Privileged Access Management Feature</span> und die Funktionsebene Windows Server 2016.
        Die Prüfung ist rein lesend.
      </Row>
    )
  }

  return (
    <>
      <Card className={cn('mb-6 overflow-hidden', p.status === 'NotReady' && 'border-rose-500/30')}>{body}</Card>
      <CheckDialog open={checkOpen} onOpenChange={setCheckOpen} defaultDc={p.dc ?? overview.defaultDc ?? ''} />
    </>
  )
}

const tones = {
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
}

function Row({ tone, icon, title, action, children, bare }: {
  tone: keyof typeof tones; icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode; bare?: boolean
}) {
  return (
    <div className={cn('flex flex-wrap items-start gap-x-4 gap-y-3', !bare && 'p-4 sm:px-5')}>
      <span className={cn('grid size-9 shrink-0 place-content-center rounded-lg [&_svg]:size-[18px]', tones[tone])}>{icon}</span>
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{children}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function CheckDialog({ open, onOpenChange, defaultDc }: { open: boolean; onOpenChange: (o: boolean) => void; defaultDc: string }) {
  const qc = useQueryClient()
  const dcOptions = useDomainControllerOptions()
  const [dc, setDc] = React.useState(defaultDc)
  React.useEffect(() => { if (open) setDc(defaultDc) }, [open, defaultDc])
  const check = useMutation({
    mutationFn: () => jitApi.check(dc.trim()),
    meta: { silent: true },
    onSuccess: () => {
      toast.success('Prüfung gestartet', { description: 'Das Ergebnis erscheint in wenigen Sekunden.' })
      qc.invalidateQueries({ queryKey: ['jit'] })
      onOpenChange(false)
    },
    onError: (e) => toast.error('Prüfung nicht möglich', { description: errorMessage(e) }),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (dc.trim()) check.mutate() }}>
          <DialogHeader>
            <DialogTitle>Voraussetzungen prüfen</DialogTitle>
            <DialogDescription>
              Liest, ob das Privileged Access Management Feature aktiviert ist und welche Funktionsebene die Gesamtstruktur hat. Es wird nichts verändert.
            </DialogDescription>
          </DialogHeader>
          <Field label="Domänencontroller" htmlFor="jit-check-dc" required>
            <Combobox id="jit-check-dc" value={dc} onChange={setDc} options={dcOptions} placeholder="z. B. dc01.contoso.com" searchPlaceholder="Domänencontroller suchen oder eingeben …" mono />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" loading={check.isPending} disabled={!dc.trim()}>{!check.isPending && <SearchCheck />} Prüfen</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
