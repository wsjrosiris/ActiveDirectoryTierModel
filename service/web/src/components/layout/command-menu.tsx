import * as React from 'react'
import { Command } from 'cmdk'
import { useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  ArrowRight,
  FileJson2,
  FolderTree,
  KeyRound,
  LogOut,
  Moon,
  Rocket,
  ScanSearch,
  Search,
  ShieldCheck,
  Sun,
  User as UserIcon,
  Users,
  Download,
  CheckCircle2,
  ScrollText,
  ShieldUser,
  Server,
  UserPlus, Network } from 'lucide-react'
import { Dialog as D } from 'radix-ui'
import { api } from '@/api/client'
import { useOptionalDomains } from '@/features/domains/domain-context'
import { useCan, useLogout, useMe } from '@/features/auth/auth'
import { sectionQuery } from '@/features/config/queries'
import { hasRole } from '@/lib/roles'
import { sectionFallbackTitles } from '@/lib/labels'
import { ouFullDn, type OuItem } from '@/lib/ou'
import { tierOf } from '@/lib/tier'
import { useTheme } from '@/lib/theme'
import { downloadUrl } from '@/lib/utils'
import { TierDot } from '@/components/shared/badges'
import { DialogOverlay } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { adminNav, mainNav } from './nav'
import { t } from '@/i18n'

