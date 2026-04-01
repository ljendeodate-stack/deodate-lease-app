import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const POPUP_WIDTH = 288;
const POPUP_GUTTER = 12;
const POPUP_GAP = 6;

function parseMDY(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function formatMDY(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function isSameDay(left, right) {
  return Boolean(
    left &&
    right &&
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export default function DatePicker({
  value,
  onChange,
  placeholder = 'MM/DD/YYYY',
  error = false,
  leaseMonthLabel = '',
  className = '',
  minDate = null,
  maxDate = null,
}) {
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState({ top: POPUP_GUTTER, left: POPUP_GUTTER, placement: 'bottom' });
  const parsed = useMemo(() => parseMDY(value), [value]);
  const minParsed = useMemo(() => {
    if (!minDate) return null;
    return minDate instanceof Date ? minDate : parseMDY(minDate);
  }, [minDate]);
  const maxParsed = useMemo(() => {
    if (!maxDate) return null;
    return maxDate instanceof Date ? maxDate : parseMDY(maxDate);
  }, [maxDate]);
  const today = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);
  const [viewYear, setViewYear] = useState(() => parsed?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => parsed?.getMonth() ?? today.getMonth());
  const containerRef = useRef(null);
  const popupRef = useRef(null);

  useEffect(() => {
    if (!parsed) return;
    setViewYear(parsed.getFullYear());
    setViewMonth(parsed.getMonth());
  }, [parsed]);

  useEffect(() => {
    if (!open) return undefined;

    function updatePopupPosition() {
      if (!containerRef.current || typeof window === 'undefined') return;

      const rect = containerRef.current.getBoundingClientRect();
      const popupHeight = popupRef.current?.offsetHeight || 320;
      const popupWidth = popupRef.current?.offsetWidth || POPUP_WIDTH;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const placement = spaceBelow < popupHeight + POPUP_GAP && spaceAbove > spaceBelow ? 'top' : 'bottom';
      const maxLeft = Math.max(POPUP_GUTTER, window.innerWidth - popupWidth - POPUP_GUTTER);
      const maxTop = Math.max(POPUP_GUTTER, window.innerHeight - popupHeight - POPUP_GUTTER);
      const left = Math.min(Math.max(rect.left, POPUP_GUTTER), maxLeft);
      const top = placement === 'top'
        ? Math.max(POPUP_GUTTER, rect.top - popupHeight - POPUP_GAP)
        : Math.min(maxTop, rect.bottom + POPUP_GAP);

      setPopupStyle({ top, left, placement });
    }

    function handlePointerDown(event) {
      const target = event.target;
      if (
        containerRef.current?.contains(target) ||
        popupRef.current?.contains(target)
      ) {
        return;
      }
      if (containerRef.current) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', updatePopupPosition);
    window.addEventListener('scroll', updatePopupPosition, true);
    updatePopupPosition();
    const rafId = window.requestAnimationFrame(updatePopupPosition);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', updatePopupPosition);
      window.removeEventListener('scroll', updatePopupPosition, true);
      window.cancelAnimationFrame(rafId);
    };
  }, [open, viewMonth, viewYear]);

  function selectDay(day) {
    const nextDate = new Date(viewYear, viewMonth, day);
    nextDate.setHours(0, 0, 0, 0);
    if ((minParsed && nextDate < minParsed) || (maxParsed && nextDate > maxParsed)) return;
    onChange?.(formatMDY(nextDate));
    setOpen(false);
  }

  function shiftMonth(delta) {
    const nextMonth = viewMonth + delta;
    if (nextMonth < 0) {
      setViewMonth(11);
      setViewYear((current) => current - 1);
      return;
    }
    if (nextMonth > 11) {
      setViewMonth(0);
      setViewYear((current) => current + 1);
      return;
    }
    setViewMonth(nextMonth);
  }

  function shiftYear(delta) {
    setViewYear((current) => current + delta);
  }

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells = [];
  for (let index = 0; index < firstDayOfWeek; index += 1) cells.push(null);
  for (let day = 1; day <= totalDays; day += 1) cells.push(day);
  const popupRoot = typeof document !== 'undefined' ? document.body : null;
  const calendarPopup = open && popupRoot
    ? createPortal(
      <div
        ref={popupRef}
        data-datepicker-popup="true"
        data-placement={popupStyle.placement}
        className="z-50 rounded-[1rem] border border-app-border bg-app-panel shadow-panel"
        style={{
          position: 'fixed',
          top: `${popupStyle.top}px`,
          left: `${popupStyle.left}px`,
          width: `${POPUP_WIDTH}px`,
        }}
      >
        <div className="flex items-center justify-between border-b border-app-border px-3 py-2.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftYear(-1)}
              className="rounded-lg p-1 text-txt-muted hover:bg-app-surface hover:text-txt-primary"
              aria-label="Previous year"
              title="Previous year"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 18 12 12 18 6" />
                <polyline points="12 18 6 12 12 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-lg p-1 text-txt-muted hover:bg-app-surface hover:text-txt-primary"
              aria-label="Previous month"
              title="Previous month"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>

          <span className="text-sm font-semibold text-txt-primary">
            {MONTHS[viewMonth]} {viewYear}
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-lg p-1 text-txt-muted hover:bg-app-surface hover:text-txt-primary"
              aria-label="Next month"
              title="Next month"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => shiftYear(1)}
              className="rounded-lg p-1 text-txt-muted hover:bg-app-surface hover:text-txt-primary"
              aria-label="Next year"
              title="Next year"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 18 12 12 6 6" />
                <polyline points="12 18 18 12 12 6" />
              </svg>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 px-2 pt-2">
          {DAYS.map((day) => (
            <div key={day} className="py-1 text-center text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-txt-dim">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5 px-2 pb-2.5">
          {cells.map((day, index) => {
            if (day == null) return <div key={`empty-${index}`} />;

            const cellDate = new Date(viewYear, viewMonth, day);
            cellDate.setHours(0, 0, 0, 0);
            const selected = isSameDay(parsed, cellDate);
            const isToday = isSameDay(today, cellDate);
            const isDisabled = Boolean(
              (minParsed && cellDate < minParsed) ||
              (maxParsed && cellDate > maxParsed)
            );

            return (
              <button
                key={`${viewYear}-${viewMonth}-${day}`}
                type="button"
                onClick={() => selectDay(day)}
                disabled={isDisabled}
                className={[
                  'flex h-8 w-full items-center justify-center rounded-lg text-xs transition-colors',
                  isDisabled ? 'cursor-not-allowed text-txt-faint opacity-35' : '',
                  selected ? 'bg-accent text-app-chrome font-bold' : '',
                  !selected && isToday ? 'border border-accent/40 text-accent-soft' : '',
                  !selected && !isToday && !isDisabled ? 'text-txt-primary hover:bg-app-surface' : '',
                ].join(' ')}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>,
      popupRoot,
    )
    : null;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {leaseMonthLabel && parsed && (
        <span className="absolute -top-5 right-0 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-accent-soft">
          {leaseMonthLabel}
        </span>
      )}

      <div className="flex items-center">
        <input
          type="text"
          value={value ?? ''}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          className={`field-dark flex-1 ${error ? 'border-status-err-border bg-status-err-bg/70' : ''}`}
        />
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="ml-1.5 flex h-9 w-9 items-center justify-center rounded-[0.9rem] border border-app-border-strong bg-app-surface text-txt-muted transition-colors hover:bg-app-panel hover:text-txt-primary"
          aria-label="Toggle calendar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      </div>
      {calendarPopup}
    </div>
  );
}
