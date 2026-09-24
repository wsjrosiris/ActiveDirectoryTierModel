import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

export function Component() {
  return (
    <div className="grid place-content-center px-6 py-24">
      <div className="flex max-w-md flex-col items-center text-center">
        <p className="bg-gradient-to-b from-foreground to-muted-foreground/40 bg-clip-text text-7xl font-bold tracking-tighter text-transparent">404</p>
        <div className="mt-6 flex items-center gap-2 text-base font-semibold">
          <Compass className="size-4 text-muted-foreground" /> {t('layout.notFound.pageNotFound')}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('layout.notFound.theRequestedPageDoesNot')}
        </p>
        <Button className="mt-6" asChild>
          <Link to="/">{t('layout.notFound.backToTheDashboard')}</Link>
        </Button>
      </div>
    </div>
  )
}
