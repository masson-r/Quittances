// Boîte de réception locale de Supabase (Mailpit, port 54324).
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

/** Attend un message pour `to` contenant un lien /auth/confirm du type demandé et renvoie ce lien. */
export async function confirmationLink(to: string, type: 'email' | 'recovery' = 'email', timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    const { messages } = (await search.json()) as { messages: { ID: string }[] }
    for (const { ID } of messages) {
      const detail = await fetch(`${MAILPIT}/api/v1/message/${ID}`)
      const { HTML } = (await detail.json()) as { HTML: string }
      const links = [...HTML.matchAll(/href="([^"]*\/auth\/confirm[^"]*)"/g)].map((m) => m[1].replaceAll('&amp;', '&'))
      const link = links.find((l) => l.includes(`type=${type}`))
      if (link) return link
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Aucun message de type ${type} reçu pour ${to}`)
}

/** Sujet du dernier message reçu par `to`. */
export async function lastSubject(to: string): Promise<string> {
  const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
  const { messages } = (await search.json()) as { messages: { Subject: string }[] }
  return messages[0]?.Subject ?? ''
}
