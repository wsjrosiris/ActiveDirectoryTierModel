import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { AlertOctagon, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/api/client'
import { t } from '@/i18n'

export function RouteError({ inline }: { inline?: boolean }) {
  const err = useRouteError()
  const isChunk = err instanceof Error && /dynamically imported module|Failed to fetch|Importing a module/i.test(err.message)
  const title = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : isChunk
      ? t('layout.routeError.newVersionAvailable')
      : t('layout.routeError.somethingWentWrong')
  const detail = isChunk
    ? t('layout.routeError.theApplicationHasBeenUpdated')
    : err instanceof ApiError
      ? err.userMessage
      : err instanceof Error
        ? err.message
        : t('layout.routeError.unknownError')
  return (
    <div className={inline ? 'grid place-content-center px-6 py-24' : 'grid min-h-dvh place-content-center bg-background px-6'}>
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-5 grid size-12 place-content-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive">
          <AlertOctagon className="size-5" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        {import.meta.env.DEV && err instanceof Error && err.stack && (
          <pre className="mt-4 max-h-48 w-full overflow-auto rounded-md bg-muted p-3 text-left text-[11px]">{err.stack}</pre>
        )}
        <div className="mt-6 flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/">{t('layout.routeError.toTheDashboard')}</Link>
          </Button>
          <Button onClick={() => window.location.reload()}>
            <RotateCcw /> {t('layout.routeError.reload')}
          </Button>
        </div>
      </div>
    </div>
  )
}
