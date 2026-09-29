import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

// Installed PWAs and iOS Shortcuts still point at /index.html.
export const GET: RequestHandler = ({ url }) => redirect(308, `/${url.search}`)
