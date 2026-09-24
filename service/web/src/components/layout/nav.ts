import { Activity, FileClock, LayoutDashboard, Rocket, ScanSearch, Settings2, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react'
import type { Role } from '@/api/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  role?: Role
  match?: string
  keywords?: string
}

export const mainNav: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, keywords: 'übersicht start home' },
  { to: '/konfiguration/ous', label: 'Konfiguration', icon: SlidersHorizontal, match: '/konfiguration', keywords: 'config ous gruppen acl gpo' },
  { to: '/deploy', label: 'Deploy', icon: Rocket, keywords: 'bereitstellen ausrollen anwenden whatif' },
  { to: '/audits', label: 'Audits', icon: ScanSearch, keywords: 'prüfung drift zeitplan' },
  { to: '/laeufe', label: 'Läufe', icon: Activity, keywords: 'runs jobs log warteschlange' },
  { to: '/aenderungen', label: 'Änderungsprotokoll', icon: FileClock, keywords: 'changelog audit log verlauf' },
]

export const adminNav: NavItem[] = [
  { to: '/admin/benutzer', label: 'Benutzer', icon: Users, role: 'Admin', keywords: 'konten rollen' },
  { to: '/admin/einstellungen', label: 'Einstellungen', icon: Settings2, role: 'Admin', keywords: 'settings dc sprache' },
]
