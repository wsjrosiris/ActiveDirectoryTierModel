import { queryOptions } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Section } from '@/api/types'
import { draftStore } from './draft-store'

export const sectionsQuery = queryOptions({
  queryKey: ['config', 'sections'],
  queryFn: api.config.sections,
})

export function sectionQuery(key: string) {
  return queryOptions({
    queryKey: ['config', 'section', key],
    queryFn: async (): Promise<Section> => {
      const s = await api.config.section(key)
      draftStore.setBase(s)
      return s
    },
    staleTime: 60_000,
  })
}

export function versionsQuery(key: string) {
  return queryOptions({
    queryKey: ['config', 'versions', key],
    queryFn: () => api.config.versions(key),
  })
}

export const validationQuery = queryOptions({
  queryKey: ['config', 'validate'],
  queryFn: api.config.validate,
})
