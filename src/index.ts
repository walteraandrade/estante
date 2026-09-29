import { Hono } from 'hono'
import { appFromEnv } from './config.js'

export default new Hono().get('/', (c) => c.redirect('/index.html')).route('/', appFromEnv())
