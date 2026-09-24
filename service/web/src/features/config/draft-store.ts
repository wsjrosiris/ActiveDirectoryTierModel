import * as React from 'react'
import type { Section } from '@/api/types'

/* A tiny global store holding local (unsaved) drafts for config sections, with a
 * shared undo/redo history. History entries are snapshots of the whole drafts map
 * so that multi-section operations (e.g. OU rename) undo atomically. Contents are
 * treated as immutable: every edit produces a new object.
 * Several domains (roadmap 17): every domain has its own drafts, bases and history;
 * switching the domain parks the current state and restores the other one. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
type Drafts = Record<string, Json>

/** Undo/redo snapshot: the drafts plus the server version each draft was started from. */
interface Snapshot {
  drafts: Drafts
  draftBase: Record<string, number>
}

interface State {
  bases: Record<string, Section>
  drafts: Drafts
  /** Server version a draft was started from. Sent as baseVersion so the server
   *  detects concurrent saves even after a background refetch replaced the base. */
  draftBase: Record<string, number>
  past: Snapshot[]
  future: Snapshot[]
  lastTag: string | null
  lastAt: number
}

/** Sections whose JSON editor currently holds text that does not parse (not part of history). */
const invalidJson = new Set<string>()

const emptyState = (): State => ({ bases: {}, drafts: {}, draftBase: {}, past: [], future: [], lastTag: null, lastAt: 0 })

let state: State = emptyState()
/** Domain the current state belongs to ('' = default domain before the domains are known). */
let stateDomain = ''
/** Parked states of the other domains. */
const parked = new Map<string, State>()

const snap = (s: State): Snapshot => ({ drafts: s.drafts, draftBase: s.draftBase })
const listeners = new Set<() => void>()

function emit(next: State) {
  state = next
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

const HISTORY_LIMIT = 100
const serialized = new WeakMap<object, string>()

function ser(v: Json): string {
  if (v && typeof v === 'object') {
    const hit = serialized.get(v)
    if (hit !== undefined) return hit
    const s = JSON.stringify(v)
    serialized.set(v, s)
    return s
  }
  return JSON.stringify(v)
}

function isDirtyIn(s: State, key: string) {
  if (!(key in s.drafts)) return false
  const base = s.bases[key]
  if (!base) return true
  return ser(s.drafts[key]) !== ser(base.content)
}

export const draftStore = {
  getState: () => state,

  /** Parks the drafts of the current domain and continues with those of <domain> (roadmap 17). */
  switchDomain(domain: string) {
    if (domain === stateDomain) return
    parked.set(stateDomain, state)
    stateDomain = domain
    invalidJson.clear()
    emit(parked.get(domain) ?? emptyState())
    parked.delete(domain)
  },

  /** Declares the state loaded before the domain was known as belonging to <domain> (first load). */
  adoptDomain(domain: string) {
    if (stateDomain === '' && !parked.has(domain)) stateDomain = domain
    else this.switchDomain(domain)
  },

  /** Number of sections with unsaved changes per domain, including the current one. */
  dirtyCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    const count = (s: State) => Object.keys(s.drafts).filter((k) => isDirtyIn(s, k)).length
    for (const [d, s] of parked) if (count(s) > 0) counts[d] = count(s)
    if (count(state) > 0) counts[stateDomain] = count(state)
    return counts
  },

  setBase(section: Section) {
    const prev = state.bases[section.key]
    if (prev && prev.version === section.version && prev.content === section.content) return
    emit({ ...state, bases: { ...state.bases, [section.key]: section } })
  },

  current(key: string): Json {
    return key in state.drafts ? state.drafts[key] : state.bases[key]?.content
  },

  /** Apply edits to one or more sections as a single undoable step. */
  apply(changes: Drafts, opts: { tag?: string } = {}) {
    const now = Date.now()
    const coalesce = !!opts.tag && opts.tag === state.lastTag && now - state.lastAt < 1200
    const past = coalesce ? state.past : [...state.past, snap(state)].slice(-HISTORY_LIMIT)
    const drafts = { ...state.drafts, ...changes }
    const draftBase = { ...state.draftBase }
    for (const k of Object.keys(changes)) {
      const b = state.bases[k]
      if (!(k in draftBase) && b) draftBase[k] = b.version
      // Drop drafts identical to their base so "dirty" is exact.
      if (b && ser(drafts[k]) === ser(b.content)) {
        delete drafts[k]
        delete draftBase[k]
      }
    }
    emit({ ...state, drafts, draftBase, past, future: [], lastTag: opts.tag ?? null, lastAt: now })
  },

  undo() {
    if (!state.past.length) return false
    const prev = state.past[state.past.length - 1]
    emit({ ...state, ...prev, past: state.past.slice(0, -1), future: [snap(state), ...state.future], lastTag: null })
    return true
  },

  redo() {
    if (!state.future.length) return false
    const [next, ...rest] = state.future
    emit({ ...state, ...next, past: [...state.past, snap(state)], future: rest, lastTag: null })
    return true
  },

  discard(key: string) {
    if (!(key in state.drafts)) return
    const drafts = { ...state.drafts }
    const draftBase = { ...state.draftBase }
    delete drafts[key]
    delete draftBase[key]
    emit({ ...state, drafts, draftBase, past: [...state.past, snap(state)], future: [], lastTag: null })
  },

  discardAll() {
    emit({ ...state, drafts: {}, draftBase: {}, past: [], future: [], lastTag: null })
  },

  /** Accept the current server version as the base of an existing draft (after a conflict, on purpose). */
  rebase(key: string) {
    const b = state.bases[key]
    if (!b || !(key in state.drafts)) return
    emit({ ...state, draftBase: { ...state.draftBase, [key]: b.version } })
  },

  /** Version to send as baseVersion when saving <key>. */
  baseVersionOf(key: string): number | undefined {
    return state.draftBase[key] ?? state.bases[key]?.version
  },

  /** After a successful save: new base, draft removed (history kept). */
  saved(section: Section) {
    const drafts = { ...state.drafts }
    const draftBase = { ...state.draftBase }
    delete drafts[section.key]
    delete draftBase[section.key]
    emit({ ...state, bases: { ...state.bases, [section.key]: section }, drafts, draftBase, lastTag: null })
  },

  setJsonValid(key: string, valid: boolean) {
    if (valid) invalidJson.delete(key)
    else invalidJson.add(key)
  },

  invalidJsonKeys(): string[] {
    return [...invalidJson]
  },

  dirtyKeys(): string[] {
    return Object.keys(state.drafts).filter((k) => isDirtyIn(state, k))
  },

  isDirty(key: string) {
    return isDirtyIn(state, key)
  },
}

export function useDraftState<T>(selector: (s: State) => T): T {
  return React.useSyncExternalStore(subscribe, () => selector(state))
}

export function useDirtyKeys(): string[] {
  const drafts = useDraftState((s) => s.drafts)
  const bases = useDraftState((s) => s.bases)
  return React.useMemo(
    () => Object.keys(drafts).filter((k) => isDirtyIn({ ...state, drafts, bases }, k)),
    [drafts, bases],
  )
}

export function useSectionContent(key: string): Json {
  const draft = useDraftState((s) => s.drafts[key])
  const base = useDraftState((s) => s.bases[key])
  return draft !== undefined ? draft : base?.content
}

export function useHistoryAvailability() {
  const canUndo = useDraftState((s) => s.past.length > 0)
  const canRedo = useDraftState((s) => s.future.length > 0)
  return { canUndo, canRedo }
}
