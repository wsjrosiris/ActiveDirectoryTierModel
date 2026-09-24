import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, ShieldUser } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { RunSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/label'
import { useDomainControllerOptions } from '@/features/config/lookups'
import { settingsQuery } from '@/features/runs/run-request-form'

/** "Jetzt prüfen": starts a monitor run with a domain controller prefilled from the settings. */
export function MonitorStartDialog({ open, onOpenChange, onStarted }: { open: boolean; onOpenChange: (o: boolean) => void; onStarted?: (run: RunSummary) => void }) {
  const settings = useQuery(settingsQuery)
  const dcOptions = useDomainControllerOptions()
  const [dc, setDc] = React.useState('')
  const qc = useQueryClient()
  React.useEffect(() => {
    if (open) setDc((v) => v || settings.data?.defaultPreferredDc || '')
  }, [open, settings.data])

  const start = useMutation({
    mutationFn: () => api.runs.monitor(dc.trim()),
    onSuccess: (run) => {
      toast.success(`Überwachung #${run.id} eingereiht`, { description: 'Die Ergebnisse erscheinen hier, sobald der Lauf abgeschlossen ist.' })
      qc.invalidateQueries({ queryKey: ['privileged'] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      onOpenChange(false)
      onStarted?.(run)
    },
  })
  const error = dc.trim() ? null : 'Bitte einen Domain Controller angeben.'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => { e.preventDefault(); if (!error) start.mutate() }} className="grid gap-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldUser className="size-4 text-muted-foreground" /> Privilegierte Gruppen prüfen</DialogTitle>
            <DialogDescription>
              Liest die Mitglieder der geschützten Gruppen und aller Tier-0-Gruppen aus der Konfiguration, prüft die Admin-Konten und die
              Berechtigungen auf Tier-0-Objekten. Im Active Directory wird nichts verändert.
            </DialogDescription>
          </DialogHeader>
          <Field label="Domain Controller" htmlFor="mon-dc" required hint={settings.data?.defaultPreferredDc ? `Standard: ${settings.data.defaultPreferredDc}` : undefined}>
            <Combobox
              id="mon-dc"
              mono
              value={dc}
              onChange={setDc}
              options={dcOptions}
              placeholder="dc01.contoso.local"
              searchPlaceholder="DC suchen oder FQDN eingeben …"
              emptyText="Keine Domain Controller gefunden – FQDN eingeben"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={!!error} loading={start.isPending}>{!start.isPending && <Play />} Jetzt prüfen</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
