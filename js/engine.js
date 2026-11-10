// 코디 짜기: 규칙으로 후보 거르기 → Claude(Sonnet 5.5)가 고르기 → 규칙으로 다시 검사 → 저장
import * as db from './db.js';
import { candidates, validateOutfit, dayRuleText, outerNeed, morningTemp } from './rules.js';
import { pickFav, condOf, condLabel } from './looks.js';
import { cancelIllustration } from './illust.js';
import { workerPost } from './calendar.js';
import { weekOf, weekday, addDays } from './weekRange.js';
import { commuteTemp } from './weather.js';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
// Sonnet 5.5: 입력 $2 / 출력 $10 (100만 토큰당), 1달러 = 1,400원으로 계산
export const toWon = u => Math.round(((u.input || 0) * 2 + (u.output || 0) * 10) / 1e6 * 1400);
export const estimateWon = days => Math.max(10, Math.round(days * 10));

const FORMAL = { work: '출근용', casual: '캐주얼', both: '출근·휴무' };

export async function dayContext(date) {
  const snap = await db.getMeta('calendarSnapshot');
  const wx = (await db.getMeta('weather'))?.days?.[date];
  const outfit = await db.get('outfits', date);
  const live = snap?.days?.[date];
  const workCode = live?.workCode || outfit?.workCode || '휴무';
  const schedule = live?.schedule || outfit?.schedule || [];
  const ctx = { date, workCode, schedule };
  if (wx) {
    Object.assign(ctx, { min: wx.min, max: wx.max, feelMin: wx.feelMin, feelMax: wx.feelMax, pop: wx.pop, summary: `${wx.icon} ${wx.summary}`.trim() });
    const c = commuteTemp(wx, schedule);
    if (c) ctx.commuteTemp = c.t;
    else {
      const m = schedule.join(' ').match(/(?:^|\s)(\d{2}):\d{2} /);
      const h = m ? +m[1] : 10;
      if (wx.hours?.[h]) ctx.firstOutTemp = wx.hours[h].t;
    }
  } else if (outfit?.weather) {
    Object.assign(ctx, { min: outfit.weather.min, max: outfit.weather.max, pop: outfit.weather.pop, summary: outfit.weather.summary });
  }
  return ctx;
}

function itemLine(i) {
  const a = [i.color];
  if (i.length) a.push(`기장 ${i.length}`);
  if (i.thickness) a.push(`두께 ${i.thickness}`);
  if (i.size) a.push(i.size);
  if (i.heel) a.push(`굽 ${i.heel}`);
  if (i.sleeve) a.push(`소매 ${i.sleeve}`);
  const extra = [i.note, i.desc].filter(Boolean).join(' / ');
  return `${i.id} | ${i.category}/${i.type || ''} | ${i.name} | ${a.join(', ')} | ${FORMAL[i.formality] || ''}${extra ? ' | ' + extra : ''}`;
}

const SYSTEM = `당신은 한국 2030 여성의 개인 스타일리스트입니다. 사용자의 실제 옷장에 있는 옷만으로 날짜별 코디를 짭니다.

지켜야 할 것
- 각 날짜마다 그 날짜의 "후보 id"에 있는 옷만 고릅니다. 목록에 없는 옷은 절대 쓰지 않습니다.
- 구성: 상의 1개(레이어드면 최대 2개) + 하의 1개, 또는 원피스 1개 / 신발 정확히 1개 / 가방 정확히 1개 / 날씨에 맞는 아우터 0~2개(이너+겉옷) / 필요하면 양말·스타킹 1개.
- 날짜별 규칙(출근일·기온·비·일정)을 반드시 지킵니다.
- 사용자 피드백과 규칙을 반영합니다. 좋았던 조합은 다시 활용하고, 별로였던 조합과 이유는 피합니다.
- 같은 주 안에서 같은 상의·하의를 반복하지 않도록 고르게 돌려 입힙니다 (아우터·신발·가방은 반복해도 됨).

스타일
- 요즘 대한민국 2030 여성의 출근룩·하객룩 느낌. 출근일은 비즈니스 캐주얼, 휴무일은 그날 일정에 맞게.
- 색 조합은 디자인적으로 예쁘고 대중적으로 아름다운 조합, 계절감 반영 (톤온톤, 뉴트럴 + 포인트 1색 등).

출력
- mood: 코디 분위기를 영어 2~4단어로 (예: "Navy Tone-on-Tone", "Soft Denim Day").
- palette: 코디의 주요 색 3개를 #RRGGBB로.
- reason: 날씨·일정에 근거한 이유 한 문장, 한국어 해요체, 60자 안팎.`;

const SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
          mood: { type: 'string' },
          palette: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['date', 'items', 'mood', 'palette', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['days'],
  additionalProperties: false,
};

