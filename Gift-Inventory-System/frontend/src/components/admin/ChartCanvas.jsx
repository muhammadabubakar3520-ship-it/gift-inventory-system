/* A Chart.js chart. Pass a memoised config (useMemo) so the chart is only rebuilt when data changes.
   Renders only the <canvas>; wrap it in the same container markup the page used before. */
import { useEffect, useRef } from 'react';
import { ensureVendor } from '../../utils/vendor';

export default function ChartCanvas({ config, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    let chart = null; let live = true;
    ensureVendor('chart').then(() => { if (live && ref.current && config) chart = new window.Chart(ref.current, config); }).catch(() => {});
    return () => { live = false; if (chart) chart.destroy(); };
  }, [config]);
  return <canvas ref={ref} {...rest} />;
}
