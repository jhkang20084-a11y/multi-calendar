import { useEffect, useMemo, useRef, useState } from 'react';
import { holidayOf, holidayFullName, specialDayOf } from '../lib/holidays.js';
import { DateTime } from 'luxon';
import { groupByDate, layoutOverlaps, layoutWeek, whoLabel } from '../lib/feed.js';
import { formatTime, safeZone, addDays } from '../lib/time.js';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const HOUR_PX = 48;

function weekdayLabels(weekStartsOn) {
  return Array.from({ length: 7 }, (_, i) => WEEKDAYS[(i + weekStartsOn) % 7]);
}

function datesBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 일정 칩: 색(분류 색, 구독 일정은 원본 캘린더 색) + 제목 */
function Chip({ inst, tz, onOpen, compact, continued }) {
  const style = { '--c': inst.color };
  const cls = ['chip', inst.allDay ? 'chip-allday' : 'chip-timed',
    inst.ev.completed ? 'chip-done' : '', inst.hiddenDetails ? 'chip-busy' : ''].join(' ');
  return (
    <button type="button" className={cls} style={style} onClick={(e) => { e.stopPropagation(); onOpen(inst); }}
      title={`${inst.title} · ${whoLabel(inst)}`}>
      {!inst.allDay && !compact && <span className="chip-time">{formatTime(inst.startMs, tz)}</span>}
      {continued && <span aria-hidden>›</span>}
      <span className="chip-title">{inst.title}</span>
    </button>
  );
}

/** 좌우로 밀어서 이전/다음으로 이동 */
function useSwipe(onSwipe) {
  const start = useRef(null);
  return {
    onTouchStart: (e) => {
      if (e.touches.length !== 1) { start.current = null; return; }
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, at: Date.now() };
    },
    onTouchEnd: (e) => {
      if (!start.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      const quick = Date.now() - start.current.at < 600;
      start.current = null;
      // 의도한 빠르고 확실한 좌우 밀기만 월 이동으로 처리 (살짝 스치는 것은 무시)
      if (quick && Math.abs(dx) > 90 && Math.abs(dy) < 40 && Math.abs(dx) > Math.abs(dy) * 3) onSwipe(dx < 0 ? 1 : -1);
    },
  };
}

