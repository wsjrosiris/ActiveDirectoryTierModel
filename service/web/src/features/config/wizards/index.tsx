import * as React from 'react'
import { useSearchParams } from 'react-router'
import { ChevronDown, KeyRound, Server, UserPlus, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useCan } from '@/features/auth/auth'
import { AdminAccountWizard } from './admin-account-wizard'
import { DelegationWizard } from './delegation-wizard'
import { ServerAreaWizard } from './server-area-wizard'
import { t } from '@/i18n'

/* Entry point of the configuration assistants: an "Assistent" menu for the config page header.
 * Assistants can also be opened by URL (?assistent=server|konto|delegation), e.g. from the command palette. */

export type WizardId = 'server' | 'konto' | 'delegation'

export const WIZARDS: { id: WizardId; label: string; description: string; icon: React.ReactNode; keywords: string }[] = [
  { id: 'server', label: t('config.wizards.index.addNewServerArea'), description: t('config.wizards.index.ouAdminGroupRightsAnd'), icon: <Server />, keywords: t('config.wizards.index.serverAreaOuGroupGpo') },
  { id: 'konto', label: t('config.wizards.index.newAdminAccount'), description: t('config.wizards.index.accountInTheTierOu'), icon: <UserPlus />, keywords: t('config.wizards.index.adminAccountUserProtectedUsers') },
  { id: 'delegation', label: t('config.wizards.index.newDelegation'), description: t('config.wizards.index.whoMayDoWhatOn'), icon: <KeyRound />, keywords: t('config.wizards.index.delegationAclRightsPermission') },
]


export function WizardMenu() {
  const canEdit = useCan('Editor')
  const [params, setParams] = useSearchParams()
  const [active, setActive] = React.useState<WizardId | null>(null)

  // Open from the URL once and remove the parameter again.
  const requested = params.get('assistent') as WizardId | null
  React.useEffect(() => {
    if (!requested) return
    if (canEdit && WIZARDS.some((w) => w.id === requested)) setActive(requested)
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.delete('assistent')
        return n
      },
      { replace: true },
    )
  }, [requested, canEdit, setParams])

  if (!canEdit) return null
  const close = () => setActive(null)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <WandSparkles /> {t('config.wizards.index.assistant')} <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>{t('config.wizards.index.guidedChangesInTheDraft')}</DropdownMenuLabel>
          {WIZARDS.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => setActive(w.id)} className="items-start py-2">
              <span className="mt-0.5">{w.icon}</span>
              <span className="grid gap-0.5">
                <span>{w.label}</span>
                <span className="text-xs text-muted-foreground">{w.description}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {active === 'server' && <ServerAreaWizard open onClose={close} />}
      {active === 'konto' && <AdminAccountWizard open onClose={close} />}
      {active === 'delegation' && <DelegationWizard open onClose={close} />}
    </>
  )
}
