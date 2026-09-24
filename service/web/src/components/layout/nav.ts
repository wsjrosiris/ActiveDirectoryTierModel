import { Activity, Bell, CalendarRange, Cloud, FileText, Sparkles, ShieldUser, HeartPulse, FileClock, KeyRound, LayoutDashboard, Network, Rocket, ScanSearch, Settings2, SlidersHorizontal, Timer, Users, type LucideIcon } from 'lucide-react'
import type { Role } from '@/api/types'
import { t } from '@/i18n'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  role?: Role
  match?: string
  keywords?: string
}

export const mainNav: NavItem[] = [
  { to: '/', label: t('layout.nav.dashboard.label'), icon: LayoutDashboard, keywords: t('layout.nav.dashboard.keywords') },
  { to: '/konfiguration/ous', label: t('layout.nav.config.label'), icon: SlidersHorizontal, match: '/konfiguration', keywords: t('layout.nav.config.keywords') },
  { to: '/deploy', label: t('layout.nav.deploy.label'), icon: Rocket, keywords: t('layout.nav.deploy.keywords') },
  { to: '/audits', label: t('layout.nav.audits.label'), icon: ScanSearch, keywords: t('layout.nav.audits.keywords') },
  { to: '/privilegiert', label: t('layout.nav.privileged.label'), icon: ShieldUser, keywords: t('layout.nav.privileged.keywords') },
  { to: '/zugriff', label: t('layout.nav.jit.label'), icon: Timer, keywords: t('layout.nav.jit.keywords') },
  { to: '/laeufe', label: t('layout.nav.runs.label'), icon: Activity, keywords: t('layout.nav.runs.keywords') },
  { to: '/aenderungen', label: t('layout.nav.changelog.label'), icon: FileClock, keywords: t('layout.nav.changelog.keywords') },
  { to: '/berichte', label: t('layout.nav.reports.label'), icon: FileText, keywords: t('layout.nav.reports.keywords') },
]

export const adminNav: NavItem[] = [
  { to: '/admin/benutzer', label: t('layout.nav.users.label'), icon: Users, role: 'Admin', keywords: t('layout.nav.users.keywords') },
  { to: '/admin/windows-anmeldung', label: t('layout.nav.windowsAuth.label'), icon: KeyRound, role: 'Admin', keywords: t('layout.nav.windowsAuth.keywords') },
  { to: '/admin/entra-anmeldung', label: t('layout.nav.entraAuth.label'), icon: Cloud, role: 'Admin', keywords: t('layout.nav.entraAuth.keywords') },
  { to: '/admin/benachrichtigungen', label: t('layout.nav.notifications.label'), icon: Bell, role: 'Admin', keywords: t('layout.nav.notifications.keywords') },
  { to: '/admin/domaenen', label: t('layout.nav.domains.label'), icon: Network, role: 'Admin', keywords: t('layout.nav.domains.keywords') },
  { to: '/admin/wartungsfenster', label: t('layout.nav.maintenance.label'), icon: CalendarRange, role: 'Admin', keywords: t('layout.nav.maintenance.keywords') },
  { to: '/admin/einstellungen', label: t('layout.nav.settings.label'), icon: Settings2, role: 'Admin', keywords: t('layout.nav.settings.keywords') },
  { to: '/einrichtung', label: t('layout.nav.setup.label'), icon: Sparkles, role: 'Admin', keywords: t('layout.nav.setup.keywords') },
  { to: '/admin/systemzustand', label: t('layout.nav.health.label'), icon: HeartPulse, role: 'Admin', keywords: t('layout.nav.health.keywords') },
]
