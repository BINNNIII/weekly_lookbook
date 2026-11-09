import * as db from './db.js';
import { weekOf, weekday, addDays } from './weekRange.js';
import { exportBackup, readBackupFile, importBackup, summarize } from './backup.js';
import { CATEGORIES, LENGTHS, THICKNESS, BAG_SIZES, FORMALITY, suggest, requiredFields } from './classify.js';
import { shrinkPhoto } from './photo.js';
import { workerFetch, buildDays, diffDays, WORKER_URL } from './calendar.js';
import { fetchWeather, commuteTemp } from './weather.js';
import { generate, dayContext } from './engine.js';
import { validateOutfit } from './rules.js';
import { requestIllustration, pullIllustrations } from './illust.js';

const APP_VERSION = 'v12';
const $view = document.getElementById('view');
const CATS = ['아우터', '상의', '하의', '원피스', '신발', '가방', '양말·스타킹', '액세서리'];
const DOW_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const state = { autoBusy: false, autoError: null, tab: 'week', weekView: 'this', selected: null, closetCat: '전체', closetMode: null, closetScroll: 0, syncError: null };

// ---------- 공통 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
function localToday() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
async function today() {
  return (await db.getMeta('testToday')) || localToday();
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600);
}
const isOff = code => !code || code === '휴무';
function weekTitle(w) {
  const [s, e] = [w.start, w.end];
  const ms = +s.slice(5, 7) - 1, me = +e.slice(5, 7) - 1;
  return ms === me
    ? `${MONTH_EN[ms]} ${+s.slice(8)} — ${+e.slice(8)}`
    : `${MONTH_EN[ms].slice(0, 3)} ${+s.slice(8)} — ${MONTH_EN[me].slice(0, 3)} ${+e.slice(8)}`;
}
function wxText(w) {
  if (!w) return '날씨 정보 없음';
  const parts = [`${w.icon || ''} ${w.summary || ''}`.trim(), `${w.min}~${w.max}℃`];
  if (w.extra && w.pop != null) parts.push(`${w.extra} ${w.pop}%`);
  else if (w.extra) parts.push(w.extra);
  else if (w.pop != null) parts.push(`강수 ${w.pop}%`);
  return parts.join(' · ');
}
function itemAttr(i) {
  const a = [i.color];
  if (i.length) a.push(`기장 ${i.length}`);
  if (i.thickness) a.push(`두께 ${i.thickness}`);
  if (i.size) a.push(i.size);
  if (i.heel) a.push(i.heel);
  return a.join(' · ');
}

// ---------- 이번 주 ----------
async function renderWeek() {
  const items = await db.getAll('items');
  if (!items.length) return renderOnboarding();

  const t = await today();
  const past = state.weekView === 'prev';
  const w = past ? weekOf(addDays(weekOf(t).start, -1)) : weekOf(t);
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const preview = past ? null : weekOf(addDays(w.end, 1)).start; // 다음 주 첫날 미리보기
  const shown = preview ? [...w.days, preview] : w.days;
  const outfits = Object.fromEntries((await db.getAll('outfits')).filter(o => shown.includes(o.date)).map(o => [o.date, o]));
  const illus = Object.fromEntries((await db.getAll('illustrations')).filter(x => shown.includes(x.date)).map(x => [x.date, x]));
  if (!state.selected || !shown.includes(state.selected)) {
    state.selected = past ? (w.days.find(d => outfits[d]) || w.start) : t;
  }
  const sel = state.selected;
  const o = outfits[sel];
  const live = (await db.getMeta('calendarSnapshot'))?.days || {};
  const wxAll = (await db.getMeta('weather'))?.days || {};
  const info = d => live[d] ? { workCode: live[d].workCode, schedule: live[d].schedule, live: true }
    : outfits[d] ? { workCode: outfits[d].workCode, schedule: outfits[d].schedule || [] } : null;

  let html = `<p class="eyebrow">Weekly Lookbook${past ? ' · Last Week' : ''}</p><h1 class="title">${weekTitle(w)}</h1>
    <div class="seg"><button data-wv="this" class="${past ? '' : 'on'}">이번 주</button><button data-wv="prev" class="${past ? 'on' : ''}">저번 주</button></div>`;

  if (past && !Object.keys(outfits).length) {
    $view.innerHTML = html + `<div class="panel"><h3>N/A</h3><p>저번 주(${md(w.start)}~${md(w.end)}) 코디 기록이 없어요.</p></div>`;
    bindSeg();
    return;
  }

  if (!past && state.syncError) html += `<p class="sync-err">캘린더 확인 실패: ${esc(state.syncError)}</p>`;
  if (sel === preview) html += `<p class="preview-note">다음 주 첫날 미리보기예요 (${md(preview)} ${DOW_KO[weekday(preview)]}).</p>`;
  html += o ? await dayCard(sel, o, illus[sel], byId, !past && sel === t, info(sel), past ? null : wxAll[sel], past)
            : (past ? `<div class="panel"><h3>${md(sel)} (${DOW_KO[weekday(sel)]}) · N/A</h3><p>이 날은 코디 기록이 없어요.</p></div>` : emptyDay(sel, t, info(sel), wxAll[sel]));

  html += `<p class="section">${past ? '저번 주' : '이번 주'} 코디 <span class="hint">${md(w.start)}~${md(w.end)} · 옆으로 넘겨 보세요</span></p><div class="strip">`;
  for (const d of shown) {
    if (d === preview) html += '<div class="strip-sep">다음 주</div>';
    const od = outfits[d], il = illus[d];
    const code = info(d)?.workCode || '';
    html += `<button class="mini ${d === sel ? 'sel' : ''} ${d === preview ? 'preview' : ''}" data-day="${d}">
      ${il ? `<img src="${il.image}" alt="">` : `<div class="ph">${od ? '일러스트 없음' : '코디 없음'}</div>`}
      <div class="mb"><div class="md"><span><span class="d">${md(d)}</span> <span class="w">${DOW_EN[weekday(d)]}</span></span>
      ${code ? `<span class="t ${isOff(code) ? 'off' : ''}">${esc(code)}</span>` : ''}</div>
      <p class="mo">${d === preview ? '미리보기' + (od ? ' · ' + esc(od.mood) : ' · 아직 없음') : od ? esc(od.mood) : (past ? 'N/A' : (d === t ? '오늘' : '&nbsp;'))}</p></div></button>`;
  }
  html += '</div>';
  if (!past) html += await planPanels(t, w, outfits);
  if (past) {
    html += `<div class="panel" style="margin-top:20px"><h3>저번 주 기록 삭제</h3>
      <p>${md(w.start)}~${md(w.end)}의 코디와 일러스트를 지워요. 좋아요/별로예요 피드백은 다음 코디에 계속 반영되도록 남겨 둬요.</p>
      <button class="btn ghost" id="delPrev">이 주 기록 삭제</button></div>`;
  }
  $view.innerHTML = html;

  $view.querySelectorAll('.mini').forEach(b => b.onclick = () => { state.selected = b.dataset.day; renderWeek(); scrollTo({ top: 0, behavior: 'smooth' }); });
  const sel0 = $view.querySelector('.mini.sel'); if (sel0) sel0.scrollIntoView({ inline: 'center', block: 'nearest' });
  bindSeg();
  if (!past && o && sel === t) bindFeedback(sel, o);
  if (!past && o && sel >= t) bindEdit(sel, o, byId);
  const retry = $view.querySelector('#autoRetry');
  if (retry) retry.onclick = () => { state.autoError = null; autoRun(); };
  if (past) $view.querySelector('#delPrev').onclick = async () => {
    if (!confirm(`${md(w.start)}~${md(w.end)} 코디 기록을 삭제할까요?\n삭제하면 되돌릴 수 없어요. (필요하면 먼저 백업을 내보내 두세요)`)) return;
    for (const d of w.days) { await db.del('outfits', d); await db.del('illustrations', d); }
    toast('저번 주 기록을 삭제했어요.');
    renderWeek();
  };
}

