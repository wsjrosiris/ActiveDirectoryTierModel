import { QueryCache, QueryClient, MutationCache } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.userMessage
  if (e instanceof Error) return e.message
  return 'Unbekannter Fehler'
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false
        return count < 2
      },
    },
  },
  queryCache: new QueryCache({
    onError: (err, query) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return
      if (query.meta?.silent) return
      if (query.state.data !== undefined) toast.error('Aktualisierung fehlgeschlagen', { description: errorMessage(err) })
    },
  }),
  mutationCache: new MutationCache({
    onError: (err, _v, _c, mutation) => {
      if (mutation.meta?.silent) return
      if (err instanceof ApiError && err.status === 401) return
      toast.error(err instanceof ApiError ? err.title : 'Fehler', {
        description: err instanceof ApiError ? (err.detail ?? undefined) : errorMessage(err),
      })
    },
  }),
})
