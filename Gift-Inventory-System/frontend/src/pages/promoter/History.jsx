/* Promoter "My Transactions" screen (promoter.js myTransactions()). */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BusyButton from '../../components/BusyButton';
import { EmptyState, LoadingBlock, ErrorBlock } from '../../components/ui';
import { useLiveRefresh } from '../../context/SyncContext';
import { api } from '../../services/api';
import { fmt } from '../../utils/format';
import { useTop, useNav, TxnRow } from './common';

export default function History() {
  useTop('My Transactions');
  useNav('history');
  const params = useParams();
  let status = params.status || '';
  if (!['', 'approved', 'rejected'].includes(status)) status = ''; // no approval process: no status tabs
  const [list, setList] = useState({ rows: null, total: 0, error: null });
  const page = useRef(1);
  const rowsRef = useRef([]);

  const seq = useRef(0);

  async function load(reset) {
    if (reset) page.current = 1;
    const my = ++seq.current;
    const base = reset ? [] : rowsRef.current;
    try {
      const d = await api('/promoter/transactions', { query: { status, page: page.current } });
      if (my !== seq.current) return; // a newer load is running
      rowsRef.current = base.concat(d.rows);
      setList({ rows: rowsRef.current, total: d.total, error: null });
    } catch (e) { if (my === seq.current) setList((l) => ({ ...l, error: e })); }
  }
  useEffect(() => { load(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(() => load(true));

  const { rows, total, error } = list;
  return (
    <>
      <div className="pm-card" id="hList">{error ? <ErrorBlock message={error.message} /> : !rows ? <LoadingBlock />
        : rows.length ? rows.map((t) => <TxnRow key={t.transaction_id} t={t} />)
          : <EmptyState title="No transactions" text={status ? 'Nothing here.' : 'Your sales will appear here.'} />}</div>
      <div id="hMore" style={{ marginTop: 12 }}>{rows && rows.length < total
        ? <BusyButton className="btn block" id="hMoreBtn" onClick={() => { page.current += 1; return load(false); }}>Load more ({fmt.n(total - rows.length)} left)</BusyButton>
        : null}</div>
    </>
  );
}