async function feedbackText(byId) {
  const fb = await db.getAll('feedback');
  const names = ids => (ids || []).map(id => byId[id] ? `${byId[id].name}(${byId[id].color})` : null).filter(Boolean).join(' + ');
  const lines = [];
  for (const f of fb.filter(f => f.kind === 'custom')) lines.push(`- [내 규칙] ${f.text}`);
  for (const f of fb.filter(f => f.kind === 'rule')) lines.push(`- [기본 규칙] ${f.text}`);
  for (const f of fb.filter(f => f.kind === 'remove').slice(-30)) lines.push(`- [뺀 아이템 ${f.date ? md(f.date) : ''}] ${names(f.itemIds)} — 사용자가 코디에서 직접 뺐음. 비슷한 상황에서는 피할 것`);
  for (const f of fb.filter(f => f.kind === 'add').slice(-30)) lines.push(`- [넣은 아이템 ${f.date ? md(f.date) : ''}] ${names(f.itemIds)} — 사용자가 코디에 직접 넣었음. 비슷한 상황에서 선호`);
  for (const f of fb.filter(f => f.kind === 'like' || f.kind === 'dislike').sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(-30)) {
    lines.push(`- [${f.kind === 'like' ? '좋았음' : '별로였음'}${f.date ? ' ' + md(f.date) : ''}] ${names(f.itemIds)}${f.text ? ` — 메모: ${f.text}` : ''}`);
  }
  return lines.join('\n') || '- 아직 없음';
}

function ctxText(c) {
  const w = c.min != null ? `${c.summary || ''} 최저 ${c.min}℃ / 최고 ${c.max}℃${c.feelMin != null ? ` (체감 ${c.feelMin}~${c.feelMax}℃)` : ''}${c.pop != null ? `, 강수 ${c.pop}%` : ''}${c.commuteTemp != null ? `, 출퇴근 중 가장 추운 때 ${c.commuteTemp}℃` : ''}` : '예보 없음 (11월 서울 평년 기준으로 판단)';
  return `${c.workCode === '휴무' ? '휴무' : c.workCode + ' 근무'} · 일정: ${c.schedule.join(', ') || '없음'} · 날씨: ${w}`;
}

async function callAI(prompt) {
  const r = await workerPost('/claude', { system: SYSTEM, prompt, schema: SCHEMA });
  const won = toWon(r.usage || {});
  const log = (await db.getMeta('aiUsage')) || [];
  log.push({ at: new Date().toISOString(), won, ...r.usage, model: r.model });
  await db.setMeta('aiUsage', log.slice(-500));
  return { days: r.data?.days || [], won };
}

