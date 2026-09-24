import { lazy, Suspense } from 'react'
import { FullPageSpinner } from '@/components/layout/full-page-spinner'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { RequireAuth } from '@/features/auth/auth'
import { AppLayout } from '@/components/layout/app-layout'
import { RouteError } from '@/components/layout/route-error'

// Lazy route helper: every page module exports `Component`.
const page = (loader: () => Promise<{ Component: React.ComponentType }>) => ({ lazy: loader })

const routes: RouteObject[] = [
  {
    path: '/login',
    ...page(() => import('@/features/auth/login-page')),
    errorElement: <RouteError />,
  },
  {
    path: '/passwort-aendern',
    element: (
      <RequireAuth>
        <PasswordRoute />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      { errorElement: <RouteError inline />, children: [
        { index: true, ...page(() => import('@/features/dashboard/dashboard-page')) },
        { path: 'konfiguration', element: <Navigate to="/konfiguration/ous" replace /> },
        { path: 'konfiguration/validierung', ...page(() => import('@/features/config/validation-page')) },
        { path: 'konfiguration/:key', ...page(() => import('@/features/config/config-page')) },
        { path: 'deploy', ...page(() => import('@/features/runs/deploy-page')) },
        { path: 'audits', ...page(() => import('@/features/runs/audits-page')) },
        { path: 'audits/zeitplaene', ...page(() => import('@/features/runs/audits-page')) },
        { path: 'privilegiert', ...page(() => import('@/features/privileged/privileged-page')) },
        { path: 'privilegiert/:tab', ...page(() => import('@/features/privileged/privileged-page')) },
        { path: 'laeufe', ...page(() => import('@/features/runs/runs-page')) },
        { path: 'laeufe/:id', ...page(() => import('@/features/runs/run-detail-page')) },
        { path: 'aenderungen', ...page(() => import('@/features/changelog/changelog-page')) },
        { path: 'berichte', ...page(() => import('@/features/reports/reports-page')) },
        { path: 'einrichtung', ...page(() => import('@/features/setup/setup-page')) },
        {
          path: 'admin',
          element: <RequireAuth role="Admin"><Navigate to="/admin/benutzer" replace /></RequireAuth>,
        },
        { path: 'admin/benutzer', ...page(() => import('@/features/admin/users-page')) },
        { path: 'admin/einstellungen', ...page(() => import('@/features/admin/settings-page')) },
        { path: 'admin/windows-anmeldung', ...page(() => import('@/features/admin/windows-auth-page')) },
        { path: 'admin/entra-anmeldung', ...page(() => import('@/features/admin/entra-auth-page')) },
        { path: 'admin/benachrichtigungen', ...page(() => import('@/features/admin/notifications-page')) },
        { path: 'admin/systemzustand', ...page(() => import('@/features/admin/health-page')) },
        { path: 'admin/wartungsfenster', ...page(() => import('@/features/admin/maintenance-page')) },
        { path: 'api-tokens', ...page(() => import('@/features/auth/api-tokens-page')) },
        { path: '*', ...page(() => import('@/components/layout/not-found')) },
      ] },
    ],
  },
]

const ChangePasswordPage = lazy(() => import('@/features/auth/change-password-page').then((m) => ({ default: m.Component })))
function PasswordRoute() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <ChangePasswordPage />
    </Suspense>
  )
}

export const router = createBrowserRouter(routes)
