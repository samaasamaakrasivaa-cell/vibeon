import "server-only";
import { createHash } from "node:crypto";
import { env } from "../env";
import { randomToken } from "./crypto";

export type Provider = "yandex" | "vk";
export const PROVIDERS: Provider[] = ["yandex", "vk"];
export const providerLabel: Record<Provider, string> = { yandex: "Яндекс ID", vk: "VK ID" };

export type OAuthProfile = { id: string; email: string | null; firstName: string; lastName: string };

const redirectUri = (p: Provider) => `${env.appUrl}/api/auth/callback/${p}`;

export function buildAuthorizeUrl(p: Provider) {
  const state = randomToken(16);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let url: string;
  if (p === "yandex") {
    const q = new URLSearchParams({ response_type: "code", client_id: env.yandex.id, redirect_uri: redirectUri(p), state, force_confirm: "no" });
    url = `https://oauth.yandex.ru/authorize?${q}`;
  } else {
    // VK ID (OAuth 2.1 с PKCE)
    const q = new URLSearchParams({
      response_type: "code", client_id: env.vk.id, redirect_uri: redirectUri(p), state,
      code_challenge: challenge, code_challenge_method: "S256", scope: "email",
    });
    url = `https://id.vk.com/authorize?${q}`;
  }
  return { url, state, verifier };
}

export async function fetchProfile(p: Provider, params: URLSearchParams, verifier: string): Promise<OAuthProfile> {
  const code = params.get("code") ?? "";
  if (p === "yandex") {
    const tok = await fetch("https://oauth.yandex.ru/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: env.yandex.id, client_secret: env.yandex.secret }),
    }).then((r) => r.json());
    if (!tok.access_token) throw new Error("yandex token: " + JSON.stringify(tok));
    const info = await fetch("https://login.yandex.ru/info?format=json", { headers: { Authorization: `OAuth ${tok.access_token}` } }).then((r) => r.json());
    return { id: String(info.id), email: info.default_email ?? info.emails?.[0] ?? null, firstName: info.first_name ?? "", lastName: info.last_name ?? "" };
  }
  const tok = await fetch("https://id.vk.com/oauth2/auth", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, code_verifier: verifier, client_id: env.vk.id,
      device_id: params.get("device_id") ?? "", redirect_uri: redirectUri(p), state: params.get("state") ?? "",
    }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error("vk token: " + JSON.stringify(tok));
  const info = await fetch("https://id.vk.com/oauth2/user_info", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.vk.id, access_token: tok.access_token }),
  }).then((r) => r.json());
  const u = info.user ?? {};
  return { id: String(u.user_id ?? tok.user_id), email: u.email || tok.email || null, firstName: u.first_name ?? "", lastName: u.last_name ?? "" };
}
