"use client";
import { useActionState } from "react";
import { PasswordInput } from "./PasswordInput";
import { loginAction, magicAction, type FormState } from "@/lib/auth/actions";
import { useT } from "@/lib/i18n/client";
import { Submit } from "./Submit";
import { OAuthButtons } from "./OAuthButtons";
import Link from "next/link";

export function LoginForm({ oauth, initialError, next }: { oauth: { yandex: boolean; vk: boolean }; initialError?: string; next?: string }) {
  const { t } = useT();
  const [ls, login] = useActionState<FormState, FormData>(loginAction, undefined);
  const [ms, magic] = useActionState<FormState, FormData>(magicAction, undefined);
  const st = ms?.error ? ms : ls;
  const error = st?.error ?? initialError;
  return (
    <form action={login} className="authform" noValidate>
      {error && <div className="alert" role="alert">{error}</div>}
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="field">
        <label htmlFor="email">{t("auth.email")}</label>
        <input id="email" name="email" type="email" className="input" placeholder="you@mail.ru" autoComplete="email" defaultValue={st?.fields?.email} required />
      </div>
      <div className="field">
        <label htmlFor="password">{t("auth.password")}</label>
        <PasswordInput id="password" name="password" placeholder="••••••••" autoComplete="current-password" />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-[14px] text-text2">
          <input type="checkbox" name="remember" className="check" defaultChecked />
          {t("auth.remember")}
        </label>
        <Link href="/forgot" className="text-[14px] text-accent">{t("auth.forgot")}</Link>
      </div>
      <Submit>{t("auth.signIn")}</Submit>
      <Submit className="btn tinted w-full" formAction={magic}>{t("auth.magic")}</Submit>
      {(oauth.yandex || oauth.vk) && <>
        <div className="divider">{t("auth.or")}</div>
        <OAuthButtons enabled={oauth} />
      </>}
    </form>
  );
}
