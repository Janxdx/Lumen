import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  side?: boolean;
  children: ReactNode;
}

/** px dragged, or px/ms flicked, past which the sheet lets go */
const DISMISS_PX = 96;
const DISMISS_VELOCITY = 0.5;

export function Sheet({ open, onClose, side, children }: Props) {
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ y: number; t: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDy(0);
    setDragging(false);
    dragRef.current = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  /* drag-to-dismiss, from the handle only — the body keeps its own scrolling */
  const onPointerDown = (e: ReactPointerEvent) => {
    dragRef.current = { y: e.clientY, t: Date.now() };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setDy(Math.max(0, e.clientY - d.y));
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!d) return;
    const travel = e.clientY - d.y;
    const velocity = travel / Math.max(1, Date.now() - d.t);
    if (travel > DISMISS_PX || velocity > DISMISS_VELOCITY) onClose();
    else setDy(0);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} style={{ opacity: dy ? Math.max(0.25, 1 - dy / 320) : undefined }} />
      <div
        className={side ? 'sheet side' : 'sheet bottom'}
        role="dialog"
        style={
          side
            ? undefined
            : {
                transform: dy ? `translateY(${dy}px)` : undefined,
                transition: dragging ? 'none' : undefined,
              }
        }
      >
        {!side && (
          <div
            className="grab-zone"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="Drag down to close"
          >
            <div className="grab" />
          </div>
        )}
        <div className={side ? 'sheet-body side' : 'sheet-body'}>{children}</div>
      </div>
    </>
  );
}
