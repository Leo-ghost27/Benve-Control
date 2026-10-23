import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_PUBLIC_KEY } from "@/lib/supabase/env";

/**
 * Refreshes the Supabase session cookie on every authenticated-area request
 * (server.ts has always assumed this happens) and redirects signed-out
 * visitors to /login. Authorization (roles, tenant isolation) is still
 * enforced by RLS and per-page checks; this is the outer gate.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_PUBLIC_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/app/:path*"],
};
