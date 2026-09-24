import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Page, PageHeader } from '@/components/shared/page-header'
import { sectionFallbackTitles } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { useDirtyKeys } from './draft-store'
import { validationQuery } from './queries'
import { currentLocale, t } from '@/i18n'

export function Component() {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery(validationQuery)
  const [sev, setSev] = React.useState<'all' | 'Error' | 'Warning'>('all')
  const dirty = useDirtyKeys()
  const issues = data ?? []
  const errors = issues.filter((i) => i.severity === 'Error').length
  const warnings = issues.length - errors
  const filtered = sev === 'all' ? issues : issues.filter((i) => i.severity === sev)
  const bySection = React.useMemo(() => {
    const m = new Map<string, typeof filtered>()
    filtered.forEach((i) => {
      if (!m.has(i.section)) m.set(i.section, [])
      m.get(i.section)!.push(i)
    })
    return [...m.entries()]
  }, [filtered])

  return (
    <Page>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2 text-muted-foreground">
        <Link to="/konfiguration"><ArrowLeft /> {t('config.validation.configuration')}</Link>
      </Button>
      <PageHeader
        title={t('config.validation.validation')}
        description={t('config.validation.consistencyCheckOfTheSaved')}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching}>
            {!isFetching && <RefreshCw />} {t('config.validation.checkAgain')}
          </Button>
        }
      />
      {dirty.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-900 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" />
          {t('config.validation.validationOnlyChecksSavedStates')} {dirty.map((k) => sectionFallbackTitles[k] ?? k).join(', ')} {t('config.validation.areNotTakenIntoAccount')}
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><XCircle className="size-4 text-rose-500" /> {t('config.validation.errors')}</p>
          <p className="mt-1 text-2xl font-semibold tabular">{isLoading ? '–' : errors}</p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><AlertTriangle className="size-4 text-amber-500" /> {t('config.validation.warnings')}</p>
          <p className="mt-1 text-2xl font-semibold tabular">{isLoading ? '–' : warnings}</p>
        </Card>
      </div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Segmented
          aria-label={t('config.validation.severity')}
          value={sev}
          onValueChange={setSev}
          options={[
            { value: 'all', label: t('config.validation.allLength', { length: issues.length }) },
            { value: 'Error', label: t('config.validation.errorsErrors', { errors }) },
            { value: 'Warning', label: t('config.validation.warningsWarnings', { warnings }) },
          ]}
        />
        {dataUpdatedAt > 0 && <span className="text-xs text-muted-foreground">{t('config.validation.checked')} {new Date(dataUpdatedAt).toLocaleTimeString(currentLocale())}</span>}
      </div>
      {isLoading ? (
        <Card className="grid gap-2 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 className="text-emerald-500" />}
            title={issues.length === 0 ? t('config.validation.noProblemsFound') : t('config.validation.noEntriesForThisFilter')}
            description={issues.length === 0 ? t('config.validation.theConfigurationIsConsistent') : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {bySection.map(([section, list]) => (
            <Card key={section} className="overflow-hidden">
              <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-2.5">
                <p className="text-[13px] font-medium">{sectionFallbackTitles[section] ?? section}</p>
                <Button variant="ghost" size="xs" asChild>
                  <Link to={`/konfiguration/${section}`}>{t('config.validation.open')}</Link>
                </Button>
              </div>
              <ul className="divide-y">
                {list.map((i, idx) => (
                  <li key={idx} className="flex items-start gap-3 px-5 py-3">
                    {i.severity === 'Error' ? (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" aria-label={t('config.validation.error')} />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-label={t('config.validation.warning')} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]">{i.message}</p>
                      {i.item && <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{i.item}</p>}
                    </div>
                    <Badge variant={i.severity === 'Error' ? 'danger' : 'warning'} className={cn('shrink-0')}>
                      {i.severity === 'Error' ? t('config.validation.error') : t('config.validation.warning')}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}
