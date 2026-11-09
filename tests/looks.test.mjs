import assert from 'node:assert/strict';
import { condOf, condLabel, sameCond, pickFav } from '../js/looks.js';

// 기온 구간
assert.equal(condOf({ workCode: 'A', commuteTemp: 5 }).band, 3);
assert.equal(condOf({ workCode: 'A', commuteTemp: 6 }).band, 2);
assert.equal(condOf({ workCode: '휴무', min: 3 }).band, 2);
assert.equal(condOf({ workCode: '휴무', min: 2 }).band, 3);
assert.equal(condOf({ workCode: 'B', commuteTemp: 15 }).band, 1);
assert.equal(condOf({ workCode: 'B', commuteTemp: 20 }).band, 0);
assert.equal(condOf({ workCode: 'A' }).band, null);
assert.equal(condOf({ workCode: 'A' }, 9).band, 2);
assert.equal(condLabel(condOf({ workCode: 'A', commuteTemp: 8 })), '출근 · 쌀쌀한 날 (아침 6~12℃)');
assert.ok(sameCond(condOf({ workCode: 'A', commuteTemp: 7 }), condOf({ workCode: 'M', commuteTemp: 11 })));
assert.ok(!sameCond(condOf({ workCode: 'A', commuteTemp: 7 }), condOf({ workCode: '휴무', min: 7 })));

// 옷장 (출근 가능한 최소 조합)
const items = [
  { id: 't1', category: '상의', type: '블라우스', name: '블라우스', color: '아이보리', formality: 'work' },
  { id: 'b1', category: '하의', type: '슬랙스', name: '슬랙스', color: '네이비', length: '롱', formality: 'work' },
  { id: 'o1', category: '아우터', type: '코트', name: '코트', color: '검정', thickness: '보통', formality: 'work' },
  { id: 's1', category: '신발', type: '로퍼', name: '로퍼', color: '검정', formality: 'work' },
  { id: 'g1', category: '가방', type: '쇼퍼백', name: '쇼퍼백', color: '검정', size: '큰 가방', formality: 'work' },
];
const fav = { id: 'fav-2026-11-10', date: '2026-11-10', itemIds: ['t1', 'b1', 'o1', 's1', 'g1'], cond: condOf({ workCode: 'A', commuteTemp: 8 }) };
const work8 = { workCode: 'A', commuteTemp: 8, schedule: [] };
assert.equal(pickFav([fav], '2026-11-24', work8, items, [])?.id, fav.id);                    // 비슷한 날 → 고름
assert.equal(pickFav([fav], '2026-11-24', { workCode: '휴무', min: 8 }, items, []), null);   // 휴무 → 안 고름
assert.equal(pickFav([fav], '2026-11-24', { workCode: 'A', commuteTemp: 15 }, items, []), null); // 선선한 날 → 안 고름
assert.equal(pickFav([fav], '2026-11-24', work8, items.filter(i => i.id !== 'b1'), []), null);   // 옷장에서 지운 옷 → 안 고름
const worn = [{ date: '2026-11-20', items: [...fav.itemIds] }];
assert.equal(pickFav([fav], '2026-11-24', work8, items, worn), null);                         // 앞뒤 6일 안에 입음 → 안 고름
assert.equal(pickFav([fav], '2026-11-27', work8, items, worn)?.id, fav.id);                   // 7일 지남 → 고름
// 여러 개면 오래 안 입은 것부터
const fav2 = { ...fav, id: 'fav-2026-11-03', date: '2026-11-03' };
const fav3 = { ...fav, id: 'fav-x', date: '2026-11-05', itemIds: ['t1', 'b1', 'o1', 's1', 'g1'].reverse() };
assert.equal(pickFav([fav, fav2], '2026-12-20', work8, items, [{ date: '2026-12-01', items: fav.itemIds }])?.id, 'fav-2026-11-03');
console.log('looks ok');
