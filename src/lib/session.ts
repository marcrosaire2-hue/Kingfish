import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth-token";
import type { SessionUser } from "@/lib/auth-types";

export { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth-token";

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
