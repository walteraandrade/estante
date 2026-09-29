import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { appFromEnv } from './config.js'

const port = Number(process.env.PORT ?? 3300)
const app = new Hono().route('/', appFromEnv(true)).use('/*', serveStatic({ root: './public' }))

serve({ fetch: app.fetch, port }, () => console.log(`estante on http://localhost:${port}`))