// dates: 짤 날짜들, opts.reason: 재코디 이유, opts.redo: 재코디 여부
export async function generate(allDates, opts = {}) {
  const items = await db.getAll('items');
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const ctxs = {};
  for (const d of allDates) ctxs[d] = await dayContext(d);

  // '또 입기' 찜 코디: 비슷한 날이면 AI 없이 그대로 입힌다 (재코디 때는 안 씀)
  const favPicked = {};
  if (!opts.redo) {
    const favs = (await db.getAll('feedback')).filter(f => f.kind === 'fav');
    const others = (await db.getAll('outfits')).filter(o => !allDates.includes(o.date));
    for (const d of allDates) {
      if (!favs.length) break;
      const near = [...others, ...Object.entries(favPicked).map(([date, f]) => ({ date, items: f.itemIds }))];
      const f = pickFav(favs, d, ctxs[d], items, near);
      if (f) { favPicked[d] = f; await wearFav(d, f, ctxs[d]); }
    }
  }
  const dates = allDates.filter(d => !favPicked[d]);
  const favSaved = Object.keys(favPicked);
  if (!dates.length) return { saved: favSaved, favSaved, failed: {}, won: 0, overlaps: [] };

  // 같은 주의 다른 날 코디 (반복 피하기·참고용)
  const weeks = [...new Set(dates.map(d => weekOf(d).start))].map(s => weekOf(s));
  const fixed = (await db.getAll('outfits')).filter(o => weeks.some(w => w.days.includes(o.date)) && !dates.includes(o.date));
  const fixedText = fixed.map(o => `- ${md(o.date)}(${DOW[weekday(o.date)]}): ${o.items.map(id => byId[id]?.name).filter(Boolean).join(' + ')}`).join('\n') || '- 없음';

  const used = new Set();
  const dayBlocks = dates.map(d => {
    const c = ctxs[d];
    const cand = candidates(items, c);
    cand.forEach(i => used.add(i.id));
    return `## ${d} (${DOW[weekday(d)]})\n상황: ${ctxText(c)}\n규칙: ${dayRuleText(c).join(' / ')}\n후보 id: ${cand.map(i => i.id).join(', ')}`;
  });
  const prev = opts.redo ? (await db.get('outfits', dates[0])) : null;
  const redoText = opts.redo
    ? `\n\n# 재코디 요청\n기존 코디(${md(dates[0])}): ${prev ? prev.items.map(id => byId[id]?.name).filter(Boolean).join(' + ') : '없음'}\n바꾸고 싶은 이유: ${opts.reason || '(이유 없음 — 다른 느낌으로)'}\n기존과 확실히 다른 코디로 짜 주세요.`
    : '';

  const catalog = items.filter(i => used.has(i.id)).map(itemLine).join('\n');
  const base = `# 옷장 (id | 카테고리/종류 | 이름 | 속성 | 용도)\n${catalog}\n\n# 피드백·규칙\n${await feedbackText(byId)}\n\n# 같은 주에 이미 정해진 코디\n${fixedText}${redoText}`;
  let prompt = `${base}\n\n# 코디를 짤 날짜\n${dayBlocks.join('\n\n')}\n\n위 날짜 ${dates.length}일의 코디를 짜 주세요.`;

  let total = 0;
  const results = {};
  const failed = {};
  let todo = [...dates];
  for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
    const { days, won } = await callAI(prompt);
    total += won;
    for (const d of todo) {
      const ans = days.find(x => x.date === d);
      if (!ans) { failed[d] = ['AI 답에 이 날짜가 없음']; continue; }
      const errs = validateOutfit(ans.items, items, ctxs[d]);
      if (errs.length) failed[d] = errs; else { results[d] = ans; delete failed[d]; }
    }
    todo = dates.filter(d => !results[d]);
    if (todo.length) {
      prompt = `${base}\n\n# 코디를 짤 날짜\n${dayBlocks.filter((_, i) => todo.includes(dates[i])).join('\n\n')}\n\n# 직전 답의 규칙 위반 (반드시 고칠 것)\n${todo.map(d => `- ${d}: ${(failed[d] || []).join(' / ')}`).join('\n')}\n\n위 날짜 ${todo.length}일의 코디를 다시 짜 주세요.`;
    }
  }

  const now = new Date().toISOString();
  for (const [d, a] of Object.entries(results)) {
    const c = ctxs[d];
    const old = await db.get('outfits', d);
    await db.put('outfits', {
      date: d, workCode: c.workCode, schedule: c.schedule,
      weather: c.min != null ? { icon: (c.summary || '').split(' ')[0], summary: (c.summary || '').split(' ').slice(1).join(' '), min: c.min, max: c.max, pop: c.pop ?? null, extra: null } : old?.weather || null,
      items: [...new Set(a.items)], mood: a.mood, palette: a.palette.slice(0, 3), reason: a.reason,
      morning: morningTemp(c) ?? null,
      status: '자동', source: opts.redo ? '재코디' : 'AI', createdAt: now, needsRedo: false,
      history: old ? [...(old.history || []), { items: old.items, mood: old.mood, at: old.createdAt || null, reason: opts.redo ? opts.reason || '' : '일정 변경' }].slice(-5) : [],
    });
    // 옷이 바뀌었으니 예전 그림은 '준비 중' 표시로 남겨 두고, 새 그림이 오면 바뀐다
    const oldIl = await db.get('illustrations', d);
    if (oldIl) await db.put('illustrations', { ...oldIl, stale: true });
  }

  // 재코디: 같은 주 다른 날과 겹치는 옷 알려 주기 (다른 날은 바꾸지 않음)
  const overlaps = [];
  if (opts.redo && results[dates[0]]) {
    for (const o of fixed) {
      const same = results[dates[0]].items.filter(id => o.items.includes(id) && ['상의', '하의', '원피스'].includes(byId[id]?.category));
      for (const id of same) overlaps.push(`${byId[id].name} → ${md(o.date)}에도 있어요`);
    }
  }
  return { saved: [...favSaved, ...Object.keys(results)], favSaved, failed, won: total, overlaps };
}

const weatherOf = (c, old) => c.min != null
  ? { icon: (c.summary || '').split(' ')[0], summary: (c.summary || '').split(' ').slice(1).join(' '), min: c.min, max: c.max, pop: c.pop ?? null, extra: null }
  : old?.weather || null;

// 찜 코디를 그 날에 입히기. 찜할 때 그림이 있었으면 그림도 그대로 복사 (새로 그리지 않음)
export async function wearFav(d, f, ctx) {
  const c = ctx || await dayContext(d);
  const old = await db.get('outfits', d);
  await db.put('outfits', {
    date: d, workCode: c.workCode, schedule: c.schedule, weather: weatherOf(c, old),
    items: [...f.itemIds], mood: f.mood, palette: f.palette || [],
    reason: `${md(f.date)}에 입었던 찜 코디예요. ${condLabel(condOf(c))}이라 다시 골랐어요.`,
    morning: morningTemp(c) ?? null,
    status: '자동', source: '또 입기', favId: f.id, createdAt: new Date().toISOString(), needsRedo: false,
    history: old ? [...(old.history || []), { items: old.items, mood: old.mood, at: old.createdAt || null, reason: '또 입기' }].slice(-5) : [],
  });
  const key = f.itemIds.join(',');
  const src = await db.get('illustrations', f.date);
  const img = src && !src.stale && (!src.itemsKey || src.itemsKey === key) ? src : f.image ? { image: f.image, model: 'copy', itemsKey: key } : null;
  if (img) {
    await db.put('illustrations', { date: d, image: img.image, model: img.model, createdAt: new Date().toISOString(), itemsKey: key, sample: false, stale: false, copiedFrom: f.date });
    if (((await db.getMeta('illustPending')) || []).includes(d)) { try { await cancelIllustration(d); } catch {} }
  } else {
    const il = await db.get('illustrations', d);
    if (il) await db.put('illustrations', { ...il, stale: true });
  }
  return !!img;
}
