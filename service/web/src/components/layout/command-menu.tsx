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
} from 'lucide-react'
import { Dialog as D } from 'radix-ui'
import { api } from '@/api/client'
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
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigieren</span>
        <span className="flex items-center gap-1"><Kbd>↵</Kbd> öffnen</span>
        <span className="hidden items-center gap-1 sm:flex"><Kbd>Esc</Kbd> schließen</span>
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
        id: `ou-${i}`, group: 'Organisationseinheiten', label: o.name, hint: dn, keywords: `${o.comment ?? ''}`,
        to: `/konfiguration/ous?edit=${i}`, icon: <TierDot tier={tierOf(dn)} className="mx-1" />,
      })
    })
    ;(groups?.groups ?? []).forEach((g: Record<string, string>, i: number) =>
      list.push({
        id: `g-${i}`, group: 'Gruppen', label: g.name, hint: g.samaccountname, keywords: `${g.description ?? ''} ${g.path ?? ''}`,
        to: `/konfiguration/groups?edit=${i}`, icon: <Users />,
      }),
    )
    ;(users?.users ?? []).forEach((u: Record<string, string>, i: number) =>
      list.push({
        id: `u-${i}`, group: 'Benutzer', label: u.samAccountName, hint: u.ouPath, keywords: `${u.displayName ?? ''} ${u.description ?? ''}`,
        to: `/konfiguration/users?edit=${i}`, icon: <UserIcon />,
      }),
    )
    ;(acls?.aclDelegations ?? []).forEach((a: Record<string, unknown>, i: number) =>
      list.push({
        id: `a-${i}`, group: 'ACL-Delegationen', label: `${a.identityreference} · ${(a.activedirectoryrights as string[] | undefined)?.join(', ') ?? ''}`,
        hint: `${a.objecttype || 'Alle Objekte'} → ${a.targetOUPath}`, keywords: `${a.comment ?? ''}`,
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
              id: `gpo-${dn}-${kind}-${i}`, group: 'Gruppenrichtlinien', label: String(g.name ?? ''), hint: dn,
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
    <Shell open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSearch('') }} label="Globale Suche">
      <Command loop className="flex flex-col" label="Globale Suche">
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 text-muted-foreground" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="OUs, Gruppen, Benutzer, ACLs, GPOs oder Seiten suchen …"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
          {loading && <span className="text-xs text-muted-foreground">Lädt …</span>}
        </div>
        <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain p-1.5">
          <Command.Empty className="py-12 text-center text-sm text-muted-foreground">
            Keine Treffer für „{search}“
          </Command.Empty>
          <Command.Group heading="Seiten" className={groupCls}>
            {pages.map((p) => (
              <Command.Item key={p.to} value={`seite ${p.label} ${p.keywords ?? ''}`} onSelect={() => go(p.to)} className={itemCls}>
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
        <Footer hint={search ? `${entries.length} Objekte durchsucht` : 'Tipp: Tippen, um die Konfiguration zu durchsuchen'} />
      </Command>
    </Shell>
  )
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const { resolved, setTheme } = useTheme()
  const logout = useLogout()
  const canEdit = useCan('Editor')
  const { data: me } = useMe()

  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }
  const pages = [...mainNav, ...adminNav].filter((p) => !p.role || hasRole(me?.user?.role, p.role))

  return (
    <Shell open={open} onOpenChange={onOpenChange} label="Befehlspalette">
      <Command loop className="flex flex-col" label="Befehlspalette">
        <div className="flex items-center gap-2 border-b px-4">
          <span className="text-sm font-semibold text-muted-foreground">›</span>
          <Command.Input
            placeholder="Befehl eingeben …"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
          <Command.Empty className="py-12 text-center text-sm text-muted-foreground">Kein passender Befehl</Command.Empty>
          <Command.Group heading="Aktionen" className={groupCls}>
            {canEdit && (
              <Command.Item className={itemCls} onSelect={() => run(() => navigate('/deploy'))} value="neuer deploy starten planen">
                <Rocket /> Neuer Deploy …
              </Command.Item>
            )}
            {canEdit && (
              <Command.Item className={itemCls} onSelect={() => run(() => navigate('/audits?start=1'))} value="audit starten prüfen">
                <ScanSearch /> Audit starten …
              </Command.Item>
            )}
            <Command.Item className={itemCls} onSelect={() => run(() => navigate('/konfiguration/validierung'))} value="konfiguration validieren validierung">
              <CheckCircle2 /> Konfiguration validieren
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => downloadUrl(api.config.exportUrl))} value="konfiguration exportieren zip download">
              <Download /> Konfiguration exportieren (ZIP)
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => setTheme(resolved === 'dark' ? 'light' : 'dark'))} value="design umschalten theme dark light hell dunkel">
              {resolved === 'dark' ? <Sun /> : <Moon />} Design umschalten ({resolved === 'dark' ? 'hell' : 'dunkel'})
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => navigate('/passwort-aendern'))} value="passwort ändern">
              <KeyRound /> Passwort ändern
            </Command.Item>
            <Command.Item className={itemCls} onSelect={() => run(() => logout())} value="abmelden logout">
              <LogOut /> Abmelden
            </Command.Item>
          </Command.Group>
          <Command.Group heading="Gehe zu" className={groupCls}>
            {pages.map((p) => (
              <Command.Item key={p.to} className={itemCls} value={`gehe zu ${p.label} ${p.keywords ?? ''}`} onSelect={() => run(() => navigate(p.to))}>
                <p.icon /> {p.label}
              </Command.Item>
            ))}
            {['ous', 'groups', 'users', 'acls', 'gpos', 'winlaps'].map((k) => (
              <Command.Item key={k} className={itemCls} value={`konfiguration ${k} ${sectionFallbackTitles[k]}`} onSelect={() => run(() => navigate(`/konfiguration/${k}`))}>
                {k === 'ous' ? <FolderTree /> : <FileJson2 />} Konfiguration: {sectionFallbackTitles[k]}
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
        <Footer hint="Befehlspalette" />
      </Command>
    </Shell>
  )
}
