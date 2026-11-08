// 구글 캘린더(중간 비서 Worker 경유) 읽기 + 지난번과 비교
import * as db from './db.js';

export const WORKER_URL = 'https://weekly-lookbook.exchat-relay.workers.dev';

export async function workerFetch(path) {
  const key = await db.getMeta('appKey');
  if (!key) throw new Error('앱 비밀번호가 아직 없어요. 설정에서 연결해 주세요.');
  const r = await fetch(WORKER_URL + path, { headers: { 'x-app-key': key }, cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `연결 오류 (${r.status})`);
  return data;
}

// 근무 코드 읽기: "출근 A", "A 근무", "M1", "휴무", "연차" …
export function workCodeOf(title) {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  if (/휴무|오프|연차|반차|휴가|^off$/i.test(t)) return '휴무';
  const m = t.match(/^(?:출근\s*)?(M1|A|B|M)(?:\s*근무)?$/i) || t.match(/(?:출근|근무)\s*(M1|A|B|M)\b/i);
  return m ? m[1].toUpperCase() : null;
}

// 이벤트 목록 → 날짜별 {workCode, schedule[]}
export function buildDays(events, dates, workHours = {}) {
  const days = {};
  for (const d of dates) days[d] = { workCode: '휴무', schedule: [], holiday: null };
  for (const e of events) {
    const day = days[e.date];
    if (!day) continue;
    if (e.cal === '대한민국의 휴일') { day.holiday = e.title; day.schedule.push(`공휴일 · ${e.title}`); continue; }
    const code = workCodeOf(e.title);
    if (code) {
      day.workCode = code;
      if (code !== '휴무') {
        const time = e.allDay ? (workHours[code] || '') : `${e.start}–${e.end}`;
        day.schedule.unshift(`${time ? time + ' ' : ''}근무`.trim());
      }
      continue;
    }
    day.schedule.push(e.allDay ? e.title : `${e.start} ${e.title}`);
  }
  return days;
}

// 지난번(old)과 이번(now) 비교 → 바뀐 날짜 목록
export function diffDays(oldDays, nowDays, fromDate) {
  const changes = [];
  for (const [d, now] of Object.entries(nowDays)) {
    if (d < fromDate) continue;
    const old = oldDays[d];
    if (!old) continue;
    const msgs = [];
    if (old.workCode !== now.workCode) msgs.push(`${label(old.workCode)} → ${label(now.workCode)}`);
    if (old.schedule && !old.workOnly) {
      const added = now.schedule.filter(s => !old.schedule.includes(s) && !/근무$/.test(s));
      const removed = old.schedule.filter(s => !now.schedule.includes(s) && !/근무$/.test(s));
      for (const s of added) msgs.push(`일정 추가: ${s}`);
      for (const s of removed) msgs.push(`일정 삭제: ${s}`);
    }
    if (msgs.length) changes.push({ date: d, msgs, old, now });
  }
  return changes.sort((a, b) => a.date.localeCompare(b.date));
}
const label = c => (c === '휴무' ? '휴무' : `${c}근무`);

export async function workerPost(path, body) {
  const key = await db.getMeta('appKey');
  if (!key) throw new Error('앱 비밀번호가 아직 없어요. 설정에서 연결해 주세요.');
  const r = await fetch(WORKER_URL + path, { method: 'POST', headers: { 'x-app-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `연결 오류 (${r.status})`);
  return data;
}
