import { suggest } from '../js/classify.js';

const cases = [
  ['검정 니트 가디건, 얇음, 출근용', { category: '아우터', color: '블랙', thickness: '얇음', formality: 'work' }],
  ['아이보리 오프숄더 니트', { category: '상의', color: '아이보리' }],
  ['네이비 플레어 스커트 무릎 아래', { category: '하의', color: '네이비', length: '미디' }],
  ['차콜 와이드 슬랙스 출근용', { category: '하의', color: '차콜', length: '롱', formality: 'work' }],
  ['베이지 롱 트렌치코트 보통 두께', { category: '아우터', color: '베이지', thickness: '보통' }],
  ['블랙 스웨이드 숄더백 출근용 큰 가방', { category: '가방', color: '블랙', size: '큰 가방' }],
  ['화이트 미니 크로스백', { category: '가방', color: '화이트', size: '작은 가방' }],
  ['브라운 앵클부츠', { category: '신발', color: '브라운' }],
  ['검정 기모 스타킹', { category: '양말·스타킹', color: '블랙' }],
  ['소라색 셔츠 원피스 미디', { category: '원피스', color: '소라', length: '미디' }],
  ['아이보리 숏패딩 두꺼움 주말용', { category: '아우터', thickness: '두꺼움', formality: 'casual' }],
  ['진주 귀걸이', { category: '액세서리' }],
];
let ok = true;
for (const [desc, exp] of cases) {
  const s = suggest(desc);
  const bad = Object.entries(exp).filter(([k, v]) => s[k] !== v);
  ok &&= !bad.length;
  console.log(`${bad.length ? '❌' : '✅'} "${desc}" → ${s.category} · ${s.color} · 기장 ${s.length ?? '-'} · 두께 ${s.thickness ?? '-'} · ${s.size ?? '-'} · ${s.formality}` +
    (bad.length ? `  (틀림: ${bad.map(([k, v]) => `${k}=${s[k]} 기대 ${v}`).join(', ')})` : ''));
}
process.exit(ok ? 0 : 1);
