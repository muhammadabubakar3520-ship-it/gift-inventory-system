/* Promoter bottom navigation (legacy promoter.js nav()). */
import { Link } from 'react-router-dom';
import Icon from '../Icon';

const NAV = [['home', 'Home', 'home'], ['scan', 'Scan Shop', 'scan'], ['sales', 'My Sales', 'phone'], ['gifts', 'My Gifts', 'gift'], ['history', 'My Txns', 'list'], ['profile', 'Profile', 'user']];

export default function PromoterNav({ active }) {
  return (
    <nav className="pm-nav" id="nav" aria-label="Main">
      {NAV.map(([k, l, i]) => (k === 'scan'
        ? <Link key={k} to="/app/scan" className={`scan ${active === k ? 'on' : ''}`}><span className="ring"><Icon name={i} /></span><span className="lbl">{l}</span></Link>
        : <Link key={k} to={'/app/' + k} className={active === k ? 'on' : ''}><Icon name={i} /><span>{l}</span></Link>))}
    </nav>
  );
}
