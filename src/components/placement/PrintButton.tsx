"use client";
import { Icon } from "../Icon";

/** «Скачать PDF» — окно печати браузера, где выбирают «Сохранить как PDF». */
export function PrintButton({ label }: { label: string }) {
  return <button type="button" className="btn secondary noprint" onClick={() => window.print()}><Icon name="dl" size="sm" />{label}</button>;
}
