import { readFileSync } from 'node:fs';
import { validateOutfit, candidates, itemBlockReason } from '../js/rules.js';
const starter = JSON.parse(readFileSync(new URL('../../데이터/v1/시작용_백업_v1.json', import.meta.url)));
const items = starter.items;
let ok = true;
const ctxOf = o => ({ date: o.date, workCode: o.workCode, schedule: o.schedule, min: o.weather.min, max: o.weather.max, pop: o.weather.pop });
console.log('[이전 대화 확정 코디는 모두 통과해야 함]');
for (const o of starter.outfits) {
  const e = validateOutfit(o.items, items, ctxOf(o));
  ok &&= !e.length;
  console.log(`${e.length ? '❌' : '✅'} ${o.date} ${o.workCode} ${e.join(' / ')}`);
}
console.log('[금지 조합은 걸러져야 함]');
const work = { workCode: 'A', schedule: ['06:30–15:30 근무'], min: 2, max: 15 };
const bad = [
  ['출근일 작은 가방', ['t03', 'b08', 'o01', 's01', 'g03'], work, '큰 가방'],
  ['출근일 롱부츠', ['t03', 'b08', 'o01', 's04', 'g01'], work, '롱부츠'],
  ['출근일 짧은 치마', ['t03', 'b06', 'o01', 's01', 'g01'], work, '짧은 치마'],
  ['추운 아침 얇은 아우터', ['t03', 'b08', 'o06', 's01', 'g01'], work, '두께의 아우터'],
  ['낮 15℃ 숏패딩', ['t01', 'b11', 'o02', 's07', 'g02'], { workCode: '휴무', schedule: [], min: 3, max: 15 }, '숏패딩'],
  ['롱부츠 + 긴 치마', ['t01', 'b05', 'k02', 's04', 'g02'], { workCode: '휴무', schedule: [], min: 9, max: 13 }, '짧은 치마와만'],
  ['건강검진 부츠', ['t01', 'b11', 'k02', 's02', 'g02'], { workCode: '휴무', schedule: ['08:00 건강검진'], min: 5, max: 15 }, '건강검진'],
  ['가방 없음', ['t03', 'b08', 'o01', 's01'], work, '가방은 정확히 하나'],
];
for (const [name, ids, ctx, expect] of bad) {
  const e = validateOutfit(ids, items, ctx);
  const hit = e.some(x => x.includes(expect));
  ok &&= hit;
  console.log(`${hit ? '✅' : '❌'} ${name} → ${e.join(' / ') || '통과(잘못됨)'}`);
}
const c = candidates(items, work);
console.log(`[출근일 후보] ${c.length}/${items.length}개 · 작은 가방 ${c.some(i => i.id === 'g03') ? '포함❌' : '제외✅'} · 롱부츠 ${c.some(i => i.id === 's04') ? '포함❌' : '제외✅'} · 가을아우터(얇음) ${c.some(i => i.id === 'o06') ? '후보에는 있음(레이어드용)' : '제외'}`);
process.exit(ok ? 0 : 1);
