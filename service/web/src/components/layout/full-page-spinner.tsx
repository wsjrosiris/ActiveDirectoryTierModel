import { Loader2, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from './logo'
import { t } from '@/i18n'

export function FullPageSpinner({ error, onRetry }: { error?: boolean; onRetry?: () => void }) {
  return (
    <div className="grid min-h-dvh place-content-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center">
        <Logo className="size-10" />
        {error ? (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <WifiOff className="size-4" /> {t('layout.fullPageSpinner.serverUnreachable')}
            </div>
            <Button variant="outline" size="sm" onClick={onRetry}>{t('layout.fullPageSpinner.tryAgain')}</Button>
          </>
        ) : (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('layout.fullPageSpinner.loading')} />
        )}
      </div>
    </div>
  )
}
