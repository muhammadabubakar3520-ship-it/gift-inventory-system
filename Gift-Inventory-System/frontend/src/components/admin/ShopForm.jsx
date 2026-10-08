/* Add / edit shop form (from pages-shops.js: Admin.shopForm). */
import { useState } from 'react';
import { Modal, openModal, confirmDialog } from '../Modal';
import BusyButton from '../BusyButton';
import Icon from '../Icon';
import { toast, toastError } from '../Toasts';
import { api } from '../../services/api';
import { useLookups } from '../../context/LookupsContext';
import { cityOpts, marketOpts, promoterOpts } from './options';
import { promptText } from './shop-widgets';

const str = (v) => (v === null || v === undefined ? '' : String(v));

function ShopFormModal({ shop, onClose, onSaved }) {
  const { lk, loadLookups } = useLookups();
  const s = shop || { status: 'active' };
  const [f, setF] = useState({
    shop_id: s.shop_id || '', shop_name: s.shop_name || '', city_id: str(s.city_id), market_id: str(s.market_id),
    address: s.address || '', promoter_id: str(s.promoter_id), status: s.status || 'active',
  });
  const set = (k) => (e) => { const v = e.target.value; setF((x) => ({ ...x, [k]: v })); };

  const changeCity = (e) => { const v = e.target.value; setF((x) => ({ ...x, city_id: v, market_id: '' })); };

  const newCity = async () => {
    const name = await promptText('Add city', 'City name');
    if (!name) return;
    try {
      const c = await api('/masters/cities', { method: 'POST', body: { city_name: name } });
      await loadLookups();
      setF((x) => ({ ...x, city_id: str(c.id), market_id: '' }));
      toast(`City "${name}" added`, 'ok');
    } catch (e) { toastError(e); }
  };
  const newMarket = async () => {
    if (!f.city_id) return toast('Select a city first', 'warn');
    const cityId = f.city_id;
    const cname = (lk.cities.find((c) => String(c.id) === String(cityId)) || {}).city_name || '';
    const name = await promptText(`Add market in ${cname}`, 'Market name');
    if (!name) return undefined;
    try {
      const mk = await api('/masters/markets', { method: 'POST', body: { city_id: cityId, market_name: name } });
      await loadLookups();
      setF((x) => ({ ...x, city_id: cityId, market_id: str(mk.id) }));
      toast(`Market "${name}" added`, 'ok');
    } catch (e) { toastError(e); }
    return undefined;
  };

  const save = async () => {
    const body = { ...f };
    if (!body.shop_name.trim()) return toast('Shop name is required', 'warn');
    body.shop_id = (body.shop_id || '').trim().toUpperCase().replace(/\s+/g, '');
    if (body.shop_id && (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(body.shop_id) || !/[A-Z]/.test(body.shop_id))) return toast('Shop ID must be 2–20 letters, numbers or dashes with at least one letter (e.g. PK413451)', 'warn');
    if (shop && body.shop_id && body.shop_id !== shop.shop_id && !(await confirmDialog({
      title: `Change Shop ID to ${body.shop_id}?`,
      message: <>The QR code will change from <b>{shop.shop_id}</b> to <b>{body.shop_id}</b>. Old printed QR labels will stop working — print the new label. Sales history is kept.</>,
      confirmText: 'Change Shop ID',
    }))) return undefined;
    if (!body.city_id || !body.market_id) return toast('Select a city and market', 'warn');
    try {
      const saved = await api(shop ? `/shops/${shop.id}` : '/shops', { method: shop ? 'PUT' : 'POST', body: { ...body, ...(shop ? { expected_updated_at: shop.updated_at } : {}) } });
      toast(shop ? 'Shop updated' : `Shop ${saved.shop_id} created`, 'ok');
      onClose();
      if (onSaved) onSaved(saved);
    } catch (ex) { toastError(ex); }
    return undefined;
  };

  return (
    <Modal title={shop ? `Edit shop · ${shop.shop_id}` : 'Add shop'} size="wide" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><BusyButton className="btn primary" id="sfSave" busyText="Saving…" onClick={save}>{shop ? 'Save changes' : 'Create shop'}</BusyButton></>}>
      <div className="form-grid" id="shopForm">
        <div className="field"><label>Shop ID</label><input className="input mono" name="shop_id" value={f.shop_id} onChange={set('shop_id')} maxLength={20} placeholder="e.g. PK413451" autoCapitalize="characters" style={{ textTransform: 'uppercase' }} />
          <div className="hint">{shop ? 'The QR code holds this ID. If you change it, print the new QR label.' : 'Type your own Shop ID from the shop details, or leave blank to get one automatically (SHP-0008).'}</div></div>
        <div className="field"><label>Shop name <span className="req">*</span></label><input className="input" name="shop_name" value={f.shop_name} onChange={set('shop_name')} maxLength={120} /></div>
        <div className="field"><label>City <span className="req">*</span></label>
          <div className="row"><select className="select" name="city_id" id="sfCity" value={f.city_id} onChange={changeCity}>{cityOpts(lk, 'Select city')}</select>
            <button className="btn sm" type="button" id="sfNewCity" title="Add a new city" onClick={newCity}><Icon name="plus" /></button></div></div>
        <div className="field"><label>Market <span className="req">*</span></label>
          <div className="row"><select className="select" name="market_id" id="sfMarket" value={f.market_id} onChange={set('market_id')}>{marketOpts(lk, f.city_id || -1, f.city_id ? 'Select market' : 'Select a city first')}</select>
            <button className="btn sm" type="button" id="sfNewMarket" title="Add a market to this city" onClick={newMarket}><Icon name="plus" /></button></div></div>
        <div className="field full"><label>Shop address</label><input className="input" name="address" value={f.address} onChange={set('address')} maxLength={250} /></div>
        <div className="field"><label>Assigned promoter</label><select className="select" name="promoter_id" value={f.promoter_id} onChange={set('promoter_id')}>{promoterOpts(lk, 'Not assigned', true, s.promoter_id)}</select>
          <div className="hint">Only the assigned promoter can submit sales for this shop.</div></div>
        <div className="field"><label>Status</label><select className="select" name="status" value={f.status} onChange={set('status')}>
          <option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div>
    </Modal>
  );
}

/** Admin.shopForm(shop, onSaved): shop = null for a new shop. Returns close(). */
export function openShopForm(shop, onSaved) {
  return openModal((close) => <ShopFormModal shop={shop} onClose={close} onSaved={onSaved} />);
}
