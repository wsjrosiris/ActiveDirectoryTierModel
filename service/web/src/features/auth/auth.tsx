import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router'
import { api } from '@/api/client'
import type { Role, User } from '@/api/types'
import { hasRole } from '@/lib/roles'
import { FullPageSpinner } from '@/components/layout/full-page-spinner'

export const meQueryKey = ['auth', 'me'] as const

export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: () => api.auth.me(),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/** The logged-in user. Only use below <RequireAuth>. */
export function useUser(): User {
  const { data } = useMe()
  if (!data?.user) throw new Error('useUser outside authenticated area')
  return data.user
}

export function useCan(required: Role) {
  const { data } = useMe()
  return hasRole(data?.user?.role, required)
}

export function useLogout() {
  const qc = useQueryClient()
  return React.useCallback(async () => {
    try {
      await api.auth.logout()
    } catch {
      /* ignore */
    }
    qc.clear()
    qc.setQueryData(meQueryKey, { user: null })
    window.location.assign('/login')
  }, [qc])
}

export function RequireAuth({ children, role }: { children: React.ReactNode; role?: Role }) {
  const { data, isLoading, isError, refetch } = useMe()
  const location = useLocation()
  if (isLoading) return <FullPageSpinner />
  if (isError) return <FullPageSpinner error onRetry={() => refetch()} />
  const user = data?.user
  if (!user) {
    const next = location.pathname + location.search
    return <Navigate to={`/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
  }
  if (user.mustChangePassword && location.pathname !== '/passwort-aendern') {
    return <Navigate to="/passwort-aendern" replace />
  }
  if (role && !hasRole(user.role, role)) return <Navigate to="/" replace />
  return <>{children}</>
}
