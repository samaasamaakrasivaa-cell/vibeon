"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

/** Модальное окно на <dialog>: закрывается крестиком, Esc и кликом по фону. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dlg ${wide ? "wide" : ""}`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="dlgin">
          <button type="button" className="iconbtn dlgx" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
          {title && <h2 className="mb-4 pr-10">{title}</h2>}
          {children}
        </div>
      )}
    </dialog>
  );
}
