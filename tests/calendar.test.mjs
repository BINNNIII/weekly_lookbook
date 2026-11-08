import { workCodeOf, buildDays, diffDays } from '../js/calendar.js';

let ok = true;
const eq = (name, a, b) => { const p = JSON.stringify(a) === JSON.stringify(b); ok &&= p; console.log(`${p ? '✅' : '❌'} ${name}${p ? '' : `  → ${JSON.stringify(a)} (기대 ${JSON.stringify(b)})`}`); };

eq('출근 A', workCodeOf('출근 A'), 'A');
eq('출근 M1', workCodeOf('출근 M1'), 'M1');
eq('B 근무', workCodeOf('B 근무'), 'B');
eq('M', workCodeOf('M'), 'M');
eq('휴무', workCodeOf('휴무'), '휴무');
eq('교회는 근무 아님', workCodeOf('교회'), null);
eq('Mom 생일은 근무 아님', workCodeOf('Mom 생일'), null);

const dates = ['2026-11-11', '2026-11-12', '2026-11-13'];
const ev = [
  { cal: '기본', title: '건강검진', date: '2026-11-11', allDay: false, start: '08:00', end: '09:00' },
  { cal: '기본', title: '출근 A', date: '2026-11-12', allDay: false, start: '06:30', end: '15:30' },
  { cal: '개인업무', title: '개인 강의', date: '2026-11-13', allDay: false, start: '17:30', end: '19:00' },
  { cal: '기본', title: 'B', date: '2026-11-13', allDay: true },
];
const days = buildDays(ev, dates, { B: '12:30–21:30' });
eq('휴무일 일정', days['2026-11-11'], { workCode: '휴무', schedule: ['08:00 건강검진'], holiday: null });
eq('A 근무', days['2026-11-12'].schedule, ['06:30–15:30 근무']);
eq('종일 B → 설정 시간', days['2026-11-13'].schedule, ['12:30–21:30 근무', '17:30 개인 강의']);

const old = { '2026-11-12': { workCode: '휴무', schedule: [] }, '2026-11-13': { workCode: 'B', schedule: ['12:30–21:30 근무'] } };
const ch = diffDays(old, days, '2026-11-12');
eq('변경 감지', ch.map(c => `${c.date} ${c.msgs.join(' / ')}`), ['2026-11-12 휴무 → A근무', '2026-11-13 일정 추가: 17:30 개인 강의']);
eq('지난 날짜는 무시', diffDays({ '2026-11-11': { workCode: 'A', schedule: [] } }, days, '2026-11-12'), []);
process.exit(ok ? 0 : 1);