/** 화면 폭에 따라 한 칸에 보일 일정 줄 수 (휴대폰 좁은 화면 2줄, 그 외 3줄) */
function useMaxLanes() {
  const get = () => (typeof window !== 'undefined' && window.innerWidth <= 420 ? 2 : 3);
  const [n, setN] = useState(get);
  useEffect(() => {
    const on = () => setN(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return n;
}

/** 월간 달력의 일정 막대: 여러 날 일정은 이어진 하나의 막대, 제목은 한 번만 */
function Bar({ bar, tz, onOpen }) {
  const { inst, startCol, span, lane, contLeft, contRight } = bar;
  const multi = span > 1 || contLeft || contRight || inst.startDate !== inst.endDate;
  const cls = ['chip', 'bar', inst.allDay || multi ? 'chip-allday' : 'chip-timed',
    contLeft ? 'cont-left' : '', contRight ? 'cont-right' : '',
    inst.ev.completed ? 'chip-done' : '', inst.hiddenDetails ? 'chip-busy' : ''].join(' ');
  return (
    <button type="button" className={cls}
      style={{ '--c': inst.color, '--col': startCol, '--span': span, '--lane': lane }}
      onClick={(e) => { e.stopPropagation(); onOpen(inst); }}
      title={`${inst.title} · ${whoLabel(inst)}`}>
      <span className="chip-title">{inst.title}</span>
      {!inst.allDay && !multi && <span className="chip-time">{formatTime(inst.startMs, tz)}</span>}
    </button>
  );
}

export function MonthView({
  range, anchorDate, instances, today, tz, weekStartsOn, selectedDate, sketch,
  onOpen, onSelectDate, onCreateAt, onSwipe,
}) {
  const days = datesBetween(range.startDate, range.endDate);
  const month = anchorDate.slice(0, 7);
  const swipe = useSwipe(onSwipe);
  const maxLanes = useMaxLanes();
  // 마지막 주가 모두 다음 달이면 그리지 않는다(종이 달력처럼 5줄)
  const visible = days.slice(35).every((d) => d.slice(0, 7) !== month) ? days.slice(0, 35) : days;
  const weeks = useMemo(() => {
    const out = [];
    for (let i = 0; i < visible.length; i += 7) {
      const dates = visible.slice(i, i + 7);
      out.push({ dates, ...layoutWeek(instances, dates, maxLanes) });
    }
    return out;
  }, [instances, visible.join(','), maxLanes]);
  const byDate = useMemo(() => groupByDate(instances, visible[0], visible[visible.length - 1]), [instances, visible.join(',')]);

  return (
    <div className={`month ${sketch ? 'sketch' : ''}`} style={{ '--lanes': maxLanes }} {...swipe}>
      <div className="month-head">
        {weekdayLabels(weekStartsOn).map((w, i) => {
          const dow = (i + weekStartsOn) % 7;
          return <div key={w} className={`wd ${dow === 0 ? 'sun' : ''} ${dow === 6 ? 'sat' : ''}`}>{WEEKDAYS_EN[dow]}</div>;
        })}
      </div>
      <div className="month-body">
        <div className="month-lines" aria-hidden>{visible.map((d) => <div key={d} />)}</div>
        <div className="month-grid" role="grid">
          {weeks.map((w) => (
            <div className="week" role="row" key={w.dates[0]}>
              {w.dates.map((d, col) => {
                const count = (byDate.get(d) || []).length;
                const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                const hol = holidayOf(d);
                const special = !hol && specialDayOf(d);
                return (
                  <div key={d}
                    className={`cell ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today ? 'today' : ''} ${d === selectedDate ? 'selected' : ''}`}
                    onClick={() => onSelectDate(d)} onDoubleClick={() => onCreateAt(d)}
                    role="gridcell" aria-selected={d === selectedDate} aria-label={`${d}${hol ? ` ${hol}` : ''} 일정 ${count}개`}>
                    <div className="cell-top">
                      <span className={`daynum ${dow === 0 ? 'sun' : ''} ${dow === 6 ? 'sat' : ''} ${hol ? 'holiday' : ''}`}>{Number(d.slice(8))}</span>
                      {hol && <span className="holiday-name" title={holidayFullName(d)}>{hol}</span>}
                      {special && <span className="holiday-name special">{special}</span>}
                    </div>
                    {w.hidden[col] > 0 && <span className="more">+{w.hidden[col]}</span>}
                  </div>
                );
              })}
              <div className="week-events">
                {w.bars.map((bar) => <Bar key={`${bar.inst.key}@${w.dates[0]}`} bar={bar} tz={tz} onOpen={onOpen} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TimeGridView({ days, instances, today, tz, onOpen, onCreateAt, onSwipe }) {
  const swipe = useSwipe(onSwipe);
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
    <div className="tgrid" {...swipe}>
      <div className="tgrid-head" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((d) => {
          const dt = DateTime.fromISO(d);
          const dow = dt.weekday % 7;
          const hol = holidayOf(d);
          return (
            <div key={d} className={`tgrid-day ${d === today ? 'today' : ''} ${dow === 0 ? 'sun' : ''} ${dow === 6 ? 'sat' : ''} ${hol ? 'holiday' : ''}`}>
              <span className="wdname">{WEEKDAYS_EN[dow]}</span>
              <span className="wdnum">{dt.day}</span>
              {hol && <span className="hname">{hol}</span>}
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
                    className={`tevent ${inst.ev.completed ? 'chip-done' : ''} ${inst.hiddenDetails ? 'chip-busy' : ''}`}
                    style={{ top: it.top, height: it.bottom - it.top - 2, left: `calc(${pos.col * width}% + 2px)`, width: `calc(${width}% - 4px)`, '--c': inst.color }}
                    onClick={(e) => { e.stopPropagation(); onOpen(inst); }}
                    title={`${inst.title} · ${whoLabel(inst)}`}>
                    <span className="tevent-title">{inst.title}</span>
                    <span className="tevent-time">{formatTime(inst.startMs, tz)}–{formatTime(inst.endMs, tz)}</span>
                    {inst.subscribed && <span className="tevent-src">{whoLabel(inst)}</span>}
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
            <h3><span className="dlabel">{dt.toFormat('M월 d일 (ccc)')}</span>{holidayOf(d) && <span className="hname">{holidayOf(d)}</span>}{d === today && <span className="badge">오늘</span>}</h3>
            {byDate.get(d).map((inst) => (
              <button type="button" key={inst.key} className={`list-item ${inst.ev.completed ? 'chip-done' : ''}`} onClick={() => onOpen(inst)}>
                <span className="list-color" style={{ background: inst.color }} />
                <span className="list-time">{inst.allDay ? '종일' : `${formatTime(inst.startMs, tz)}–${formatTime(inst.endMs, tz)}`}</span>
                <span className="list-main">
                  <span className="list-title">{inst.title}</span>
                  <span className="list-sub">
                    {whoLabel(inst)}
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
