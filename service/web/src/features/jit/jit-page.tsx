import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { History, KeyRound, ListChecks, Plus, Timer, UsersRound } from 'lucide-react'
import { jitApi, type JitRequest } from '@/api/jit'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { useCan } from '@/features/auth/auth'
import { splitRequests } from './jit-model'
import { PrerequisiteCard } from './jit-prerequisite'
import { RequestDialog } from './jit-request-dialog'
import { ActiveList, HistoryList, OpenList } from './jit-requests'
import { JitGroupsAdmin } from './jit-groups'

const tabs = ['anfragen', 'aktiv', 'verlauf', 'gruppen'] as const
type Tab = (typeof tabs)[number]

export const jitKeys = {
  overview: ['jit', 'overview'] as const,
  requests: ['jit', 'requests'] as const,
  groups: ['jit', 'groups'] as const,
}

/** Refresh quickly while something is on its way (grant/revoke run, prerequisite check). */
function busy(items: JitRequest[] | undefined) {
  return !!items?.some((r) => r.status === 'Approved' || (r.status === 'Active' && r.revokeRunId))
}

export function Component() {
  const { tab: tabParam } = useParams()
  const isAdmin = useCan('Admin')
  const isOperator = useCan('Operator')
  const tab: Tab = tabs.includes(tabParam as Tab) && (tabParam !== 'gruppen' || isAdmin) ? (tabParam as Tab) : 'anfragen'
  const navigate = useNavigate()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [scope, setScope] = React.useState<'all' | 'mine'>('all')

  const overview = useQuery({
    queryKey: jitKeys.overview,
    queryFn: jitApi.overview,
    refetchInterval: (q) => (q.state.data?.prerequisite.status === 'Running' ? 2000 : 60_000),
  })
  const requests = useQuery({
    queryKey: jitKeys.requests,
    queryFn: jitApi.requests,
    refetchInterval: (q) => (busy(q.state.data) ? 2000 : 15_000),
  })

  const all = requests.data ?? []
  const visible = isOperator && scope === 'mine' ? all.filter((r) => r.mine) : all
  const { open, active, history } = splitRequests(visible)
  const waitingForMe = all.filter((r) => r.canDecide).length
  const groups = overview.data?.groups ?? []
  const blocked = overview.data?.prerequisite.status === 'NotReady'

  return (
    <Page>
      <PageHeader
        icon={<Timer />}
        title="Befristeter Zugriff"
        description="Just-in-Time-Mitgliedschaft in privilegierten Gruppen – beantragt, von einer zweiten Person freigegeben und von Active Directory automatisch wieder entfernt."
        actions={
          <Button onClick={() => setDialogOpen(true)} disabled={!overview.data || groups.length === 0 || blocked}>
            <Plus /> Zugriff beantragen
          </Button>
        }
      />

      {overview.isLoading || !overview.data ? (
        <Skeleton className="mb-6 h-24" />
      ) : (
        <PrerequisiteCard overview={overview.data} />
      )}

      {overview.data && groups.length === 0 && (
        <p className="mb-6 rounded-lg border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
          Für Sie ist keine JIT-Gruppe freigegeben.{' '}
          {isAdmin ? 'Legen Sie unter „JIT-Gruppen“ fest, welche Gruppen befristet beantragt werden dürfen.' : 'Ein Administrator legt fest, welche Gruppen befristet beantragt werden dürfen.'}
        </p>
      )}

      <Tabs value={tab} onValueChange={(v) => navigate(v === 'anfragen' ? '/zugriff' : `/zugriff/${v}`, { replace: true })}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <TabsList className="max-w-full overflow-x-auto [scrollbar-width:none]">
            <TabsTrigger value="anfragen">
              <ListChecks /> Anfragen
              {(waitingForMe > 0 || open.length > 0) && (
                <span className={waitingForMe > 0 ? 'ml-1 rounded bg-amber-500/20 px-1.5 text-[11px] text-amber-800 tabular dark:text-amber-200' : 'ml-1 rounded bg-muted-foreground/15 px-1.5 text-[11px] tabular'}>
                  {waitingForMe > 0 ? waitingForMe : open.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="aktiv">
              <KeyRound /> Aktiv
              {active.length > 0 && <span className="ml-1 rounded bg-emerald-500/15 px-1.5 text-[11px] text-emerald-800 tabular dark:text-emerald-200">{active.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="verlauf"><History /> Verlauf</TabsTrigger>
            {isAdmin && <TabsTrigger value="gruppen"><UsersRound /> JIT-Gruppen</TabsTrigger>}
          </TabsList>
          {isOperator && tab !== 'gruppen' && (
            <Segmented<'all' | 'mine'>
              aria-label="Anträge"
              value={scope}
              onValueChange={setScope}
              options={[{ value: 'all', label: 'Alle' }, { value: 'mine', label: 'Eigene' }]}
            />
          )}
        </div>
        {requests.isLoading ? (
          <div className="grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        ) : (
          <>
            <TabsContent value="anfragen"><OpenList items={open} onRequest={groups.length > 0 && !blocked ? () => setDialogOpen(true) : undefined} /></TabsContent>
            <TabsContent value="aktiv"><ActiveList items={active} /></TabsContent>
            <TabsContent value="verlauf"><HistoryList items={history} /></TabsContent>
          </>
        )}
        {isAdmin && <TabsContent value="gruppen"><JitGroupsAdmin /></TabsContent>}
      </Tabs>

      {overview.data && <RequestDialog open={dialogOpen} onOpenChange={setDialogOpen} overview={overview.data} onCreated={() => navigate('/zugriff', { replace: true })} />}
    </Page>
  )
}