function bindSeg() {
  $view.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
    if (state.weekView === b.dataset.wv) return;
    state.weekView = b.dataset.wv; state.selected = null; renderWeek();
  });
}

function emptyDay(d, t, inf, wx) {
  const code = inf?.workCode;
  return `<div class="panel"><h3>${md(d)} (${DOW_KO[weekday(d)]})${code ? ` · ${isOff(code) ? '휴무' : '출근 ' + esc(code)}` : ''}</h3>
    ${inf?.schedule?.length ? `<p class="sched" style="color:var(--ink);margin-top:2px">${inf.schedule.map(esc).join(' · ')}</p>` : ''}
    ${wx ? `<p class="wx" style="margin:2px 0 8px">${esc(liveWx(wx, inf?.schedule))}</p>` : ''}
    <p>이 날 코디가 아직 없어요. 아래 '코디 짜기'를 누르면 AI가 짜 줘요.</p></div>`;
}

function liveWx(w, schedule = []) {
  const parts = [`${w.icon} ${w.summary}`.trim(), `${w.min}~${w.max}℃`, `체감 ${w.feelMin}~${w.feelMax}℃`];
  if (w.pop != null) parts.push(`강수 ${w.pop}%`);
  const c = commuteTemp(w, schedule);
  if (c?.go) parts.push(`출근길(${c.go.hour}시) ${c.go.t}℃`);
  if (c?.back) parts.push(`퇴근길(${c.back.hour}시) ${c.back.t}℃`);
  return parts.join(' · ');
}

async function dayCard(d, o, il, byId, isToday, inf, wx, isPast = false) {
  const canEdit = !isPast && d >= (await today()); // 오늘과 앞으로의 날은 언제든 재코디·아이템 빼기 가능
  const code = inf?.workCode || o.workCode;
  const schedule = inf?.schedule || o.schedule || [];
  const wxLine = wx ? liveWx(wx, schedule) : wxText(o.weather);
  const wxDiff = wx && o.weather && Math.abs(wx.min - o.weather.min) >= 4
    ? `<p class="hint warn-hint">코디를 짤 때보다 최저기온이 ${Math.abs(wx.min - o.weather.min)}℃ ${wx.min < o.weather.min ? '낮아졌어요. 아우터를 더 따뜻하게 챙기세요' : '높아졌어요. 아우터가 더울 수 있어요'}.</p>` : '';
  const list = o.items.map(id => byId[id]).filter(Boolean).map(i => `<li>
      ${i.photo ? `<img class="thumb" src="${i.photo}" alt="">` : '<div class="basic">기본템</div>'}
      <div class="it-tx"><p class="nm">${esc(i.name)}</p><p class="cl">${esc(i.color)}</p></div>
      ${canEdit ? `<button class="it-rm" data-rm="${i.id}" aria-label="${esc(i.name)} 빼기">✕</button>` : ''}</li>`).join('');
  const missing = o.items.filter(id => !byId[id]).length;
  let actions = '';
  if (isToday) {
    const fb = await db.get('feedback', `fb-${d}`);
    actions += `<div class="actions">
      <div class="fb"><button class="chip ${fb?.kind === 'like' ? 'on' : ''}" data-kind="like">👍 좋아요</button>
      <button class="chip ${fb?.kind === 'dislike' ? 'on' : ''}" data-kind="dislike">👎 별로예요</button></div>
      <textarea class="memo" id="fbMemo" rows="1" placeholder="짧은 메모 (선택) — 예: 따뜻하고 편했음">${esc(fb?.text || '')}</textarea>
      <div class="row"><button class="btn" id="fbSave">피드백 저장</button></div>
      ${fb ? `<p class="hint">저장됨 · ${new Date(fb.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>` : ''}</div>`;
  }
  if (canEdit) {
    actions += `<div class="actions">
      <p class="lb-small">재코디 · ${md(d)} (${DOW_KO[weekday(d)]})</p>
      <textarea class="memo" id="redoReason" rows="1" placeholder="바꾸고 싶은 이유 (선택) — 예: 바지 말고 치마"></textarea>
      <div class="row"><button class="btn ghost" id="redoBtn" data-d="${d}">재코디 요청</button></div>
      <p class="hint">이 날 코디만 바로 바뀌고, 그림은 새로 그려지면 바뀌어요. 다른 날은 그대로예요. 마음에 들 때까지 몇 번이든 할 수 있어요.</p></div>`;
  }
  return `<article class="day">
    <div class="stage"><div class="meta"><span class="date">${md(d)}</span><span class="dow">${DOW_EN[weekday(d)]}</span>${isToday ? '<span class="today-mark">오늘</span>' : ''}</div>
      <span class="tag ${isOff(code) ? 'off' : ''}">${isOff(code) ? '휴무' : '출근 ' + esc(code)}</span>
      ${il ? `<div class="illu-wrap"><img class="illu ${il.stale ? 'stale' : ''}" src="${il.image}" alt="코디 일러스트">${il.stale && !isPast ? '<span class="illu-badge">재코디 준비 중 · 새 그림이 오면 바뀌어요</span>' : ''}</div>`
        : `<div class="illu illu-empty">${isPast ? '일러스트 없음' : '그림 준비 중이에요<br><span class="hint">자동으로 그려지면 여기 나와요</span>'}</div>`}
      <div class="mood"><span>${esc(o.mood)}</span><span class="pal">${(o.palette || []).map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span></div>
    </div>
    <div class="info">${o.needsRedo ? '<p class="redo">일정이 바뀌어서 이 날 코디를 다시 짜는 중이에요.</p>' : ''}
      <p class="sched">${schedule.map(esc).join(' · ') || (isOff(code) ? '일정 없음' : '')}</p>
      <p class="wx">${esc(wxLine)}</p>${wxDiff}
      <ul class="items">${list}</ul>
      ${missing ? `<p class="hint">옷장에서 삭제된 옷 ${missing}개는 숨겼어요.</p>` : ''}
      <p class="note">${esc(o.reason)}</p></div>
    ${actions}</article>`;
}

function bindFeedback(d, o) {
  let kind = $view.querySelector('.chip.on')?.dataset.kind || null;
  $view.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    kind = c.dataset.kind;
    $view.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c));
  });
  const memo = $view.querySelector('#fbMemo');
  memo.oninput = () => { memo.style.height = 'auto'; memo.style.height = memo.scrollHeight + 'px'; };
  $view.querySelector('#fbSave').onclick = async () => {
    if (!kind) return toast('좋아요 또는 별로예요를 먼저 골라 주세요.');
    await db.put('feedback', { id: `fb-${d}`, date: d, kind, text: memo.value.trim(), itemIds: o.items, mood: o.mood, createdAt: new Date().toISOString() });
    toast('피드백을 저장했어요. 다음 코디에 반영돼요.');
    renderWeek();
  };
}

