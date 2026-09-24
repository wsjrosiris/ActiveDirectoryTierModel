import * as React from 'react'
import type { Section } from '@/api/types'

/* A tiny global store holding local (unsaved) drafts for config sections, with a
 * shared undo/redo history. History entries are snapshots of the whole drafts map
 * so that multi-section operations (e.g. OU rename) undo atomically. Contents are
 * treated as immutable: every edit produces a new object. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
type Drafts = Record<string, Json>

interface State {
  bases: Record<string, Section>
  drafts: Drafts
  past: Drafts[]
  future: Drafts[]
  lastTag: string | null
  lastAt: number
}

let state: State = { bases: {}, drafts: {}, past: [], future: [], lastTag: null, lastAt: 0 }
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
    const past = coalesce ? state.past : [...state.past, state.drafts].slice(-HISTORY_LIMIT)
    const drafts = { ...state.drafts, ...changes }
    // Drop drafts identical to their base so "dirty" is exact.
    for (const k of Object.keys(changes)) {
      const b = state.bases[k]
      if (b && ser(drafts[k]) === ser(b.content)) delete drafts[k]
    }
    emit({ ...state, drafts, past, future: [], lastTag: opts.tag ?? null, lastAt: now })
  },

  undo() {
    if (!state.past.length) return false
    const prev = state.past[state.past.length - 1]
    emit({ ...state, drafts: prev, past: state.past.slice(0, -1), future: [state.drafts, ...state.future], lastTag: null })
    return true
  },

  redo() {
    if (!state.future.length) return false
    const [next, ...rest] = state.future
    emit({ ...state, drafts: next, past: [...state.past, state.drafts], future: rest, lastTag: null })
    return true
  },

  discard(key: string) {
    if (!(key in state.drafts)) return
    const drafts = { ...state.drafts }
    delete drafts[key]
    emit({ ...state, drafts, past: [...state.past, state.drafts], future: [], lastTag: null })
  },

  discardAll() {
    emit({ ...state, drafts: {}, past: [], future: [], lastTag: null })
  },

  /** After a successful save: new base, draft removed (history kept). */
  saved(section: Section) {
    const drafts = { ...state.drafts }
    delete drafts[section.key]
    emit({ ...state, bases: { ...state.bases, [section.key]: section }, drafts, lastTag: null })
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
