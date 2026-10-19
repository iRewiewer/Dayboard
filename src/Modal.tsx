import { useEffect, useRef, useId } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, subtitle, children, onClose, wide = false, canClose = true }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; canClose?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canCloseRef = useRef(canClose);
  canCloseRef.current = canClose;
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = ref.current;
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]',
    ) ?? []).filter((node) => node.getClientRects().length > 0);
    const autoFocus = panel?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)');
    (autoFocus && autoFocus.getClientRects().length > 0 ? autoFocus : focusable()[0] ?? panel)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (canCloseRef.current) onClose(); }
      if (event.key === 'Tab') {
        const nodes = focusable();
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!panel?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (canClose && event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="modal-header"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button className="icon-button" aria-label="Close dialog" disabled={!canClose} onClick={onClose}><X size={20} /></button>
      </header>
      {children}
    </div>
  </div>;
}
