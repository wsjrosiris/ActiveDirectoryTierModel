import { Link, useSearchParams } from 'react-router'
import { Activity, Rocket } from 'lucide-react'
import type { RunKind, RunStatus } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Page, PageHeader } from '@/components/shared/page-header'
import { useCan } from '@/features/auth/auth'
import { statusLabels } from '@/lib/labels'
import { RunsTable } from './runs-table'
import { t } from '@/i18n'

export function Component() {
  const [params, setParams] = useSearchParams()
  const kind = (params.get('kind') ?? '') as RunKind | ''
  const status = (params.get('status') ?? '') as RunStatus | ''
  const canEdit = useCan('Editor')
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }
  return (
    <Page wide>
      <PageHeader
        icon={<Activity />}
        title={t('runs.runs.runs')}
        description={t('runs.runs.allDeploymentsAuditsAndMonitoring')}
        actions={canEdit && <Button asChild><Link to="/deploy"><Rocket /> {t('runs.runs.newDeployment')}</Link></Button>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<string>
          aria-label={t('runs.runs.type')}
          value={kind || 'all'}
          onValueChange={(v) => set('kind', v === 'all' ? '' : v)}
          options={[
            { value: 'all', label: t('runs.runs.all') },
            { value: 'Deploy', label: t('runs.runs.deployments') },
            { value: 'Audit', label: t('runs.runs.audits') },
            { value: 'Monitor', label: t('runs.runs.monitoringRuns') },
          ]}
        />
        <div className="w-52">
          <Select
            aria-label={t('common.status')}
            size="sm"
            value={status || 'all'}
            onValueChange={(v) => set('status', v === 'all' ? '' : v)}
            options={[{ value: 'all', label: t('runs.runs.allStatuses') }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]}
          />
        </div>
      </div>
      <RunsTable kind={kind} status={status} />
    </Page>
  )
}
