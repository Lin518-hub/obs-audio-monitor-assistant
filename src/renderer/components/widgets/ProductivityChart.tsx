import React, { useMemo } from 'react';
import { MoreVertical } from 'lucide-react';
import type { AlertHistoryEntry } from '../../../shared/types';

interface ProductivityChartProps {
  history: AlertHistoryEntry[];
}

const MONTH_LABELS = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];

/**
 * 显示最近 6 个月的报警活动统计,每根柱代表一个月。
 * 数据源来自 history.json,没有历史时所有柱为 0。
 */
export const ProductivityChart: React.FC<ProductivityChartProps> = ({ history }) => {
  const data = useMemo(() => {
    const now = new Date();
    const months: { label: string; count: number; year: number; month: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ label: MONTH_LABELS[d.getMonth()], count: 0, year: d.getFullYear(), month: d.getMonth() });
    }
    for (const entry of history) {
      const t = new Date(entry.timestamp);
      const m = months.find((m) => m.year === t.getFullYear() && m.month === t.getMonth());
      if (m) m.count += 1;
    }
    return months;
  }, [history]);

  const max = Math.max(1, ...data.map((d) => d.count));
  const activeIdx = data.reduce((bestIdx, d, idx, arr) => (d.count > arr[bestIdx].count ? idx : bestIdx), 0);

  return (
    <section className="right-card chart-card">
      <div className="chart-title">
        <strong>报警活动</strong>
        <button type="button" className="topbar-icon-btn" style={{ width: 28, height: 28, border: 0, boxShadow: 'none' }} aria-label="更多">
          <MoreVertical size={14} />
        </button>
      </div>
      <div className="chart-bars" role="img" aria-label="最近 6 个月报警活动">
        {data.map((d, idx) => {
          const heightPct = Math.max(4, (d.count / max) * 100);
          return (
            <div className="chart-bar-wrap" key={`${d.year}-${d.month}`}>
              <div className="chart-bar-tooltip">本月 {d.count} 次</div>
              <div className={`chart-bar ${idx === activeIdx && d.count > 0 ? 'active' : ''}`} style={{ height: `${heightPct}%` }} />
              <div className="chart-bar-label">{d.label.replace(' 月', '')}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
