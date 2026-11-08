import { weekOf, nextWeek, addDays } from '../js/weekRange.js';

const cases = [
  ['2026-11-01', '2026-11-01', '2026-11-08', '2026년 11월 1일(일)'],
  ['2026-11-30', '2026-11-23', '2026-11-30', '2026년 11월 30일(월)'],
  ['2026-12-01', '2026-12-01', '2026-12-06', '2026년 12월 1일(화)'],
  ['2026-12-31', '2026-12-28', '2026-12-31', '2026년 12월 31일(목)'],
  ['2027-01-01', '2027-01-01', '2027-01-10', '2027년 1월 1일(금)'],
];
let ok = true;
for (const [d, s, e, label] of cases) {
  const w = weekOf(d);
  const pass = w.start === s && w.end === e;
  ok &&= pass;
  console.log(`${pass ? '✅' : '❌'} ${label} → ${w.start} ~ ${w.end} (기대: ${s} ~ ${e})`);
}

// 2026~2030 전체 날짜: 빈틈·겹침 없이 이어지고, 한 주는 4~12일인지
let d = '2026-01-01', prevEnd = null, count = 0;
while (d < '2031-01-01') {
  const w = weekOf(d);
  if (prevEnd && w.start !== addDays(prevEnd, 1)) { ok = false; console.log('❌ 빈틈/겹침', prevEnd, w.start); }
  if (w.days.length < 4 || w.days.length > 12) { ok = false; console.log('❌ 길이 이상', w.start, w.end, w.days.length); }
  prevEnd = w.end; d = addDays(w.end, 1); count++;
}
console.log(`${ok ? '✅' : '❌'} 2026~2030년 ${count}개 주 연속성 검사`);
console.log('오늘(2026-11-08) 주:', weekOf('2026-11-08').start, '~', weekOf('2026-11-08').end,
  '/ 다음 주:', nextWeek('2026-11-08').start, '~', nextWeek('2026-11-08').end);
process.exit(ok ? 0 : 1);
