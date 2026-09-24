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
import { t } from '@/i18n'

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
      toast.success(t('privileged.monitorStart.monitoringIdQueued', { id: run.id }), { description: t('privileged.monitorStart.theResultsAppearHereAs') })
      qc.invalidateQueries({ queryKey: ['privileged'] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      onOpenChange(false)
      onStarted?.(run)
    },
  })
  const error = dc.trim() ? null : t('privileged.monitorStart.pleaseEnterADomainController')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => { e.preventDefault(); if (!error) start.mutate() }} className="grid gap-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldUser className="size-4 text-muted-foreground" /> {t('privileged.monitorStart.checkPrivilegedGroups')}</DialogTitle>
            <DialogDescription>
              {t('privileged.monitorStart.readsTheMembersOfThe')}
            </DialogDescription>
          </DialogHeader>
          <Field label={t('privileged.monitorStart.domainController')} htmlFor="mon-dc" required hint={settings.data?.defaultPreferredDc ? t('privileged.monitorStart.defaultDefaultpreferreddc', { defaultPreferredDc: settings.data.defaultPreferredDc }) : undefined}>
            <Combobox
              id="mon-dc"
              mono
              value={dc}
              onChange={setDc}
              options={dcOptions}
              placeholder="dc01.contoso.local"
              searchPlaceholder={t('privileged.monitorStart.searchDcOrEnterFqdn')}
              emptyText={t('privileged.monitorStart.noDomainControllersFoundEnter')}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!!error} loading={start.isPending}>{!start.isPending && <Play />} {t('privileged.monitorStart.checkNow')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
