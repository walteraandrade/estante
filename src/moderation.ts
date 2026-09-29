import type { NewRec } from './db.js'

// true holds the recommendation for an admin to look at; false lets it straight onto the shelf.
export type Moderate = (rec: NewRec) => Promise<boolean>

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const HOLD_AT = 0.9

const JUNK = {
  type: 'noul',
  instructions:
    'A group of friends shares music albums and tracks on a shared shelf. Is this entry junk rather than a music recommendation?',
  criteria: {
    true: 'Junk: spam, advertising, a scam or phishing link, harassment, slurs, or text unrelated to music.',
    false: 'A real music recommendation, even if short, obscure, strange, in any language, or strongly opinionated.',
  },
}

// Jev (TypeSafe AI) answers a yes/no question with a probability. Only near-certain junk is held,
// so members never notice it; the caller treats any failure as "let it through".
export const jevModerator =
  (apiKey: string, fetchImpl: typeof fetch = fetch): Moderate =>
  async (rec) => {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: {
          kind: rec.kind,
          title: rec.title,
          artist: rec.artist,
          url: rec.url ?? null,
          tags: rec.tags ?? [],
          description: rec.description ?? '',
        },
        questions: { junk: JUNK },
      }),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) throw new Error(`jev answered ${res.status}`)
    const body = (await res.json()) as { answers?: { junk?: { noul?: unknown } } }
    const p = body.answers?.junk?.noul
    return typeof p === 'number' && p >= HOLD_AT
  }
