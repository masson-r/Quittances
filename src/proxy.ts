import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { supabaseEnv } from '@/lib/supabase/env'

/**
 * Rafraîchit la session Supabase et protège l'espace propriétaire.
 * Le profil actif et les droits sont relus en base par chaque page et chaque action (voir domains/identity/session.ts).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { url, key } = supabaseEnv()

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // getUser interroge le serveur d'authentification : une session révoquée est refusée tout de suite.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname, search } = request.nextUrl
  const redirectTo = (path: string, params?: Record<string, string>) => {
    const query = new URLSearchParams(params).toString()
    // Hôte tel que le navigateur l'a utilisé (en-tête Host), pour que ses cookies de session restent valables.
    const origin = `${request.nextUrl.protocol}//${request.headers.get('host') ?? request.nextUrl.host}`
    const redirect = NextResponse.redirect(new URL(query ? `${path}?${query}` : path, origin))
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c))
    return redirect
  }

  if (!user && (pathname.startsWith('/espace') || pathname.startsWith('/securite') || pathname.startsWith('/invitation') || pathname.startsWith('/rattachement') || pathname.startsWith('/mon-espace'))) {
    return redirectTo('/connexion', { next: pathname + search })
  }
  if (user && (pathname === '/connexion' || pathname === '/inscription')) {
    return redirectTo('/espace')
  }
  return response
}

export const config = {
  matcher: ['/espace/:path*', '/securite/:path*', '/invitation/:path*', '/rattachement/:path*', '/mon-espace/:path*', '/connexion', '/inscription'],
}
