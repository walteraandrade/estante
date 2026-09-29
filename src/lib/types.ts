export type { Kind, Rec, RecPage, RemovedRec, User } from './server/db'

export type Me = { id: number; name: string; admin: boolean }
export type UserCount = { id: number; name: string; recs: number }
export type TagCount = { tag: string; count: number }
export type Filter = { kind: '' | 'album' | 'track'; user: string; tag: string; q: string }
