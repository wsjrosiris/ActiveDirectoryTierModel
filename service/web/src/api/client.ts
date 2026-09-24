import type {
  ChangeEntry,
  ChangePasswordRequest,
  CreateUserRequest,
  Dashboard,
  DeployRequest,
  LoginRequest,
  LogResponse,
  MeResponse,
  Paged,
  ProblemDetails,
  RestoreRequest,
  RunDetail,
  RunKind,
  RunRequest,
  RunStatus,
  RunSummary,
  SaveSectionRequest,
  Schedule,
  ScheduleInput,
  Section,
  SectionSummary,
  Settings,
  SettingsUpdate,
  UpdateUserRequest,
  User,
  ValidationIssue,
  VersionInfo,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly title: string
  readonly detail?: string
  readonly errors?: Record<string, string[]>

  constructor(status: number, problem: ProblemDetails) {
    const title = problem.title || defaultTitle(status)
    super(problem.detail ? `${title}: ${problem.detail}` : title)
    this.name = 'ApiError'
    this.status = status
    this.title = title
    this.detail = problem.detail
    this.errors = problem.errors
  }

  /** Human readable, German message for toasts. */
  get userMessage(): string {
    if (this.errors) {
      const first = Object.values(this.errors).flat()[0]
      if (first) return first
    }
    return this.detail || this.title
  }
}

function defaultTitle(status: number): string {
  switch (status) {
    case 400: return 'Ungültige Anfrage'
    case 401: return 'Nicht angemeldet'
    case 403: return 'Keine Berechtigung'
    case 404: return 'Nicht gefunden'
    case 409: return 'Konflikt'
    case 423: return 'Konto gesperrt'
    case 0: return 'Server nicht erreichbar'
    default: return status >= 500 ? 'Serverfehler' : `Fehler ${status}`
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function readCookie(name: string): string | null {
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + '='))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

/** Paths under /api/auth never trigger the 401 redirect (login itself answers 401). */
function isAuthPath(path: string) {
  return path.startsWith('/api/auth/')
}

let onUnauthorized: () => void = () => {
  if (!location.pathname.startsWith('/login')) {
    const next = encodeURIComponent(location.pathname + location.search)
    location.assign(`/login?next=${next}`)
  }
}

/** Allows the app to swap the full-page redirect for a router navigation. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** Suppress the automatic redirect on 401. */
  noRedirect?: boolean
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (UNSAFE.has(method)) {
    const token = readCookie('XSRF-TOKEN')
    if (token) headers['X-XSRF-TOKEN'] = token
  }

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, { detail: 'Die Verbindung zum Server ist fehlgeschlagen.' })
  }

  if (res.status === 401 && !opts.noRedirect && !isAuthPath(path)) {
    onUnauthorized()
  }

  if (!res.ok) {
    let problem: ProblemDetails = {}
    const ct = res.headers.get('content-type') ?? ''
    try {
      if (ct.includes('json')) problem = (await res.json()) as ProblemDetails
      else {
        const text = await res.text()
        if (text) problem = { detail: text.slice(0, 300) }
      }
    } catch {
      /* ignore body parse errors */
    }
    throw new ApiError(res.status, problem)
  }

  if (res.status === 204 || res.status === 205) return undefined as T
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('json')) return undefined as T
  return (await res.json()) as T
}

const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal })
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body })
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body })
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

function qs(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const enc = encodeURIComponent

export const api = {
  auth: {
    me: () => request<MeResponse>('/api/auth/me', { noRedirect: true }),
    login: (body: LoginRequest) => post<User>('/api/auth/login', body),
    logout: () => post<void>('/api/auth/logout'),
    changePassword: (body: ChangePasswordRequest) => post<void>('/api/auth/change-password', body),
  },
  users: {
    list: () => get<User[]>('/api/users'),
    create: (body: CreateUserRequest) => post<User>('/api/users', body),
    update: (id: string, body: UpdateUserRequest) => put<User>(`/api/users/${enc(id)}`, body),
    resetPassword: (id: string, newPassword: string) =>
      post<void>(`/api/users/${enc(id)}/reset-password`, { newPassword }),
    unlock: (id: string) => post<void>(`/api/users/${enc(id)}/unlock`),
    remove: (id: string) => del<void>(`/api/users/${enc(id)}`),
  },
  config: {
    sections: () => get<SectionSummary[]>('/api/config/sections'),
    section: (key: string) => get<Section>(`/api/config/sections/${enc(key)}`),
    save: (key: string, body: SaveSectionRequest) => put<Section>(`/api/config/sections/${enc(key)}`, body),
    versions: (key: string) => get<VersionInfo[]>(`/api/config/sections/${enc(key)}/versions`),
    version: (key: string, version: number) =>
      get<Section>(`/api/config/sections/${enc(key)}/versions/${version}`),
    restore: (key: string, version: number, body: RestoreRequest) =>
      post<Section>(`/api/config/sections/${enc(key)}/versions/${version}/restore`, body),
    validate: () => get<ValidationIssue[]>('/api/config/validate'),
    exportUrl: '/api/config/export',
  },
  runs: {
    list: (p: { kind?: RunKind | ''; status?: RunStatus | ''; page?: number; pageSize?: number }) =>
      get<Paged<RunSummary>>(`/api/runs${qs({ kind: p.kind, status: p.status, page: p.page ?? 1, pageSize: p.pageSize ?? 25 })}`),
    deploy: (body: DeployRequest) => post<RunSummary>('/api/runs/deploy', body),
    audit: (body: RunRequest) => post<RunSummary>('/api/runs/audit', body),
    get: (id: number) => get<RunDetail>(`/api/runs/${id}`),
    log: (id: number, after: number, signal?: AbortSignal) =>
      get<LogResponse>(`/api/runs/${id}/log?after=${after}`, signal),
    cancel: (id: number) => post<void>(`/api/runs/${id}/cancel`),
  },
  schedules: {
    list: () => get<Schedule[]>('/api/schedules'),
    create: (body: ScheduleInput) => post<Schedule>('/api/schedules', body),
    update: (id: number, body: ScheduleInput) => put<Schedule>(`/api/schedules/${id}`, body),
    remove: (id: number) => del<void>(`/api/schedules/${id}`),
    run: (id: number) => post<RunSummary>(`/api/schedules/${id}/run`),
  },
  changelog: {
    list: (p: { entityType?: string; page?: number; pageSize?: number }) =>
      get<Paged<ChangeEntry>>(`/api/changelog${qs({ entityType: p.entityType, page: p.page ?? 1, pageSize: p.pageSize ?? 50 })}`),
  },
  dashboard: () => get<Dashboard>('/api/dashboard'),
  settings: {
    get: () => get<Settings>('/api/settings'),
    update: (body: SettingsUpdate | Settings) => put<Settings>('/api/settings', body),
  },
}
