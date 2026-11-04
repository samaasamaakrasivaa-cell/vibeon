import { NextResponse, type NextRequest } from "next/server";

/**
 * Быстрая проверка до рендера: без куки сессии кабинеты сразу отправляют на вход.
 * Полная проверка сессии и роли — в layout кабинетов (requireUser).
 */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("vo_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = req.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/teacher/:path*", "/student/:path*", "/builder/:path*", "/class/:path*"] };
