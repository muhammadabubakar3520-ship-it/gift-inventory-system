/* Promoter scan screen (promoter.js scan()): opens the camera QR scanner at once. */
import { useEffect, useRef } from 'react';
import Icon from '../../components/Icon';
import { useHoldLive } from '../../context/SyncContext';
import QRScanner from '../../utils/qrScanner';
import { useTop, useNav, useGo, normalizeCode, manualEntry, enc } from './common';

export default function Scan() {
  useNav('scan');
  useTop('Scan Shop', { back: '/app/home' });
  useHoldLive();
  const go = useGo();
  const goRef = useRef(go);
  goRef.current = go;
  const stopRef = useRef(() => {});

  const openScanner = () => QRScanner.open({
    title: 'Scan shop QR code',
    onCode: (text) => { const code = normalizeCode(text); if (!code) return false; goRef.current('/app/shop/' + enc(code)); return true; },
    onManual: () => manualEntry(goRef.current),
    onClose: () => {},
  });
  useEffect(() => {
    stopRef.current = openScanner();
    return () => stopRef.current();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pm-card pm-pad" style={{ textAlign: 'center' }}>
      <div className="muted">Opening the camera…</div>
      <div className="btn-stack"><button className="btn primary" id="reScan" onClick={() => { stopRef.current(); stopRef.current = openScanner(); }}><Icon name="scan" />SCAN SHOP</button>
        <button className="btn" id="reManual" onClick={() => manualEntry(go)}><Icon name="edit" />Enter Shop ID manually</button></div></div>
  );
}