function bindEdit(d, o, byId) {
  const redo = $view.querySelector('#redoBtn');
  if (redo) redo.onclick = () => runGenerate([d], { redo: true, reason: $view.querySelector('#redoReason').value.trim() });
  $view.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const id = b.dataset.rm, it = byId[id];
    if (!confirm(`'${it?.name || id}'을(를) ${md(d)} 코디에서 뺄까요?\n그림도 새로 그려져요.`)) return;
    const cur = await db.get('outfits', d);
    const items = cur.items.filter(x => x !== id);
    await db.put('outfits', { ...cur, items, history: [...(cur.history || []), { items: cur.items, mood: cur.mood, at: cur.createdAt || null, reason: `아이템 빼기: ${it?.name || id}` }].slice(-5) });
    // 다음 코디에 참고하도록 기록
    await db.put('feedback', { id: `rm-${d}-${id}`, kind: 'remove', date: d, itemIds: [id], text: `${md(d)} 코디에서 직접 뺌`, createdAt: new Date().toISOString() });
    const il = await db.get('illustrations', d);
    if (il) await db.put('illustrations', { ...il, stale: true });
    try { await requestIllustration(d, 'redo'); } catch {}
    const errs = validateOutfit(items, await db.getAll('items'), await dayContext(d));
    toast(`${it?.name || '아이템'}을(를) 뺐어요. 그림은 새로 그려지면 바뀌어요.`);
    if (errs.length) alert(`참고: 지금 코디는 규칙과 맞지 않는 부분이 있어요.\n${errs.join('\n')}\n\n필요하면 재코디를 눌러 주세요.`);
    renderWeek();
  });
}

// ---------- 자동 코디·일러스트 (비용 자동 승인, 일러스트는 하루 5장 한도는 서버에서) ----------
async function planPanels(t, w, outfits) {
  const nw = weekOf(addDays(w.end, 1));
  const all = await db.getAll('outfits');
  const nOut = all.filter(o => nw.days.includes(o.date) && !o.needsRedo).length;
  const ill = new Set((await db.getAll('illustrations')).filter(x => !x.stale).map(x => x.date));
  const nIll = nw.days.filter(d => ill.has(d)).length;
  const auto = (await db.getMeta('autoMode')) !== false;
  let h = `<div class="panel" style="margin-top:16px"><h3>다음 주 (${md(nw.start)}~${md(nw.end)})</h3>`;
  if (state.autoBusy) h += '<p>코디를 짜는 중이에요…</p>';
  else h += `<p>코디 ${nOut}/${nw.days.length}일 · 일러스트 ${nIll}/${nw.days.length}장 준비됨${auto ? ' · 자동으로 채워져요' : ''}</p>`;
  if (state.autoError) h += `<p class="hint warn-hint">자동 코디 실패: ${esc(state.autoError)}</p><button class="btn ghost small" id="autoRetry">다시 시도</button>`;
  return h + '</div>';
}

