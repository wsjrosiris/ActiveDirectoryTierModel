import * as React from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronsLeft,
  Command,
  Hourglass,
  KeyRound,
  KeySquare,
  Laptop,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Search,
  Sun,
} from 'lucide-react'
import { api } from '@/api/client'
import { useLogout, useUser } from '@/features/auth/auth'
import { useDirtyKeys } from '@/features/config/draft-store'
import { useHotkey } from '@/hooks/use-hotkey'
import { useLocalStorage, useMediaQuery } from '@/hooks/use-local-storage'
import { hasRole, roleLabels } from '@/lib/roles'
import { useTheme } from '@/lib/theme'
import { cn, modKey } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Tooltip } from '@/components/ui/tooltip'
import { Wordmark } from './logo'
import { useDomains } from '@/features/domains/domain-context'
import { DomainSwitcher } from '@/features/domains/domain-switcher'
import { adminNav, mainNav, type NavItem } from './nav'
import { CommandPalette, GlobalSearch } from './command-menu'

export function useDashboardQuery() {
  return useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, refetchInterval: 15_000, meta: { silent: true } })
}

export function AppLayout() {
  const user = useUser()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const isTablet = useMediaQuery('(min-width: 768px)')
  const [collapsedPref, setCollapsed] = useLocalStorage('tm-sidebar-collapsed', false)
  const collapsed = isDesktop ? collapsedPref : true
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const location = useLocation()
  // Pages are mounted per domain: switching the domain starts every page fresh with the other domain's data.
  const { current } = useDomains()

  React.useEffect(() => setMobileOpen(false), [location.pathname])

  useHotkey('mod+k', () => { setPaletteOpen(false); setSearchOpen((o) => !o) }, { allowInInputs: true })
  useHotkey('mod+shift+p', () => { setSearchOpen(false); setPaletteOpen((o) => !o) }, { allowInInputs: true })
  useHotkey('/', () => setSearchOpen(true))
  useHotkey('mod+b', () => isDesktop && setCollapsed(!collapsedPref))

  return (
    <div className="flex min-h-dvh bg-background">
      {isTablet && (
        <aside
          className={cn(
            'sticky top-0 z-30 flex h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 ease-out',
            collapsed ? 'w-[60px]' : 'w-60',
          )}
        >
          <SidebarContent collapsed={collapsed} role={user.role} />
          {isDesktop && (
            <div className={cn('border-t p-2', collapsed && 'flex justify-center')}>
              <Tooltip content={collapsed ? `Seitenleiste ausklappen (${modKey}+B)` : `Einklappen (${modKey}+B)`} side="right">
                <Button
                  variant="ghost"
                  size={collapsed ? 'icon-sm' : 'sm'}
                  className={cn('text-muted-foreground', !collapsed && 'w-full justify-start')}
                  onClick={() => setCollapsed(!collapsedPref)}
                  aria-label={collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
                >
                  <ChevronsLeft className={cn('transition-transform', collapsed && 'rotate-180')} />
                  {!collapsed && 'Einklappen'}
                </Button>
              </Tooltip>
            </div>
          )}
        </aside>
      )}

      {!isTablet && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent className="left-0 right-auto w-72 max-w-[85vw] border-r border-l-0 bg-sidebar p-0 data-[state=open]:animate-overlay-in">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarContent collapsed={false} role={user.role} />
          </SheetContent>
        </Sheet>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onMenu={() => setMobileOpen(true)}
          showMenu={!isTablet}
          onSearch={() => setSearchOpen(true)}
          onPalette={() => setPaletteOpen(true)}
        />
        <main id="main" className="flex-1">
          <Outlet key={current?.key ?? ''} />
        </main>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

function SidebarContent({ collapsed, role }: { collapsed: boolean; role: import('@/api/types').Role }) {
  const dirty = useDirtyKeys().length > 0
  const { data } = useDashboardQuery()
  const active = (data?.queue.running ?? 0) + (data?.queue.queued ?? 0)
  const pending = hasRole(role, 'Operator') ? (data?.pendingApprovals?.length ?? 0) : 0
  const admin = adminNav.filter((i) => !i.role || hasRole(role, i.role))

  return (
    <>
      <div className={cn('flex h-14 shrink-0 items-center border-b px-3.5', collapsed && 'justify-center px-0')}>
        <NavLink to="/" className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Tier Model – Dashboard">
          <Wordmark collapsed={collapsed} />
        </NavLink>
      </div>
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Hauptnavigation">
        <ul className="grid gap-0.5">
          {mainNav.map((item) => (
            <SidebarLink
              key={item.to}
              item={item}
              collapsed={collapsed}
              indicator={
                item.match === '/konfiguration' && dirty ? (
                  <span className="size-2 rounded-full bg-amber-500 ring-2 ring-sidebar" aria-label="Ungespeicherte Änderungen" />
                ) : item.to === '/laeufe' && collapsed && pending > 0 ? (
                  <span className="size-2 rounded-full bg-amber-500 ring-2 ring-sidebar" aria-label={`${pending} Freigaben ausstehend`} />
                ) : item.to === '/laeufe' && (active > 0 || pending > 0) ? (
                  <span className="flex items-center gap-1">
                    {pending > 0 && (
                      <Tooltip content={`${pending} ${pending === 1 ? 'Freigabe' : 'Freigaben'} ausstehend`} side="right">
                        <span className="inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                          <Hourglass className="size-3" />
                          {pending}
                        </span>
                      </Tooltip>
                    )}
                    {active > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-full bg-sky-500/15 px-1.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                        <Loader2 className="size-3 animate-spin" />
                        {active}
                      </span>
                    )}
                  </span>
                ) : null
              }
            />
          ))}
        </ul>
        {admin.length > 0 && (
          <>
            <div className={cn('mt-5 mb-1.5 px-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase', collapsed && 'sr-only')}>
              Administration
            </div>
            {collapsed && <div className="mx-2 my-3 h-px bg-border" aria-hidden />}
            <ul className="grid gap-0.5">
              {admin.map((item) => (
                <SidebarLink key={item.to} item={item} collapsed={collapsed} />
              ))}
            </ul>
          </>
        )}
      </nav>
    </>
  )
}

function SidebarLink({ item, collapsed, indicator }: { item: NavItem; collapsed: boolean; indicator?: React.ReactNode }) {
  const location = useLocation()
  const isActive =
    item.to === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(item.match ?? item.to)
  const Icon = item.icon
  const link = (
    <NavLink
      to={item.to}
      aria-current={isActive ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        isActive && 'bg-card text-foreground shadow-xs ring-1 ring-border dark:bg-accent dark:ring-0',
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon className={cn('size-[18px] shrink-0 transition-colors', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {indicator && (
        <span className={cn(collapsed ? 'absolute top-1 right-1.5 [&>span:not(.size-2)]:hidden' : 'ml-auto')}>{indicator}</span>
      )}
    </NavLink>
  )
  return (
    <li>
      {collapsed ? (
        <Tooltip content={item.label} side="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </li>
  )
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? '')).toUpperCase()
}

function Topbar({
  onMenu,
  showMenu,
  onSearch,
  onPalette,
}: {
  onMenu: () => void
  showMenu: boolean
  onSearch: () => void
  onPalette: () => void
}) {
  const user = useUser()
  const logout = useLogout()
  const navigate = useNavigate()
  const { theme, setTheme, resolved, toggle } = useTheme()
  const { data } = useDashboardQuery()
  const running = data?.queue.running ?? 0
  const queued = data?.queue.queued ?? 0
  const pending = hasRole(user.role, 'Operator') ? (data?.pendingApprovals?.length ?? 0) : 0

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b sm:gap-3 bg-background/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:px-6">
      {showMenu && (
        <Button variant="ghost" size="icon-sm" onClick={onMenu} aria-label="Navigation öffnen">
          <Menu />
        </Button>
      )}
      <DomainSwitcher />
      <button
        type="button"
        onClick={onSearch}
        className="group flex h-9 w-full min-w-0 max-w-md items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors outline-none hover:border-input hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Suche öffnen"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">Suchen: OUs, Gruppen, ACLs, GPOs …</span>
        <span className="hidden items-center gap-0.5 sm:flex">
          <Kbd>{modKey}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        {pending > 0 && (
          <Tooltip content={`${pending} ${pending === 1 ? 'Deploy wartet' : 'Deploys warten'} auf Freigabe`}>
            <button
              type="button"
              onClick={() => navigate(pending === 1 ? `/laeufe/${data!.pendingApprovals[0].id}` : '/laeufe?status=AwaitingApproval')}
              className="hidden h-8 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-500/15 sm:inline-flex dark:text-amber-300"
            >
              <Hourglass className="size-3.5" />
              {pending} {pending === 1 ? 'Freigabe' : 'Freigaben'}
            </button>
          </Tooltip>
        )}
        {(running > 0 || queued > 0) && (
          <Tooltip content={`${running} laufend, ${queued} in Warteschlange`}>
            <button
              type="button"
              onClick={() => navigate('/laeufe')}
              className="hidden h-8 items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-500/15 sm:inline-flex dark:text-sky-300"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-500 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-sky-500" />
              </span>
              {running > 0 ? `${running} läuft` : `${queued} wartend`}
            </button>
          </Tooltip>
        )}
        <Tooltip content={`Befehlspalette (${modKey}+Umschalt+P)`}>
          <Button variant="ghost" size="icon-sm" onClick={onPalette} aria-label="Befehlspalette öffnen" className="text-muted-foreground">
            <Command />
          </Button>
        </Tooltip>
        <Tooltip content={resolved === 'dark' ? 'Helles Design' : 'Dunkles Design'}>
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Design umschalten" className="text-muted-foreground">
            {resolved === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="ml-1 flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="Benutzermenü"
            >
              <span className="grid size-8 place-content-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-xs font-semibold text-white ring-1 ring-border dark:from-slate-500 dark:to-slate-700">
                {initials(user.displayName || user.username)}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="px-2 py-2">
              <p className="truncate text-sm font-medium">{user.displayName || user.username}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user.username} · {roleLabels[user.role]}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Darstellung</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as typeof theme)}>
              <DropdownMenuRadioItem value="light"><Sun /> Hell</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark"><Moon /> Dunkel</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system"><Laptop /> System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/passwort-aendern')}>
              <KeyRound /> Passwort ändern
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate('/api-tokens')}>
              <KeySquare /> API-Tokens
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPalette()}>
              <Command /> Befehlspalette
              <DropdownMenuShortcut>{modKey}⇧P</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => logout()} destructive>
              <LogOut /> Abmelden
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
