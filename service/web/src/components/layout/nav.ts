import { Activity, Bell, ShieldUser, HeartPulse, FileClock, KeyRound, LayoutDashboard, Rocket, ScanSearch, Settings2, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react'
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
  { to: '/privilegiert', label: 'Privilegierte Zugriffe', icon: ShieldUser, keywords: 'überwachung tier 0 domain admins mitglieder hygiene angriffspfade monitor geschützte gruppen' },
  { to: '/laeufe', label: 'Läufe', icon: Activity, keywords: 'runs jobs log warteschlange' },
  { to: '/aenderungen', label: 'Änderungsprotokoll', icon: FileClock, keywords: 'changelog audit log verlauf' },
]

export const adminNav: NavItem[] = [
  { to: '/admin/benutzer', label: 'Benutzer', icon: Users, role: 'Admin', keywords: 'konten rollen' },
  { to: '/admin/windows-anmeldung', label: 'Windows-Anmeldung', icon: KeyRound, role: 'Admin', keywords: 'kerberos ntlm sso ad gruppen rollen domäne negotiate' },
  { to: '/admin/benachrichtigungen', label: 'Benachrichtigungen', icon: Bell, role: 'Admin', keywords: 'e-mail smtp teams webhook alarm notification' },
  { to: '/admin/einstellungen', label: 'Einstellungen', icon: Settings2, role: 'Admin', keywords: 'settings dc sprache freigabe vier-augen approval planung plan gültigkeit' },
  { to: '/admin/systemzustand', label: 'Systemzustand', icon: HeartPulse, role: 'Admin', keywords: 'health status zertifikat datenbank speicherplatz powershell version worker dienst ampel' },
]