// 코디가 없는 날(이번 주 남은 날 + 다음 주)을 자동으로 짜고, 그림이 없는 날은 그림을 자동 요청
async function autoRun() {
  if (state.autoBusy || (await db.getMeta('autoMode')) === false) return;
  if (!(await db.getMeta('appKey')) || !(await db.getAll('items')).length) return;
  const t = await today();
  const w = weekOf(t), nw = weekOf(addDays(w.end, 1));
  const outs = Object.fromEntries((await db.getAll('outfits')).map(o => [o.date, o]));
  const need = [...w.days.filter(d => d >= t), ...nw.days].filter(d => !outs[d] || outs[d].needsRedo);
  state.autoBusy = true; state.autoError = null;
  try {
    if (need.length) {
      if (state.tab === 'week') render();
      const r = await generate(need, {});
      const fail = Object.keys(r.failed);
      if (fail.length) state.autoError = `${fail.map(md).join(', ')} 규칙에 맞는 코디를 못 찾았어요`;
      if (r.saved.length) toast(`${r.saved.length}일 코디를 짰어요 (약 ${r.won}원). 그림은 자동으로 그려져요.`);
    }
    // 그림 자동 요청: 오늘부터 다음 주 끝까지, 그림이 없거나 옛 그림인 날
    const ill = Object.fromEntries((await db.getAll('illustrations')).map(x => [x.date, x]));
    const pend = new Set((await db.getMeta('illustPending')) || []);
    const outs2 = await db.getAll('outfits');
    for (const o of outs2) {
      if (o.date < t || o.date > nw.end || o.needsRedo || pend.has(o.date)) continue;
      const il = ill[o.date];
      if (il && !il.stale && (!il.itemsKey || il.itemsKey === o.items.join(','))) continue;
      try { await requestIllustration(o.date, o.source === '재코디' ? 'redo' : 'normal'); } catch {}
    }
  } catch (e) {
    state.autoError = e.message;
  } finally {
    state.autoBusy = false;
  }
  if (state.tab === 'week') render();
}

// 재코디: 확인 없이 바로 (비용 자동 승인). 코디는 즉시 바뀌고, 그림은 '준비 중' 표시 후 도착하면 교체
async function runGenerate(dates, opts = {}) {
  const el = document.createElement('div');
  el.className = 'modal busy';
  el.innerHTML = `<div class="sheet"><h3>코디 짜는 중…</h3><p>보통 20초~1분 걸려요.</p></div>`;
  document.body.appendChild(el);
  try {
    const r = await generate(dates, opts);
    el.remove();
    const fail = Object.entries(r.failed);
    if (fail.length) alert(`규칙에 맞는 코디를 못 찾았어요.\n${fail.map(([d, e]) => `${md(d)}: ${e.join(', ')}`).join('\n')}`);
    for (const d of r.saved) { try { await requestIllustration(d, opts.redo ? 'redo' : 'normal'); } catch {} }
    if (r.saved.length) toast(`코디를 바꿨어요 (약 ${r.won}원). 새 그림은 자동으로 그려져요.`);
    if (r.overlaps.length) alert(`같은 주 다른 날과 겹치는 옷이 있어요 (다른 날은 그대로 둬요)\n${r.overlaps.join('\n')}`);
  } catch (e) {
    el.remove();
    alert(`코디를 짜지 못했어요.\n${e.message}${/비밀번호/.test(e.message) ? '\n\n→ Claude가 준 연결 링크를 홈 화면 앱의 설정 → 캘린더 · 날씨 연결 칸에 붙여 넣어 주세요.' : ''}`);
  }
  render();
}

// ---------- 캘린더·날씨 확인 ----------
async function sync({ manual = false } = {}) {
  const t = await today();
  try {
    const w = await db.getMeta('weather');
    if (manual || !w || Date.now() - new Date(w.fetchedAt) > 3600000) await db.setMeta('weather', await fetchWeather());
  } catch (e) { if (manual) toast(e.message); }
  if (!(await db.getMeta('appKey'))) { state.syncError = null; return; }
  try { const got = await pullIllustrations(); if (got) toast(`새 일러스트 ${got}장을 받아왔어요.`); } catch {}

  const cur = weekOf(t), next = weekOf(addDays(cur.end, 1));
  const dates = [...cur.days, ...next.days];
  let data;
  try { data = await workerFetch(`/calendar?from=${dates[0]}&to=${dates[dates.length - 1]}`); state.syncError = null; }
  catch (e) { state.syncError = e.message; if (manual) toast(e.message); return; }
  if (!data.calendars.some(c => c !== '대한민국의 휴일')) {
    state.syncError = '구글 캘린더 주소가 아직 등록되지 않았어요 (지금은 공휴일만 연결됨)';
    if (manual) toast(state.syncError);
    return;
  }

  const settings = await db.getMeta('settings', {}) || {};
  const nowDays = buildDays(data.events, dates, settings.workHours || {});
  const snap = await db.getMeta('calendarSnapshot');
  const outfits = await db.getAll('outfits');
  const base = { ...(snap?.days || {}) };
  for (const o of outfits) if (!base[o.date] && dates.includes(o.date)) base[o.date] = { workCode: o.workCode, schedule: o.schedule, workOnly: true };
  const changes = diffDays(base, nowDays, t);

  const keep = Object.fromEntries(Object.entries(snap?.days || {}).filter(([d]) => d >= addDays(t, -35)));
  await db.setMeta('calendarSnapshot', { checkedAt: data.fetchedAt, from: dates[0], to: dates[dates.length - 1], calendars: data.calendars, errors: data.errors, days: { ...keep, ...nowDays } });
  if (changes.length) showChanges(changes, outfits).then(() => { render(); autoRun(); }); // 창을 기다리지 않음
}

