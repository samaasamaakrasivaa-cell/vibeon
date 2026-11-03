"use client";
import { useEffect } from "react";

export function PrintButton({ label }: { label: string }) {
  useEffect(() => { const id = setTimeout(() => window.print(), 600); return () => clearTimeout(id); }, []);
  return <button type="button" className="btn primary noprint" onClick={() => window.print()}>{label}</button>;
}