function Shell({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  label: string
  children: React.ReactNode
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <DialogOverlay className="bg-black/30 backdrop-blur-[1px]" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl shadow-black/20 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out"
        >
          <D.Title className="sr-only">{label}</D.Title>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

const itemCls =
  'group flex cursor-default items-center gap-3 rounded-md px-2.5 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'
const groupCls =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase'

function Footer({ hint }: { hint: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
      <span>{hint}</span>
      <span className="flex items-center gap-2">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t('layout.commandMenu.navigate')}</span>
        <span className="flex items-center gap-1"><Kbd>↵</Kbd> {t('layout.commandMenu.open')}</span>
        <span className="hidden items-center gap-1 sm:flex"><Kbd>Esc</Kbd> {t('layout.commandMenu.close')}</span>
      </span>
    </div>
  )
}

interface SearchEntry {
  id: string
  group: string
  label: string
  hint?: string
  keywords: string
  to: string
  icon: React.ReactNode
}

const SEARCH_SECTIONS = ['ous', 'groups', 'users', 'acls', 'gpos'] as const

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const [search, setSearch] = React.useState('')
  const results = useQueries({
    queries: SEARCH_SECTIONS.map((k) => ({ ...sectionQuery(k), enabled: open })),
  })
  const loading = results.some((r) => r.isLoading)
  const [ous, groups, users, acls, gpos] = results.map((r) => r.data?.content)

  const entries = React.useMemo<SearchEntry[]>(() => {
    const list: SearchEntry[] = []
    ;((ous?.organizationUnits ?? []) as OuItem[]).forEach((o, i) => {
      const dn = ouFullDn(o)
      list.push({
        id: `ou-${i}`, group: t('layout.commandMenu.organizationalUnits'), label: o.name, hint: dn, keywords: `${o.comment ?? ''}`,
        to: `/konfiguration/ous?edit=${i}`, icon: <TierDot tier={tierOf(dn)} className="mx-1" />,
      })
    })
    ;(groups?.groups ?? []).forEach((g: Record<string, string>, i: number) =>
      list.push({
        id: `g-${i}`, group: t('layout.commandMenu.groups'), label: g.name, hint: g.samaccountname, keywords: `${g.description ?? ''} ${g.path ?? ''}`,
        to: `/konfiguration/groups?edit=${i}`, icon: <Users />,
      }),
    )
    ;(users?.users ?? []).forEach((u: Record<string, string>, i: number) =>
      list.push({
        id: `u-${i}`, group: t('layout.commandMenu.users'), label: u.samAccountName, hint: u.ouPath, keywords: `${u.displayName ?? ''} ${u.description ?? ''}`,
        to: `/konfiguration/users?edit=${i}`, icon: <UserIcon />,
      }),
    )
    ;(acls?.aclDelegations ?? []).forEach((a: Record<string, unknown>, i: number) =>
      list.push({
        id: `a-${i}`, group: t('layout.commandMenu.aclDelegations'), label: `${a.identityreference} · ${(a.activedirectoryrights as string[] | undefined)?.join(', ') ?? ''}`,
        hint: `${a.objecttype || t('layout.commandMenu.allObjects')} → ${a.targetOUPath}`, keywords: `${a.comment ?? ''}`,
        to: `/konfiguration/acls?edit=${i}`, icon: <ShieldCheck />,
      }),
    )
    const gpoMap = gpos?.gpos as Record<string, Record<string, unknown>> | undefined
    if (gpoMap) {
      for (const [dn, entry] of Object.entries(gpoMap)) {
        for (const kind of ['ImportOnlyGpo', 'PostConfigureGpo']) {
          const arr = entry?.[kind]
          if (!Array.isArray(arr)) continue
          arr.forEach((g: Record<string, unknown>, i: number) =>
            list.push({
              id: `gpo-${dn}-${kind}-${i}`, group: t('layout.commandMenu.groupPolicies'), label: String(g.name ?? ''), hint: dn,
              keywords: `${g.gpoComment ?? ''}`.slice(0, 200), to: `/konfiguration/gpos?ou=${encodeURIComponent(dn)}`, icon: <ScrollText />,
            }),
          )
        }
      }
    }
    return list
  }, [ous, groups, users, acls, gpos])

  const pages = [...mainNav, ...adminNav].filter((p) => !p.role || hasRole(me?.user?.role, p.role))
  const grouped = React.useMemo(() => {
    const m = new Map<string, SearchEntry[]>()
    for (const e of entries) {
      if (!m.has(e.group)) m.set(e.group, [])
      m.get(e.group)!.push(e)
    }
    return [...m.entries()]
  }, [entries])

  const go = (to: string) => {
    onOpenChange(false)
    setSearch('')
    navigate(to)
  }

  return (
    <Shell open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSearch('') }} label={t('layout.commandMenu.globalSearch')}>
      <Command loop className="flex flex-col" label={t('layout.commandMenu.globalSearch')}>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 text-muted-foreground" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder={t('layout.commandMenu.searchOusGroupsUsersAcls')}
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
          {loading && <span className="text-xs text-muted-foreground">{t('common.loading')}</span>}
        </div>
        <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain p-1.5">
          <Command.Empty className="py-12 text-center text-sm text-muted-foreground">
            {t('layout.commandMenu.noMatchesFor', { search })}
          </Command.Empty>
          <Command.Group heading={t('layout.commandMenu.pages')} className={groupCls}>
            {pages.map((p) => (
              <Command.Item key={p.to} value={`${t('layout.commandMenu.kw.page')} ${p.label} ${p.keywords ?? ''}`} onSelect={() => go(p.to)} className={itemCls}>
                <p.icon />
                <span>{p.label}</span>
                <ArrowRight className="ml-auto opacity-0 group-data-[selected=true]:opacity-100" />
              </Command.Item>
            ))}
          </Command.Group>
          {search.trim().length > 0 &&
            grouped.map(([group, items]) => (
              <Command.Group key={group} heading={group} className={groupCls}>
                {items.map((e) => (
                  <Command.Item key={e.id} value={`${e.id} ${e.label} ${e.hint ?? ''} ${e.keywords}`} onSelect={() => go(e.to)} className={itemCls}>
                    {e.icon}
                    <div className="grid min-w-0 flex-1">
                      <span className="truncate">{e.label}</span>
                      {e.hint && <span className="truncate font-mono text-[11px] text-muted-foreground">{e.hint}</span>}
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
        </Command.List>
        <Footer hint={search ? t('layout.commandMenu.lengthObjectsSearched', { length: entries.length, count: entries.length }) : t('layout.commandMenu.tipStartTypingToSearch')} />
      </Command>
    </Shell>
  )
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const { resolved, setTheme } = useTheme()
  const logout = useLogout()
  const canEdit = useCan('Editor')
  const canOperate = useCan('Operator')
  const { data: me } = useMe()

  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }
  const pages = [...mainNav, ...adminNav].filter((p) => !p.role || hasRole(me?.user?.role, p.role))
  const domains = useOptionalDomains()

  return (
    <Shell open={open} onOpenChange={onOpenChange} label={t('layout.commandMenu.commandPalette')}>
      <Command loop className="flex flex-col" label={t('layout.commandMenu.commandPalette')}>
        <div className="flex items-center gap-2 border-b px-4">
          <span className="text-sm font-semibold text-muted-foreground">›</span>
          <Command.Input
            placeholder={t('layout.commandMenu.typeACommand')}
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
          <Command.Empty className="py-12 text-center text-sm text-muted-foreground">{t('layout.commandMenu.noMatchingCommand')}</Command.Empty>
          <Command.Group heading={t('layout.commandMenu.actions')} className={groupCls}>
            {canEdit && (
              <Command.Item className={itemCls} onSelect={() => run(() => navigate('/deploy'))} value={t('layout.commandMenu.kw.newDeploy')}>
                <Rocket /> {t('layout.commandMenu.newDeployment')}
              </Command.Item>
            )}
            {canEdit && (
              <Command.Item className={itemCls} onSelect={() => run(() => navigate('/audits?start=1'))} value={t('layout.commandMenu.kw.audit')}>
                <ScanSearch /> {t('layout.commandMenu.startAudit')}
              </Command.Item>
            )}
            {canOperate && (
              <Command.Item className={itemCls} onSelect={() => run(() => navigate('/privilegiert?check=1'))} value={t('layout.commandMenu.kw.monitor')}>
                <ShieldUser /> {t('layout.commandMenu.checkPrivilegedGroupsNow')}
              </Command.Item>
            )}
            <Command.Item className={itemCls} onSelect={() => run(() => navigate('/konfiguration/validierung'))} value={t('layout.commandMenu.kw.validate')}>
              <CheckCircle2 /> {t('layout.commandMenu.validateConfiguration')}
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => downloadUrl(api.config.exportUrl))} value={t('layout.commandMenu.kw.export')}>
              <Download /> {t('layout.commandMenu.exportConfigurationZip')}
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => setTheme(resolved === 'dark' ? 'light' : 'dark'))} value={t('layout.commandMenu.kw.theme')}>
              {resolved === 'dark' ? <Sun /> : <Moon />} {resolved === 'dark' ? t('layout.commandMenu.toggleThemeLight') : t('layout.commandMenu.toggleThemeDark')}
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => navigate('/passwort-aendern'))} value={t('layout.commandMenu.kw.password')}>
              <KeyRound /> {t('common.changePassword')}
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => logout())} value={t('layout.commandMenu.kw.logout')}>
              <LogOut /> {t('common.signOut')}
            </Command.Item>
          </Command.Group>
          {domains?.multiple && (
            <Command.Group heading={t('layout.commandMenu.switchDomain')} className={groupCls}>
              {domains.enabled.filter((d) => d.key !== domains.current?.key).map((d) => (
                <Command.Item
                  key={d.key}
                  className={itemCls}
                  onSelect={() => run(() => void domains.switchTo(d.key))}
                  value={`${t('layout.commandMenu.kw.switchDomain')} ${d.displayName} ${d.dnsName} ${d.key}`}
                >
                  <Network /> {d.displayName}
                  {d.dnsName && <span className="ml-1 truncate text-xs text-muted-foreground">{d.dnsName}</span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {canEdit && (
            <Command.Group heading={t('layout.commandMenu.assistants')} className={groupCls}>
              <Command.Item className={itemCls} onSelect={() => run(() => navigate('/konfiguration/ous?assistent=server'))} value={t('layout.commandMenu.kw.serverWizard')}>
                <Server /> {t('layout.commandMenu.assistantAddNewServerArea')}
              </Command.Item>
              <Command.Item className={itemCls} onSelect={() => run(() => navigate('/konfiguration/users?assistent=konto'))} value={t('layout.commandMenu.kw.accountWizard')}>
                <UserPlus /> {t('layout.commandMenu.assistantNewAdminAccount')}
              </Command.Item>
              <Command.Item className={itemCls} onSelect={() => run(() => navigate('/konfiguration/acls?assistent=delegation'))} value={t('layout.commandMenu.kw.delegationWizard')}>
                <KeyRound /> {t('layout.commandMenu.assistantNewDelegation')}
              </Command.Item>
            </Command.Group>
          )}
          <Command.Group heading={t('layout.commandMenu.goTo')} className={groupCls}>
            {pages.map((p) => (
              <Command.Item key={p.to} className={itemCls} value={`${t('layout.commandMenu.kw.goTo')} ${p.label} ${p.keywords ?? ''}`} onSelect={() => run(() => navigate(p.to))}>
                <p.icon /> {p.label}
              </Command.Item>
            ))}
            {['ous', 'groups', 'users', 'acls', 'gpos', 'winlaps'].map((k) => (
              <Command.Item key={k} className={itemCls} value={`${t('layout.commandMenu.kw.configuration')} ${k} ${sectionFallbackTitles[k]}`} onSelect={() => run(() => navigate(`/konfiguration/${k}`))}>
                {k === 'ous' ? <FolderTree /> : <FileJson2 />} {t('layout.commandMenu.configuration')} {sectionFallbackTitles[k]}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
        <Footer hint={t('layout.commandMenu.commandPalette')} />
      </Command>
    </Shell>
  )
}
