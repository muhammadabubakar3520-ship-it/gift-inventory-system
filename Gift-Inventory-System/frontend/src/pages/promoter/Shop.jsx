/* Promoter "Shop verified" screen (promoter.js shopScreen()). */
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { Chip, EmptyState, LoadingBlock } from '../../components/ui';
import useApi from '../../hooks/useApi';
import { fmt } from '../../utils/format';
import { useTop, useNav, useGo, usePromoter, loadShop, manualEntry, newDraft, GiftIco, enc } from './common';

export default function Shop() {
  const { code } = useParams();
  const go = useGo();
  const { store } = usePromoter();
  const { data: d, error } = useApi(() => loadShop(code), [code]);
  useNav('scan');
  useTop(d && !error ? d.shop.shop_name : 'Shop', { back: '/app/home' });
  useEffect(() => { if (error && navigator.vibrate) navigator.vibrate([40, 60, 40]); }, [error]);

  if (error) {
    const notMine = error.status === 403;
    return (
      <div className="pm-card verify-card bad">
        <div className="vhead"><Icon name="alert" /><b>{notMine ? 'SHOP NOT ASSIGNED' : error.status === 404 ? 'SHOP NOT FOUND' : 'CANNOT USE THIS SHOP'}</b></div>
        <div className="vmsg">{notMine ? <>This shop is not assigned to you.<br />Please scan the QR code of your assigned shop.</> : error.message}</div>
        <div className="mono muted small" style={{ marginTop: 6 }}>{code}</div>
        <div className="btn-stack"><Link className="btn primary big" to="/app/scan"><Icon name="scan" />SCAN AGAIN</Link>
          <button className="btn" id="eManual" onClick={() => manualEntry(go)}><Icon name="edit" />Enter Shop ID manually</button>
          <Link className="btn ghost" to="/app/home">Back to home</Link></div></div>
    );
  }
  if (!d) return <LoadingBlock text="Verifying shop…" />;
  const s = d.shop;
  const totalAvail = d.gifts.reduce((a, g) => a + Math.max(0, g.available), 0);
  return (
    <>
      <div className="pm-card verify-card ok">
        <div className="vhead"><Icon name="check" /><b>SHOP VERIFIED</b></div>
        <dl className="vlist">
          <dt>Shop ID</dt><dd className="mono">{s.shop_id}</dd>
          <dt>Shop Name</dt><dd><b>{s.shop_name}</b></dd>
          <dt>City</dt><dd>{s.city_name}</dd>
          <dt>Market</dt><dd>{s.market_name}</dd>
          <dt>Assigned Promoter</dt><dd>{s.promoter_name}</dd>
          <dt>Status</dt><dd><Chip status={s.status} /></dd>
        </dl></div>
      <div className="pm-sec"><h2>Gifts available at this shop</h2>
        <div className="pm-card">{d.gifts.length ? d.gifts.map((g) => (
          <div className="list-item static" key={g.gift_id}>
            <GiftIco g={g} />
            <div className="main"><div className="t">{g.gift_name}</div><div className="s">{fmt.n(g.remaining)} remaining</div></div>
            <div className={`avail ${g.available <= 0 ? 'out' : ''}`}><b>{fmt.n(g.available)}</b><span>available</span></div></div>))
          : <EmptyState title="No gifts allocated" text="This shop has no gift stock yet. Contact your admin." />}</div>
        {d.gifts.length && !totalAvail ? <div className="callout warn" style={{ marginTop: 10 }}>All gift stock at this shop is used. Ask your admin for more.</div> : null}
      </div>
      <div className="sticky-submit"><button className="btn primary block big" id="startSale" disabled={!totalAvail}
        onClick={() => { store.draft = newDraft(d); go(`/app/sale/${enc(s.shop_id)}/mobile`); }}><Icon name="phone" />RECORD SALE</button></div>
    </>
  );
}
