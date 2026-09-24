import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ArrowRight, Sparkles } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useCan } from '@/features/auth/auth'
import { t } from '@/i18n'

export const setupStateKey = ['setup', 'state'] as const

/** Dashboard hint for administrators while the configuration is still the shipped sample. */
export function SetupCard() {
  const isAdmin = useCan('Admin')
  const { data } = useQuery({ queryKey: setupStateKey, queryFn: api.setup.state, enabled: isAdmin, staleTime: 60_000 })
  if (!isAdmin || !data?.needed) return null
  return (
    <Card className="relative mb-4 overflow-hidden border-primary/30">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/[0.07] via-transparent to-transparent" />
      <div className="relative flex flex-wrap items-center gap-4 px-5 py-4">
        <span className="grid size-10 shrink-0 place-content-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{t('setup.setupCard.completeSetup')}</p>
          <p className="text-[13px] text-muted-foreground">
            {t('setup.setupCard.theConfigurationIsStillThe')}
          </p>
        </div>
        <Button asChild>
          <Link to="/einrichtung">{t('setup.setupCard.openAssistant')} <ArrowRight /></Link>
        </Button>
      </div>
    </Card>
  )
}
