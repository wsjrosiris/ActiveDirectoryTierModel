import type { de } from './de.ts'

/** Same shape as the German resources, every leaf a string: a missing or extra English key is a type error. */
type DeepStrings<T> = { [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> }
export type Resources = DeepStrings<typeof de>