function showChanges(changes, outfits) {
  const byDate = Object.fromEntries(outfits.map(o => [o.date, o]));
  const affected = changes.filter(c => byDate[c.date]);
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="sheet"><h3>일정이 변경되었어요</h3>
    <ul class="changes">${changes.map(c => `<li><b>${md(c.date)} (${DOW_KO[weekday(c.date)]})</b> ${c.msgs.map(esc).join('<br>')}${byDate[c.date] ? ' <span class="has">코디 있음</span>' : ''}</li>`).join('')}</ul>
    ${affected.length
      ? `<p>${affected.map(c => md(c.date)).join(', ')} 코디를 다시 짤까요? 승인해야만 바뀌어요.</p>
         <div class="row"><button class="btn" id="redo">다시 짜기</button><button class="btn ghost" id="keep">그대로 두기</button></div>`
      : '<div class="row"><button class="btn" id="keep">확인</button></div>'}</div>`;
  document.body.appendChild(el);
  return new Promise(res => {
    const close = () => { el.remove(); res(); };
    el.querySelector('#keep').onclick = close;
    const r = el.querySelector('#redo');
    if (r) r.onclick = async () => {
      for (const c of affected) {
        const o = byDate[c.date];
        await db.put('outfits', { ...o, workCode: c.now.workCode, schedule: c.now.schedule, needsRedo: true });
      }
      toast(`${affected.length}일 코디를 다시 짤게요. 그림도 자동으로 다시 그려져요.`);
      close();
    };
  });
}

// ---------- 처음 시작 ----------
// 맥에서 앱을 열어 둔 경우에만 있는 시작용 파일 (인터넷 주소에는 올리지 않음)
const STARTER_URL = '../데이터/v1/시작용_백업_v1.json';

async function renderOnboarding() {
  let hasStarter = false;
  try { hasStarter = (await fetch(STARTER_URL, { method: 'HEAD', cache: 'no-store' })).ok; } catch {}
  $view.innerHTML = `<p class="eyebrow">Weekly Lookbook</p><h1 class="title">Welcome</h1>
    ${hasStarter ? `<div class="panel"><h3>맥에서 바로 불러오기</h3>
      <p>지금 맥에 있는 시작용 데이터를 그대로 가져와요. 옷장 69개와 11/9~11/15 코디가 들어와요.</p>
      <button class="btn" id="startMac">맥에서 바로 불러오기</button></div>` : ''}
    <div class="panel"><h3>백업 파일 불러오기</h3>
      <p>백업 파일이 폰의 '파일' 앱에 있으면 여기서 골라요.</p>
      <label class="btn ${hasStarter ? 'ghost' : ''}" style="display:block;text-align:center">파일 고르기<input type="file" accept="application/json,.json" hidden id="startFile"></label></div>`;
  $view.querySelector('#startFile').onchange = e => doImport(e.target.files[0], false);
  const mac = $view.querySelector('#startMac');
  if (mac) mac.onclick = async () => {
    mac.disabled = true; mac.textContent = '불러오는 중…';
    try { await doImport(await fetch(STARTER_URL, { cache: 'no-store' }), false); }
    finally { mac.disabled = false; mac.textContent = '맥에서 바로 불러오기'; }
  };
}

async function doImport(file, askFirst = true) {
  if (!file) return;
  try {
    const data = await readBackupFile(file);
    if (askFirst && !confirm(`지금 데이터를 이 백업으로 바꿀까요?\n${summarize(data)}\n\n지금 폰에 있는 데이터는 사라져요.`)) return;
    await importBackup(data);
    toast(`불러왔어요 · ${summarize(data)}`);
    state.tab = 'week'; state.selected = null; await render();
    await sync(); render();
  } catch (e) { alert(e.message); }
}

// ---------- 옷장 ----------
const SRC_LABEL = { '구매이력': '구매 이력', '기본템': '기본템', '직접 등록': '직접 등록' };

async function renderCloset() {
  const m = state.closetMode;
  if (m?.view === 'detail') return renderClothDetail(m.id);
  if (m?.view === 'form') return renderClothForm(m.id);

  const items = await db.getAll('items');
  const order = i => CATS.indexOf(i.category) * 1000 + (i.photo ? 0 : 500);
  items.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  const cats = ['전체', ...CATS.filter(c => items.some(i => i.category === c))];
  if (!cats.includes(state.closetCat)) state.closetCat = '전체';
  const shown = state.closetCat === '전체' ? items : items.filter(i => i.category === state.closetCat);
  const noPhoto = items.filter(i => !i.photo).length;
  $view.innerHTML = `<p class="eyebrow">My Closet</p><h1 class="title">옷장</h1>
    <button class="btn add-btn" id="addCloth">＋ 옷 추가</button>
    <div class="filters">${cats.map(c => `<button class="${c === state.closetCat ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
    <p class="count">${shown.length}개${noPhoto ? ` · 사진 없는 옷 ${noPhoto}개 (눌러서 사진 추가)` : ''}</p>
    <div class="grid">${shown.map(i => `<button class="cloth" data-id="${i.id}">
      ${i.photo ? `<img src="${i.photo}" alt="" loading="lazy">` : `<div class="basic">${i.source === '기본템' ? '기본템 · ' : ''}사진 없음</div>`}
      <div class="tx"><p class="nm">${esc(i.name)}</p><p class="at">${esc(itemAttr(i))}</p></div></button>`).join('')}</div>`;
  $view.querySelectorAll('.filters button').forEach(b => b.onclick = () => { state.closetCat = b.dataset.cat; renderCloset(); });
  $view.querySelectorAll('.cloth').forEach(b => b.onclick = () => openCloset({ view: 'detail', id: b.dataset.id }));
  $view.querySelector('#addCloth').onclick = () => openCloset({ view: 'form', id: null });
}

function openCloset(mode) {
  if (!mode) state.closetScroll = state.closetScroll || 0;
  else if (!state.closetMode) state.closetScroll = scrollY;
  state.closetMode = mode;
  renderCloset().then(() => scrollTo(0, mode ? 0 : (state.closetScroll || 0)));
}

async function renderClothDetail(id) {
  const i = await db.get('items', id);
  if (!i) return openCloset(null);
  const t = await today();
  const used = (await db.getAll('outfits')).filter(o => o.items.includes(id)).map(o => o.date).sort();
  const meta = [SRC_LABEL[i.source] || i.source, i.app && `${i.mall} (${i.app})`, i.bought && `구매 ${i.bought}`].filter(Boolean).join(' · ');
  const fmLabel = Object.fromEntries(FORMALITY)[i.formality] || '';
  $view.innerHTML = `<button class="back" id="back">‹ 옷장</button>
    <div class="detail-photo">${i.photo ? `<img src="${i.photo}" alt="">` : `<div class="basic">사진 없음</div>`}</div>
    <h2 class="d-name">${esc(i.name)}</h2>
    <p class="d-attr">${esc(i.category)}${i.type ? ' · ' + esc(i.type) : ''} · ${esc(itemAttr(i))}${fmLabel ? ' · ' + fmLabel : ''}</p>
    <p class="d-meta">${esc(meta)}</p>
    ${i.desc ? `<p class="d-desc">“${esc(i.desc)}”</p>` : ''}
    ${i.note ? `<p class="d-desc">${esc(i.note)}</p>` : ''}
    ${used.length ? `<p class="d-meta">코디에 쓰인 날: ${used.map(md).join(', ')}</p>` : ''}
    ${state.closetMode?.justAdded ? '<p class="hint" style="margin-top:14px">✓ 옷장에 추가했어요.</p>' : ''}
    <div class="row" style="margin-top:${state.closetMode?.justAdded ? 8 : 18}px">
      <button class="btn ${state.closetMode?.justAdded ? '' : 'ghost'}" id="next">＋ 다음 옷 추가하기</button></div>
    <div class="row"><button class="btn ${state.closetMode?.justAdded ? 'ghost' : ''}" id="edit">${i.photo ? '수정하기' : '사진 추가 · 수정하기'}</button></div>`;
  $view.querySelector('#back').onclick = () => openCloset(null);
  $view.querySelector('#next').onclick = () => openCloset({ view: 'form', id: null });
  $view.querySelector('#edit').onclick = () => openCloset({ view: 'form', id });
}

const opts = (name, list, cur) => `<div class="opts" data-name="${name}">${list.map(v => {
  const [val, label] = Array.isArray(v) ? v : [v, v];
  return `<button type="button" data-v="${esc(val)}" class="${cur === val ? 'on' : ''}">${esc(label)}</button>`;
}).join('')}</div>`;

async function renderClothForm(id) {
  const orig = id ? await db.get('items', id) : null;
  if (id && !orig) return openCloset(null);
  const f = orig ? { ...orig } : { photo: null, desc: '', name: '', category: null, type: '', color: '', hex: '#cfc8bd', length: null, thickness: null, size: null, formality: 'both' };
  const touched = new Set(orig ? ['name', 'category', 'color', 'length', 'thickness', 'size', 'formality'] : []);

  $view.innerHTML = `<button class="back" id="back">‹ ${orig ? '돌아가기' : '옷장'}</button>
    <h1 class="title" style="margin-top:6px">${orig ? '옷 수정' : '옷 추가'}</h1>
    <div class="field"><p class="lb">사진</p>
      <div class="photo-box" id="pbox"></div>
      <div class="row"><label class="btn ghost" style="text-align:center">사진 찍기 · 앨범에서 고르기<input type="file" accept="image/*" hidden id="pfile"></label>
      <button type="button" class="btn ghost" id="pdel" style="flex:0 0 96px">사진 빼기</button></div>
      <p class="hint">사진이 없어도 등록할 수 있어요. 나중에 추가하면 돼요.</p></div>
    <div class="field"><p class="lb">설명</p>
      <textarea class="memo" id="desc" rows="2" placeholder="예: 검정 니트 가디건, 얇음, 출근용">${esc(f.desc || '')}</textarea>
      <p class="hint">설명을 쓰면 아래 칸을 자동으로 채워 줘요. 틀리면 직접 고치면 돼요.</p></div>
    <div class="field"><p class="lb">이름</p><input class="inp" id="name" value="${esc(f.name)}" placeholder="예: 검정 니트 가디건"></div>
    <div class="field"><p class="lb">카테고리 <span class="sug" id="catSug"></span></p>${opts('category', CATEGORIES, f.category)}</div>
    <div class="field"><p class="lb">색상</p><div class="color-row"><i id="sw" style="background:${esc(f.hex)}"></i><input class="inp" id="color" value="${esc(f.color)}" placeholder="예: 블랙"></div></div>
    <div class="field" data-need="length"><p class="lb">기장 <span class="req">필수</span></p>${opts('length', LENGTHS, f.length)}<p class="hint">출근일에는 미니가 빠져요.</p></div>
    <div class="field" data-need="thickness"><p class="lb">두께 <span class="req">필수</span></p>${opts('thickness', THICKNESS, f.thickness)}<p class="hint">기온에 맞는 아우터를 고를 때 써요.</p></div>
    <div class="field" data-need="size"><p class="lb">가방 크기 <span class="req">필수</span></p>${opts('size', BAG_SIZES, f.size)}<p class="hint">출근일에는 큰 가방만 써요.</p></div>
    <div class="field"><p class="lb">용도</p>${opts('formality', FORMALITY, f.formality)}</div>
    <div class="row" style="margin-top:8px"><button class="btn" id="save">${orig ? '저장' : '옷장에 추가'}</button></div>
    ${orig ? '<div class="row"><button class="btn ghost danger" id="remove">이 옷 삭제</button></div>' : ''}`;

  const $ = s => $view.querySelector(s);
  const paintPhoto = () => {
    $('#pbox').innerHTML = f.photo ? `<img src="${f.photo}" alt="">` : '<div class="basic">사진 없음</div>';
    $('#pdel').hidden = !f.photo;
  };
  const paintOpts = () => {
    $view.querySelectorAll('.opts').forEach(g => g.querySelectorAll('button').forEach(b => b.classList.toggle('on', f[g.dataset.name] === b.dataset.v)));
    const need = requiredFields(f.category);
    $view.querySelectorAll('[data-need]').forEach(el => el.hidden = !need.includes(el.dataset.need));
    $('#sw').style.background = f.hex;
  };
  paintPhoto(); paintOpts();

  $('#back').onclick = () => openCloset(orig ? { view: 'detail', id } : null);
  $('#pfile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { f.photo = await shrinkPhoto(file); paintPhoto(); } catch (err) { alert(err.message); }
    e.target.value = '';
  };
  $('#pdel').onclick = () => { f.photo = null; paintPhoto(); };
  $view.querySelectorAll('.opts button').forEach(b => b.onclick = () => {
    const k = b.parentElement.dataset.name; f[k] = b.dataset.v; touched.add(k); paintOpts();
  });
  $('#name').oninput = e => { f.name = e.target.value; touched.add('name'); };
  $('#color').oninput = e => {
    f.color = e.target.value; touched.add('color');
    const s = suggest(f.color); if (s.color) f.hex = s.hex; paintOpts();
  };
  let timer;
  $('#desc').oninput = e => {
    f.desc = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const s = suggest(f.desc);
      if (!touched.has('name') && s.name) { f.name = s.name; $('#name').value = s.name; }
      if (!touched.has('category') && s.category) { f.category = s.category; f.type = s.type; }
      if (!touched.has('color') && s.color) { f.color = s.color; f.hex = s.hex; $('#color').value = s.color; }
      for (const k of ['length', 'thickness', 'size']) if (!touched.has(k) && s[k]) f[k] = s[k];
      if (!touched.has('formality')) f.formality = s.formality;
      $('#catSug').textContent = s.category ? `자동 추천: ${s.category}` : '';
      paintOpts();
    }, 350);
  };

  $('#save').onclick = async () => {
    clearTimeout(timer);
    const name = (f.name || f.desc.split(/[,，]/)[0] || '').trim();
    if (!name) return toast('이름이나 설명을 적어 주세요.');
    if (!f.category) return toast('카테고리를 골라 주세요.');
    const label = { length: '기장을', thickness: '두께를', size: '가방 크기를' };
    const miss = requiredFields(f.category).filter(k => !f[k]);
    if (miss.length) return toast(`${label[miss[0]]} 골라 주세요.`);
    const item = { ...f, name: name, color: f.color.trim() || '색 미입력' };
    if (!orig) { item.id = 'u' + Date.now().toString(36); item.source = '직접 등록'; item.addedAt = new Date().toISOString(); }
    if (!(item.category === '하의' || item.category === '원피스')) delete item.length;
    if (item.category !== '아우터') delete item.thickness;
    if (item.category !== '가방') delete item.size;
    if (!item.type) item.type = suggest(item.name).type || item.category;
    await db.put('items', item);
    toast(orig ? '저장했어요.' : '옷장에 추가했어요. 다음 코디부터 쓰여요.');
    openCloset({ view: 'detail', id: item.id, justAdded: !orig });
  };
  if (orig) $('#remove').onclick = async () => {
    const t = await today();
    const upcoming = (await db.getAll('outfits')).filter(o => o.date >= t && o.items.includes(id)).map(o => md(o.date));
    const warn = upcoming.length ? `\n\n${upcoming.join(', ')} 코디에 들어 있어요. 그 날 카드에서는 이 옷이 빠져 보여요.` : '';
    if (!confirm(`'${orig.name}'을(를) 옷장에서 삭제할까요?${warn}`)) return;
    await db.del('items', id);
    toast('삭제했어요.');
    openCloset(null);
  };
}

