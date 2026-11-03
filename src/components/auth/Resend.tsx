"use client";
import { useEffect, useState, useTransition } from "react";
import { resendAction } from "@/lib/auth/actions";
import { useT } from "@/lib/i18n/client";

const WAIT = 45;

/** «Отправить ещё раз» с обратным отсчётом 0:45. */
export function Resend({ email, kind }: { email: string; kind: "verify" | "magic" | "reset" }) {
  const { t } = useT();
  const [left, setLeft] = useState(WAIT);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const mmss = `0:${String(left).padStart(2, "0")}`;
  return (
    <p className="m-0 text-center text-[13px] text-text2">
      {t("auth.check.none")}{" "}
      <button
        type="button"
        className="alink"
        disabled={left > 0 || pending}
        style={left > 0 ? { color: "var(--text3)", cursor: "default" } : undefined}
        onClick={() => start(async () => { await resendAction(email, kind); setSent(true); setLeft(WAIT); })}
      >
        {t("auth.check.resend")}
      </button>
      {left > 0 && <><br />{t("auth.check.in")} {mmss}</>}
      {sent && <><br /><span className="text-ok">{t("auth.check.resent")}</span></>}
    </p>
  );
}
