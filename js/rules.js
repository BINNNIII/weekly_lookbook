// 코디 규칙 (프롬프트 v2 · 1-3, 1-4, 2번). AI가 무엇을 고르든 이 규칙을 통과해야만 저장된다.

export const THICK = { '얇음': 1, '보통': 2, '두꺼움': 3 };
const THICK_NAME = { 1: '얇음', 2: '보통', 3: '두꺼움' };

export const isWorkday = code => !!code && code !== '휴무';
const isLongBoots = i => i.category === '신발' && (i.type === '롱부츠' || /롱부츠/.test(i.name));
const isBoots = i => i.category === '신발' && /부츠/.test(`${i.type} ${i.name}`);
const isShortPadding = i => i.category === '아우터' && /숏패딩/.test(`${i.type} ${i.name}`);
const isBottomLike = i => i.category === '하의' || i.category === '원피스';
const isMini = i => isBottomLike(i) && i.length === '미니';
const isPants = i => i.category === '하의' && /슬랙스|바지|팬츠|데님|청바지|레깅스/.test(`${i.type} ${i.name}`) && !/치마바지/.test(`${i.type} ${i.name}`);

// 아침(외출) 기온 → 필요한 아우터 두께
export function morningTemp(ctx) {
  if (ctx.commuteTemp != null) return ctx.commuteTemp;
  if (ctx.firstOutTemp != null) return ctx.firstOutTemp;
  return ctx.min ?? null;
}
// 반환: { need: 0~3 (가장 따뜻한 아우터의 최소 두께), maxAllowed: 1~3 }
export function outerNeed(ctx) {
  const t = morningTemp(ctx);
  if (t == null) return { need: null, maxAllowed: 3, temp: null };
  const need = needFor(t, isWorkday(ctx.workCode));
  const maxAllowed = t >= 13 ? 2 : 3; // 아침 13℃ 이상이면 두꺼운 코트·패딩은 과함
  return { need, maxAllowed, temp: t };
}
// 아침 기온 → 기온 구간 (3 아주 추움 · 2 쌀쌀 · 1 선선 · 0 따뜻). '또 입기'도 이 구간으로 비슷한 날을 찾는다
export function needFor(t, work) {
  const thick = work ? 5 : 2;      // 이 기온 이하면 두꺼운 아우터 필수
  return t <= thick ? 3 : t <= 12 ? 2 : t <= 17 ? 1 : 0;
}

// 날짜 하나의 상황
// ctx = { date, workCode, schedule[], min, max, pop, commuteTemp, firstOutTemp }
export function itemBlockReason(i, ctx) {
  const work = isWorkday(ctx.workCode);
  const sched = (ctx.schedule || []).join(' ');
  if (work) {
    if (i.category === '가방' && i.size !== '큰 가방') return '출근일에는 큰 가방만';
    if (isLongBoots(i)) return '출근일에는 롱부츠 X';
    if (isBottomLike(i) && (i.length === '미니' || !i.length || i.length === '확인 필요')) return '출근일에는 짧은 치마 X';
    if (i.formality === 'casual' && !['양말·스타킹', '액세서리'].includes(i.category)) return '출근일에는 포멀하게';
  }
  if (i.category === '아우터') {
    const { maxAllowed } = outerNeed(ctx);
    if ((THICK[i.thickness] || 2) > maxAllowed) return '기온에 비해 두꺼운 아우터';
    if (isShortPadding(i) && (ctx.max ?? 0) >= 13) return '낮 13℃ 이상에 숏패딩은 과함';
  }
  if (/건강검진/.test(sched)) {
    if (i.category === '원피스') return '건강검진: 갈아입기 편하게 원피스 X';
    if (isBoots(i)) return '건강검진: 부츠 X';
  }
  return null;
}

export function candidates(items, ctx) {
  return items.filter(i => !itemBlockReason(i, ctx));
}

// 고른 조합 검사 → 위반 사항 목록 (빈 배열이면 통과)
export function validateOutfit(ids, items, ctx) {
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const errs = [];
  const picked = [];
  for (const id of ids) {
    const i = byId[id];
    if (!i) { errs.push(`옷장에 없는 옷 id: ${id}`); continue; }
    picked.push(i);
    const r = itemBlockReason(i, ctx);
    if (r) errs.push(`${i.name}(${i.color}): ${r}`);
  }
  const n = c => picked.filter(i => i.category === c).length;
  const onepiece = n('원피스');
  if (onepiece > 1) errs.push('원피스는 하나만');
  const innerCardigan = n('아우터') === 2 && picked.some(i => i.category === '아우터' && /가디건/.test(`${i.type} ${i.name}`));
  if (!onepiece && n('상의') < 1 && !innerCardigan) errs.push('상의가 없음');
  if (!onepiece && n('하의') !== 1) errs.push('하의는 정확히 하나');
  if (onepiece && n('하의')) errs.push('원피스와 하의를 같이 입음');
  if (n('상의') > 2) errs.push('상의는 최대 2개(레이어드)');
  if (n('신발') !== 1) errs.push('신발은 정확히 하나');
  if (n('가방') !== 1) errs.push('가방은 정확히 하나');
  if (n('아우터') > 2) errs.push('아우터는 최대 2개');
  if (n('양말·스타킹') > 1) errs.push('양말·스타킹은 최대 하나');

  const { need, temp } = outerNeed(ctx);
  const warmest = Math.max(0, ...picked.filter(i => i.category === '아우터').map(i => THICK[i.thickness] || 2));
  if (need && warmest < need) errs.push(`아침 ${temp}℃: ${THICK_NAME[need]} 이상 두께의 아우터가 필요함`);

  if (picked.some(isLongBoots)) {
    const bottom = picked.find(isBottomLike);
    if (!bottom || !isMini(bottom)) errs.push('롱부츠는 짧은 치마와만');
    if (picked.some(isPants)) errs.push('롱부츠에 바지 X');
  }
  return [...new Set(errs)];
}

// AI에게 알려 줄 그날의 규칙 요약
export function dayRuleText(ctx) {
  const work = isWorkday(ctx.workCode);
  const { need, maxAllowed, temp } = outerNeed(ctx);
  const lines = [];
  if (work) lines.push('출근일: 포멀·비즈니스 캐주얼, 짧은 치마 X, 큰 가방(쇼퍼백·숄더백)만, 롱부츠 X');
  else lines.push('휴무일: 덜 포멀해도 됨. 일정에 맞출 것. 롱부츠는 짧은 치마와만');
  if (temp != null) lines.push(`아침 기온 ${temp}℃ → 가장 따뜻한 아우터 ${need ? THICK_NAME[need] + ' 이상' : '없어도 됨'}${maxAllowed < 3 ? ', 두꺼움은 과함' : ''}`);
  if ((ctx.pop ?? 0) >= 60) lines.push('비 예보: 앵클부츠처럼 비에 강한 신발, 편한 핏');
  if (work && /M1|B/.test(ctx.workCode)) lines.push('긴 근무: 편한 핏 우선');
  const s = (ctx.schedule || []).join(' ');
  if (/건강검진/.test(s)) lines.push('건강검진: 갈아입기 편하게, 원피스·부츠 X');
  if (/교회|송별회|결혼|돌잔치|하객|모임|약속|청모/.test(s)) lines.push('하객룩·단정한 모임룩');
  if (/강의/.test(s)) lines.push('강의 자리까지 단정하게');
  return lines;
}
