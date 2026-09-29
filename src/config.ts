import { createApp } from './api.js'
import { openDb } from './db.js'
import { jevModerator } from './moderation.js'

const env = (key: string, fallback?: string) => {
  const value = process.env[key] ?? fallback
  if (value === undefined) throw new Error(`missing env ${key}`)
  return value
}

export const appFromEnv = (dev = false) =>
  createApp({
    db: openDb(env('TURSO_DATABASE_URL', dev ? 'file:estante.db' : undefined), process.env.TURSO_AUTH_TOKEN),
    groupCode: env('GROUP_CODE', dev ? 'psicoacustica' : undefined),
    adminCode: process.env.ADMIN_CODE || undefined,
    secret: env('SESSION_SECRET', dev ? 'dev-secret-change-me' : undefined),
    moderate: process.env.TYPESAFE_API_KEY ? jevModerator(process.env.TYPESAFE_API_KEY) : undefined,
    secureCookie: !dev,
  })
