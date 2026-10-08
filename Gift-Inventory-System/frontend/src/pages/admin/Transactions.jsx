/* Old transaction links (from pages-transactions.js): #/transactions, #/transactions/:status open the Gift Distribution report. */
import { useEffect, useRef } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../../context/PageMetaContext';
import { openTransaction } from '../../components/admin/Transactions';
import { clean } from '../../utils/admin';

export default function TransactionsRedirect() {
  usePageMeta('Transactions', 'Reports');
  const { status } = useParams();
  const [sp] = useSearchParams();
  // /transactions?promoter=5 or ?shop=3 keeps the promoter / shop; /transactions/:status ignores the query
  const q = status === undefined ? { promoter: sp.get('promoter') || '', shop: sp.get('shop') || '' } : {};
  const qs = q.promoter || q.shop ? '?' + new URLSearchParams(clean({ promoter: q.promoter, shop: q.shop })).toString() : '';
  const code = status && /^TXN-/i.test(status) ? status.toUpperCase() : null;
  const done = useRef(false);
  useEffect(() => {
    if (!code || done.current) return;
    done.current = true;
    setTimeout(() => openTransaction(code), 400);
  }, [code]);
  return <Navigate to={'/admin/reports/gifts' + qs} replace />;
}
