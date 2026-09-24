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
        title="Läufe"
        description="Alle Deploy- und Audit-Läufe mit Status, Dauer und Protokoll."
        actions={canEdit && <Button asChild><Link to="/deploy"><Rocket /> Neuer Deploy</Link></Button>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<string>
          aria-label="Art"
          value={kind || 'all'}
          onValueChange={(v) => set('kind', v === 'all' ? '' : v)}
          options={[
            { value: 'all', label: 'Alle' },
            { value: 'Deploy', label: 'Deploys' },
            { value: 'Audit', label: 'Audits' },
          ]}
        />
        <div className="w-52">
          <Select
            aria-label="Status"
            size="sm"
            value={status || 'all'}
            onValueChange={(v) => set('status', v === 'all' ? '' : v)}
            options={[{ value: 'all', label: 'Alle Status' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]}
          />
        </div>
      </div>
      <RunsTable kind={kind} status={status} />
    </Page>
  )
}