// ---------- 설정 ----------
async function renderSettings() {
  const test = await db.getMeta('testToday');
  const all = await db.dumpAll();
  const key = await db.getMeta('appKey');
  const snap = await db.getMeta('calendarSnapshot');
  const wx = await db.getMeta('weather');
  const fb = await db.getAll('feedback');
  const custom = fb.filter(f => f.kind === 'custom').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const baseRules = fb.filter(f => f.kind === 'rule');
  const usage = (await db.getMeta('aiUsage')) || [];
  const ym = localToday().slice(0, 7);
  const monthWon = usage.filter(u => (u.at || '').slice(0, 7) === ym).reduce((a, u) => a + (u.won || 0), 0);
  const when = s => s ? new Date(s).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
  $view.innerHTML = `<p class="eyebrow">Settings</p><h1 class="title">설정</h1>
    <div class="panel"><h3>내 코디 규칙</h3>
      <p>코디를 짤 때 AI가 꼭 참고해요. 예: "금요일엔 바지", "빨간 가디건은 휴무일에만"</p>
      <ul class="rules">${custom.map(r => `<li><span>${esc(r.text)}</span><button class="small-btn" data-del="${r.id}">삭제</button></li>`).join('') || '<li class="empty">아직 없어요</li>'}</ul>
      <textarea class="memo" id="ruleIn" rows="2" placeholder="새 규칙 적기"></textarea>
      <div class="row"><button class="btn" id="ruleAdd">규칙 추가</button></div>
      <details class="base-rules"><summary>처음부터 들어 있는 규칙 ${baseRules.length}개 보기</summary>
        <ul>${baseRules.map(r => `<li>${esc(r.text)}</li>`).join('')}</ul>
        <p class="hint">출근일 큰 가방·짧은 치마 X·롱부츠 X·기온별 아우터 두께는 앱이 직접 검사해서 어긴 코디는 저장하지 않아요.</p></details></div>
    <div class="panel"><h3>AI 사용 비용</h3><p>이번 달 약 ${monthWon.toLocaleString()}원 · 전체 ${usage.length}회 호출 (Claude Sonnet 5.5, 1달러=1,400원 기준 추정)</p></div>
    <div class="panel"><h3>백업</h3><p>폰을 바꾸거나 데이터가 지워져도 복구할 수 있게 가끔 내보내 두세요. 아이폰에서는 공유 창이 뜨면 "파일에 저장"을 누르면 돼요.</p>
      <div class="row"><button class="btn" id="exp">백업 내보내기</button>
      <label class="btn ghost" style="text-align:center">불러오기<input type="file" accept="application/json,.json" hidden id="imp"></label></div>
      <p class="hint">지금 저장된 것: 옷 ${all.items.length}개 · 코디 ${all.outfits.length}일 · 일러스트 ${all.illustrations.length}장 · 피드백 ${all.feedback.length}개</p></div>
    <div class="panel"><h3>캘린더 · 날씨 연결</h3>
      <p>${key ? `캘린더: ${state.syncError ? '⚠ ' + esc(state.syncError) : (snap ? '연결됨 · ' + esc((snap.calendars || []).join(', ')) : '아직 확인 전')}` : '캘린더: 앱 비밀번호가 아직 없어요. 받은 연결 링크를 한 번 열거나 아래에 붙여 넣어 주세요.'}</p>
      ${snap?.errors?.length ? `<p class="hint warn-hint">읽지 못한 캘린더: ${esc(snap.errors.join(', '))}</p>` : ''}
      <p class="hint">마지막 캘린더 확인 ${when(snap?.checkedAt)} · 날씨 ${when(wx?.fetchedAt)} (서울, Open-Meteo)</p>
      <div class="row"><button class="btn" id="syncNow">지금 확인</button></div>
      <p class="hint">${key ? `저장된 연결 비밀번호: …${esc(key.slice(-4))}` : ''} · 연결 링크를 다시 누르면 자동으로 바뀌어요.</p>
      <div class="set-row"><input class="inp" id="keyIn" placeholder="연결 링크 또는 비밀번호 붙여 넣기 (API 키 X)" style="font-size:13px"><button class="small-btn" id="keySave">저장</button></div></div>
    <div class="panel"><h3>자동 코디 · 일러스트</h3>
      <p>켜 두면 앱을 열 때 비어 있는 날(이번 주 남은 날 + 다음 주)의 코디를 알아서 짜고, 그림도 자동으로 그려져요. 비용은 미리 승인된 걸로 처리해요 (코디 주 약 60원 · 일러스트는 Figma 크레딧, 하루 최대 5장).</p>
      <div class="set-row"><span class="lb">자동으로 하기</span><button class="small-btn" id="autoToggle">${(await db.getMeta('autoMode')) === false ? '꺼짐 → 켜기' : '켜짐 → 끄기'}</button></div></div>
    <div class="panel"><h3>테스트용 오늘 날짜</h3><p>다른 날짜를 '오늘'로 보고 싶을 때만 써요. 평소에는 비워 두세요.</p>
      <div class="set-row"><input type="date" id="tdate" value="${test || ''}"><button class="small-btn" id="tclear">원래 날짜로</button></div></div>
    <div class="panel"><h3>앱 정보</h3><p>주간 코디 ${APP_VERSION} · 데이터는 이 폰 안에만 저장돼요.</p></div>`;
  $view.querySelector('#autoToggle').onclick = async () => {
    const off = (await db.getMeta('autoMode')) === false;
    await db.setMeta('autoMode', off ? true : false);
    toast(off ? '자동으로 하기를 켰어요.' : '자동으로 하기를 껐어요.');
    renderSettings();
    if (off) autoRun();
  };
  $view.querySelector('#ruleAdd').onclick = async () => {
    const v = $view.querySelector('#ruleIn').value.trim();
    if (!v) return toast('규칙을 적어 주세요.');
    await db.put('feedback', { id: 'c' + Date.now().toString(36), kind: 'custom', date: null, text: v, itemIds: [], createdAt: new Date().toISOString() });
    toast('규칙을 추가했어요. 다음 코디부터 반영돼요.');
    renderSettings();
  };
  $view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('이 규칙을 삭제할까요?')) return;
    await db.del('feedback', b.dataset.del); renderSettings();
  });
  $view.querySelector('#syncNow').onclick = async e => {
    e.target.disabled = true; e.target.textContent = '확인 중…';
    await sync({ manual: true });
    if (!state.syncError) toast('캘린더와 날씨를 확인했어요.');
    renderSettings();
  };
  $view.querySelector('#keySave').onclick = async () => {
    let v = $view.querySelector('#keyIn').value.trim();
    const m = v.match(/key=([A-Za-z0-9_-]+)/); if (m) v = m[1]; // 연결 링크를 통째로 붙여도 됨
    if (!v) return toast('비밀번호를 붙여 넣어 주세요.');
    if (/^(sk-ant|AIza)/.test(v)) return alert('이건 Anthropic·Google API 키예요. 여기에는 넣지 않아요.\n연결 비밀번호는 Claude가 준 연결 링크의 "#key=" 뒷부분이에요.');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(v)) return alert('연결 비밀번호 형식이 아니에요. 연결 링크를 다시 눌러 주세요.');
    await db.setMeta('appKey', v); await sync({ manual: true }); renderSettings();
  };
  $view.querySelector('#exp').onclick = async () => {
    const r = await exportBackup();
    if (r.ok) toast(`백업 파일을 만들었어요: ${r.name}`);
  };
  $view.querySelector('#imp').onchange = e => doImport(e.target.files[0], true);
  $view.querySelector('#tdate').onchange = async e => { await db.setMeta('testToday', e.target.value || null); state.selected = null; updateTestbar(); toast('테스트 날짜를 바꿨어요.'); };
  $view.querySelector('#tclear').onclick = async () => { await db.setMeta('testToday', null); state.selected = null; updateTestbar(); renderSettings(); toast('원래 날짜로 돌아왔어요.'); };
}

