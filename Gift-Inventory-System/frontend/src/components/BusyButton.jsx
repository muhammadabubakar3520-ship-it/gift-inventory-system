/* A button that shows a spinner and is disabled while its async onClick runs (like withBusy). */
import { useRef, useState } from 'react';

export default function BusyButton({ onClick, busyText, children, className = 'btn', type = 'button', disabled, ...rest }) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const click = async (e) => {
    if (running.current || !onClick) return;
    running.current = true; setBusy(true);
    try { await onClick(e); } finally { running.current = false; setBusy(false); }
  };
  return (
    <button type={type} className={className} disabled={disabled || busy} onClick={click} {...rest}>
      {busy ? <><span className="spinner" />{busyText ? <span>{busyText}</span> : null}</> : children}
    </button>
  );
}
