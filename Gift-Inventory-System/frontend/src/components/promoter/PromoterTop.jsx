/* Promoter top bar (legacy promoter.js top()): back button or logo, title and optional sub-line. */
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';

export default function PromoterTop({ title, back, sub, onBack }) {
  const navigate = useNavigate();
  return (
    <header className="pm-top" id="top">
      {back
        ? <button className="back" id="backBtn" aria-label="Back" onClick={() => (onBack ? onBack(back) : navigate(back))}><Icon name="back" /></button>
        : <span className="logo-mark"><Icon name="gift" /></span>}
      <h1>{title}{sub ? <small>{sub}</small> : null}</h1>
    </header>
  );
}
