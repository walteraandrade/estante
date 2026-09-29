import { error } from '@sveltejs/kit'
import { api } from '$lib/client/api'
import { PAGE, filterOf, filterParams } from '$lib/client/format'
import type { Me, Rec, RecPage, RemovedRec, TagCount, UserCount } from '$lib/types'
import type { PageLoad } from './$types'

export const load: PageLoad = async ({ fetch, url }) => {
  const filter = filterOf(url.searchParams)
  const me = await api<Me>('/me', {}, fetch).catch(() => null)
  if (!me) return { me, filter, users: [], tags: [], page: { items: [], next: null, total: 0 } as RecPage, review: null }
  const query = filterParams(filter)
  query.set('limit', String(PAGE))
  try {
    const [users, tags, page, review] = await Promise.all([
      api<UserCount[]>('/users', {}, fetch),
      api<TagCount[]>('/tags', {}, fetch),
      api<RecPage>(`/recs?${query}`, {}, fetch),
      me.admin ? api<{ held: Rec[]; removed: RemovedRec[] }>('/review', {}, fetch) : null,
    ])
    return { me, filter, users, tags, page, review }
  } catch (e) {
    error(500, `não consegui abrir a estante: ${(e as Error).message}`)
  }
}
