// '나중에 또 이렇게 입기' — 찜한 코디를 비슷한 날(출근/휴무가 같고 아침 기온 구간이 같은 날)에 다시 쓴다
import { needFor, morningTemp, isWorkday, validateOutfit } from './rules.js';

export const BAND_NAME = { 3: '아주 추운 날', 2: '쌀쌀한 날', 1: '선선한 날', 0: '따뜻한 날' };
const BAND_RANGE = {
  true: { 3: '아침 5℃ 이하', 2: '아침 6~12℃', 1: '아침 13~17℃', 0: '아침 18℃ 이상' },
  false: { 3: '아침 2℃ 이하', 2: '아침 3~12℃', 1: '아침 13~17℃', 0: '아침 18℃ 이상' },
};

// temp: 아침(출퇴근) 기온. 모르면 band = null
export function condOf(ctx, temp = morningTemp(ctx)) {
  const work = isWorkday(ctx.workCode);
  return { work, temp: temp ?? null, band: temp == null ? null : needFor(temp, work) };
}
export const condLabel = c => `${c.work ? '출근' : '휴무'} · ${c.band == null ? '기온 모름' : `${BAND_NAME[c.band]} (${BAND_RANGE[c.work][c.band]})`}`;
export const sameCond = (a, b) => !!a && !!b && a.band != null && a.work === b.work && a.band === b.band;
export const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;

// 날짜 d에 다시 입힐 찜 코디 고르기
//  favs: 찜 목록 · ctx: 그날 상황 · items: 옷장 · outfits: 다른 날 코디들 ({date, items})
//  조건: 같은 출근/휴무 + 같은 기온 구간, 지금 옷장·그날 규칙 통과, 앞뒤 6일 안에 같은 조합을 입지 않음
//  여러 개면 가장 오래 안 입은 것부터
export function pickFav(favs, d, ctx, items, outfits) {
  const c = condOf(ctx);
  const lastWorn = f => Math.max(-1, ...outfits.filter(o => o.date < d && sameSet(o.items, f.itemIds)).map(o => dayNum(o.date)));
  const ok = favs.filter(f => sameCond(f.cond, c)
    && !validateOutfit(f.itemIds, items, ctx).length
    && !outfits.some(o => o.date !== d && Math.abs(dayNum(o.date) - dayNum(d)) <= 6 && sameSet(o.items, f.itemIds)));
  ok.sort((a, b) => lastWorn(a) - lastWorn(b) || a.date.localeCompare(b.date));
  return ok[0] || null;
}