async function updateTestbar() {
  const t = await db.getMeta('testToday');
  const bar = document.getElementById('testbar');
  bar.hidden = !t;
  if (t) {
    bar.innerHTML = `테스트 날짜로 보는 중: ${md(t)} (${DOW_KO[weekday(t)]}) <button id="tb">해제</button>`;
    bar.querySelector('#tb').onclick = async () => { await db.setMeta('testToday', null); state.selected = null; updateTestbar(); render(); };
  }
}

// ---------- 탭 ----------
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  return ({ week: renderWeek, closet: renderCloset, settings: renderSettings })[state.tab]();
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { if (b.dataset.tab === 'closet') state.closetMode = null; state.tab = b.dataset.tab; render(); scrollTo(0, 0); });

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
// 연결 링크(#key=…)로 열었으면 비밀번호를 저장하고 주소창에서 지운다
async function takeKeyFromLink() {
  const m = location.hash.match(/key=([^&]+)/);
  if (!m) return false;
  const k = decodeURIComponent(m[1]).replace(/[^A-Za-z0-9_-]/g, '');
  if (!k) return false;
  await db.setMeta('appKey', k);
  history.replaceState(null, '', location.pathname + location.search);
  toast('캘린더 연결 비밀번호를 저장했어요.');
  return true;
}
window.addEventListener('hashchange', async () => {
  if (await takeKeyFromLink() && (await db.getAll('items')).length) { await sync({ manual: true }); render(); }
});
async function boot() {
  await takeKeyFromLink();
  updateTestbar();
  await render();
  await db.setMeta('illustStyleApproved', true); // 2026-11-08 그림체 확정
  if ((await db.getAll('items')).length) { await sync(); if (state.tab === 'week') render(); await autoRun(); }
}
boot();
setInterval(async () => {
  if (document.visibilityState !== 'visible' || !((await db.getMeta('illustPending')) || []).length) return;
  try { const got = await pullIllustrations(); if (got) { toast(`새 그림 ${got}장이 도착했어요.`); if (state.tab === 'week') render(); } } catch {}
}, 60000);
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && (await db.getAll('items')).length) { await sync(); if (state.tab === 'week') render(); await autoRun(); }
});
