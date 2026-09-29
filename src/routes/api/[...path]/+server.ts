import { dev } from '$app/environment'
import type { RequestHandler } from './$types'
import { appFromEnv } from '$lib/server/config'

let app: ReturnType<typeof appFromEnv> | undefined

export const fallback: RequestHandler = ({ request }) => (app ??= appFromEnv(dev)).fetch(request)
