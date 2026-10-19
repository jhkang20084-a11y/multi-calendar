import { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { groupByDate, layoutOverlaps } from '../lib/feed.js';
import { formatTime, safeZone, addDays } from '../lib/time.js';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const HOUR_PX = 48;

function weekdayLabels(weekStartsOn) {
  return Array.from({ length: 7 }, (_, i) => WEEKDAYS[(i + weekStartsOn) % 7]);
}

function datesBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 일정 칩: 원본 캘린더 색 + 구독 일정은 점선 테두리/🔗 표시 */
function Chip({ inst, tz, onOpen, compact, continued }) {
  const style = { '--c': inst.color };
  const cls = ['chip', inst.allDay ? 'chip-allday' : 'chip-timed', inst.subscribed ? 'chip-sub' : '',
    inst.ev.completed ? 'chip-done' : '', inst.hiddenDetails ? 'chip-busy' : ''].join(' ');
  return (
    <button type="button" className={cls} style={style} onClick={(e) => { e.stopPropagation(); onOpen(inst); }}
      title={`${inst.title} · ${inst.calendarName}${inst.subscribed ? ' (구독)' : ''}`}>
      {inst.subscribed && <span className="chip-sub-icon" aria-label="구독 일정">🔗</span>}
      {!inst.allDay && !compact && <span className="chip-time">{formatTime(inst.startMs, tz)}</span>}
      {continued && <span aria-hidden>›</span>}
      <span className="chip-title">{inst.ev.kind === 'anniversary' ? '🎉 ' : ''}{inst.title}</span>
    </button>
  );
}

export function MonthView({ range, anchorDate, instances, today, tz, weekStartsOn, onOpen, onCreateAt, onPickDate }) {
  const days = datesBetween(range.startDate, range.endDate);
  const byDate = useMemo(() => groupByDate(instances, range.startDate, range.endDate), [instances, range.startDate, range.endDate]);
  const month = anchorDate.slice(0, 7);
  const MAX = 3;
  return (
    <div className="month">
      <div className="month-head">
        {weekdayLabels(weekStartsOn).map((w, i) => (
          <div key={w} className={`wd ${(i + weekStartsOn) % 7 === 0 ? 'sun' : ''} ${(i + weekStartsOn) % 7 === 6 ? 'sat' : ''}`}>{w}</div>
        ))}
      </div>
      <div className="month-grid">
        {days.map((d) => {
          const list = byDate.get(d) || [];
          const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
          return (
            <div key={d} className={`cell ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today ? 'today' : ''}`}
              onClick={() => onCreateAt(d)} role="gridcell" aria-label={`${d} 일정 ${list.length}개`}>
              <button type="button" className={`daynum ${dow === 0 ? 'sun' : ''} ${dow === 6 ? 'sat' : ''}`}
                onClick={(e) => { e.stopPropagation(); onPickDate(d); }}>{Number(d.slice(8))}</button>
              <div className="cell-events">
                {list.slice(0, MAX).map((inst) => (
                  <Chip key={inst.key} inst={inst} tz={tz} onOpen={onOpen} compact continued={inst.startDate < d} />
                ))}
                {list.length > MAX && (
                  <button type="button" className="more" onClick={(e) => { e.stopPropagation(); onPickDate(d); }}>+{list.length - MAX}개</button>
                )}
              </div>
              {list.length > 0 && (
                <div className="cell-dots" aria-hidden>
                  {list.slice(0, 4).map((inst) => <span key={inst.key} style={{ background: inst.color }} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimeGridView({ days, instances, today, tz, onOpen, onCreateAt }) {
  const zone = safeZone(tz);
  const scroller = useRef(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = HOUR_PX * 7.5;
  }, [days[0]]);

  const allDayByDate = useMemo(() => groupByDate(instances.filter((i) => i.allDay), days[0], days[days.length - 1]), [instances, days]);
  const columns = days.map((d) => {
    const dayStart = DateTime.fromISO(d, { zone }).toMillis();
    const dayEnd = DateTime.fromISO(d, { zone }).plus({ days: 1 }).toMillis();
    const items = instances
      .filter((i) => !i.allDay && i.startMs < dayEnd && i.endMs > dayStart)
      .map((i) => {
        const top = ((Math.max(i.startMs, dayStart) - dayStart) / 60000) * (HOUR_PX / 60);
        const bottom = ((Math.min(Math.max(i.endMs, i.startMs + 15 * 60000), dayEnd) - dayStart) / 60000) * (HOUR_PX / 60);
        return { key: i.key, inst: i, top, bottom: Math.max(bottom, top + 18) };
      });
    return { d, dayStart, dayEnd, items, layout: layoutOverlaps(items) };
  });

  return (
    <div className="tgrid">
      <div className="tgrid-head" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((d) => {
          const dt = DateTime.fromISO(d);
          return (
            <div key={d} className={`tgrid-day ${d === today ? 'today' : ''}`}>
              <span className="wdname">{WEEKDAYS[dt.weekday % 7]}</span>
              <span className="wdnum">{dt.day}</span>
            </div>
          );
        })}
      </div>
      <div className="tgrid-allday" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <div className="tgrid-label">종일</div>
        {days.map((d) => (
          <div key={d} className="tgrid-allday-cell" onClick={() => onCreateAt(d)}>
            {(allDayByDate.get(d) || []).map((inst) => (
              <Chip key={inst.key} inst={inst} tz={tz} onOpen={onOpen} continued={inst.startDate < d} />
            ))}
          </div>
        ))}
      </div>
      <div className="tgrid-scroll" ref={scroller}>
        <div className="tgrid-body" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, height: HOUR_PX * 24 }}>
          <div className="tgrid-hours">
            {Array.from({ length: 24 }, (_, h) => <div key={h} style={{ height: HOUR_PX }}><span>{h === 0 ? '' : `${h}:00`}</span></div>)}
          </div>
          {columns.map((col) => (
            <div key={col.d} className="tgrid-col" onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const hour = Math.floor((e.clientY - rect.top) / HOUR_PX);
              onCreateAt(col.d, Math.min(23, Math.max(0, hour)));
            }}>
              {Array.from({ length: 24 }, (_, h) => <div key={h} className="hline" style={{ top: h * HOUR_PX }} />)}
              {now >= col.dayStart && now < col.dayEnd && (
                <div className="now-line" style={{ top: ((now - col.dayStart) / 60000) * (HOUR_PX / 60) }} />
              )}
              {col.items.map((it) => {
                const pos = col.layout.get(it.key);
                const width = 100 / pos.cols;
                const inst = it.inst;
                return (
                  <button type="button" key={it.key}
                    className={`tevent ${inst.subscribed ? 'chip-sub' : ''} ${inst.ev.completed ? 'chip-done' : ''} ${inst.hiddenDetails ? 'chip-busy' : ''}`}
                    style={{ top: it.top, height: it.bottom - it.top - 2, left: `calc(${pos.col * width}% + 2px)`, width: `calc(${width}% - 4px)`, '--c': inst.color }}
                    onClick={(e) => { e.stopPropagation(); onOpen(inst); }}
                    title={`${inst.title} · ${inst.calendarName}`}>
                    <span className="tevent-title">{inst.subscribed ? '🔗 ' : ''}{inst.title}</span>
                    <span className="tevent-time">{formatTime(inst.startMs, tz)}–{formatTime(inst.endMs, tz)}</span>
                    {inst.subscribed && <span className="tevent-src">{inst.calendarName}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ListView({ instances, range, today, tz, onOpen, emptyText }) {
  const byDate = useMemo(() => groupByDate(instances, range.startDate, range.endDate), [instances, range.startDate, range.endDate]);
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return <div className="empty">{emptyText}</div>;
  return (
    <div className="list">
      {dates.map((d) => {
        const dt = DateTime.fromISO(d).setLocale('ko');
        return (
          <section key={d} className={`list-day ${d === today ? 'today' : ''}`}>
            <h3>{dt.toFormat('M월 d일 (ccc)')}{d === today && <span className="badge">오늘</span>}</h3>
            {byDate.get(d).map((inst) => (
              <button type="button" key={inst.key} className={`list-item ${inst.ev.completed ? 'chip-done' : ''}`} onClick={() => onOpen(inst)}>
                <span className="list-color" style={{ background: inst.color }} />
                <span className="list-time">{inst.allDay ? '종일' : `${formatTime(inst.startMs, tz)}–${formatTime(inst.endMs, tz)}`}</span>
                <span className="list-main">
                  <span className="list-title">{inst.ev.kind === 'anniversary' ? '🎉 ' : ''}{inst.title}</span>
                  <span className="list-sub">
                    {inst.subscribed ? `🔗 구독 · ${inst.calendarName}` : inst.calendarName}
                    {inst.location ? ` · ${inst.location}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
