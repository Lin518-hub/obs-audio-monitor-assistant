import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AlertHistoryEntry } from '../../../shared/types';

interface HistoryCalendarProps {
  history: AlertHistoryEntry[];
}

const MONTHS_CN = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];
const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六'];

const startOfMonth = (year: number, month: number) => new Date(year, month, 1);
const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString();

export const HistoryCalendar: React.FC<HistoryCalendarProps> = ({ history }) => {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState<Date | null>(new Date());

  const eventDays = useMemo(() => {
    const days = new Set<string>();
    for (const entry of history) {
      const d = new Date(entry.timestamp);
      days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return days;
  }, [history]);

  const entriesForSelected = useMemo(() => {
    if (!selected) return [];
    return history.filter((entry) => sameDay(new Date(entry.timestamp), selected));
  }, [history, selected]);

  const monthStart = startOfMonth(cursor.year, cursor.month);
  const firstWeekday = monthStart.getDay();
  const totalDays = daysInMonth(cursor.year, cursor.month);
  const cells: Array<{ day: number | null; date: Date | null }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: null, date: null });
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ day: d, date: new Date(cursor.year, cursor.month, d) });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, date: null });

  const today = new Date();
  const prev = () => setCursor((c) => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 });
  const next = () => setCursor((c) => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 });

  return (
    <section className="right-card">
      <div className="mini-calendar">
        <div className="mini-calendar-header">
          <h3>
            {cursor.year} 年 {MONTHS_CN[cursor.month]}
          </h3>
          <div className="mini-calendar-nav">
            <button onClick={prev} aria-label="上个月"><ChevronLeft size={14} /></button>
            <button onClick={next} aria-label="下个月"><ChevronRight size={14} /></button>
          </div>
        </div>
        <div className="mini-calendar-weekdays">
          {WEEKDAYS_CN.map((w) => <span key={w}>{w}</span>)}
        </div>
        <div className="mini-calendar-grid">
          {cells.map((cell, idx) => {
            if (cell.day === null || !cell.date) {
              return <div key={idx} className="mini-calendar-day muted" />;
            }
            const isToday = sameDay(cell.date, today);
            const isSelected = selected ? sameDay(cell.date, selected) : false;
            const hasEvent = eventDays.has(`${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`);
            const className = [
              'mini-calendar-day',
              isSelected ? 'selected' : isToday ? 'today' : '',
              hasEvent ? 'has-event' : ''
            ].filter(Boolean).join(' ');
            return (
              <button
                key={idx}
                type="button"
                className={className}
                onClick={() => setSelected(cell.date)}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        {selected && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
            {selected.toLocaleDateString()} 报警
          </div>
        )}
        {selected && entriesForSelected.length === 0 && (
          <div className="history-empty" style={{ marginTop: 8 }}>当天没有报警记录</div>
        )}
        {selected && entriesForSelected.length > 0 && (
          <div className="history-list" style={{ marginTop: 8 }}>
            {entriesForSelected.map((entry) => (
              <div className="history-item" key={entry.id}>
                <div>
                  <strong>{entry.inputName}</strong>
                  <div className="history-time">{formatTime(entry.timestamp)}</div>
                </div>
                <div>
                  <strong>{entry.silentForSeconds}s</strong>
                  <div>{entry.action === 'acknowledge' ? '已确认' : '单次忽略'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
