import { redirect } from '@sveltejs/kit'

export const GET = () => redirect(307, '/index.html')
