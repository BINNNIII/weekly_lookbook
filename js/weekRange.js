// 주간 범위 규칙 (프롬프트 v2 · 3번)
// - 기본은 월~일. 월이 바뀌는 곳에서는 주를 나눈다.
// - 월초: 1일이 수~일요일이면 그 자투리 주를 다음 주와 합친다.
// - 월말: 말일이 월~수요일이면 그 자투리 주를 전 주와 합친다.
// 날짜는 시간대 문제를 피하려고 'YYYY-MM-DD' 문자열로 주고받는다.

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function fmt(dt) {
  return dt.toISOString().slice(0, 10);
}
export function addDays(s, n) {
  const dt = parseDate(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}
// 0=일 1=월 ... 6=토
export function weekday(s) {
  return parseDate(s).getUTCDay();
}

// 한 달을 표시용 주(chunk) 목록으로 나눈다. 각 chunk = 날짜 문자열 배열
export function monthChunks(year, month /* 1-12 */) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const chunks = [];
  let cur = [];
  for (let d = 1; d <= last; d++) {
    const s = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (weekday(s) === 1 && cur.length) { chunks.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) chunks.push(cur);

  // 월초: 1일이 수(3)·목(4)·금(5)·토(6)·일(0)이면 다음 주와 합침
  const firstWd = weekday(chunks[0][0]);
  if (chunks.length > 1 && [3, 4, 5, 6, 0].includes(firstWd)) {
    chunks.splice(0, 2, [...chunks[0], ...chunks[1]]);
  }
  // 월말: 말일이 월(1)·화(2)·수(3)면 전 주와 합침
  const lastChunk = chunks[chunks.length - 1];
  const lastWd = weekday(lastChunk[lastChunk.length - 1]);
  if (chunks.length > 1 && [1, 2, 3].includes(lastWd)) {
    const prev = chunks[chunks.length - 2];
    chunks.splice(chunks.length - 2, 2, [...prev, ...lastChunk]);
  }
  return chunks;
}

// 어떤 날짜가 속한 표시용 주 → { start, end, days }
export function weekOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const chunk = monthChunks(y, m).find(c => c.includes(dateStr));
  return { start: chunk[0], end: chunk[chunk.length - 1], days: chunk };
}

// 다음 표시용 주 (미리 짜 둘 주)
export function nextWeek(dateStr) {
  return weekOf(addDays(weekOf(dateStr).end, 1));
}
