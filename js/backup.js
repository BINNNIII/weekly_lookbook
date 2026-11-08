// 백업 내보내기 / 불러오기
import { dumpAll, replaceAll } from './db.js';

const APP = 'weekly-lookbook';

// 백업 파일(JSON) ↔ 저장소 형태 변환
function toStores(file) {
  const meta = [];
  if (file.settings) meta.push({ key: 'settings', value: file.settings });
  if (file.calendarSnapshot !== undefined) meta.push({ key: 'calendarSnapshot', value: file.calendarSnapshot });
  for (const m of file.meta || []) if (!meta.some(x => x.key === m.key)) meta.push(m);
  return {
    items: file.items || [],
    outfits: file.outfits || [],
    illustrations: file.illustrations || [],
    feedback: file.feedback || [],
    meta,
  };
}

export async function buildBackup() {
  const all = await dumpAll();
  const meta = all.meta.filter(m => m.key !== 'testToday'); // 테스트 날짜는 백업에서 제외
  const settings = meta.find(m => m.key === 'settings');
  const snap = meta.find(m => m.key === 'calendarSnapshot');
  return {
    app: APP, version: 1, exportedAt: new Date().toISOString(),
    items: all.items, outfits: all.outfits, illustrations: all.illustrations, feedback: all.feedback,
    settings: settings ? settings.value : null,
    calendarSnapshot: snap ? snap.value : null,
    meta: meta.filter(m => m.key !== 'settings' && m.key !== 'calendarSnapshot'),
  };
}

export async function exportBackup() {
  const data = await buildBackup();
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const name = `주간코디_백업_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  // 아이폰: 공유 시트 → "파일에 저장"
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return { ok: true, name }; }
    catch (e) { if (e.name === 'AbortError') return { ok: false, cancelled: true }; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return { ok: true, name };
}

export async function readBackupFile(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('백업 파일 형식이 아니에요.'); }
  if (data.app !== APP || !Array.isArray(data.items)) throw new Error('주간코디 백업 파일이 아니에요.');
  return data;
}

export async function importBackup(data) {
  await replaceAll(toStores(data));
}

export function summarize(data) {
  return `옷 ${data.items.length}개 · 코디 ${(data.outfits || []).length}일 · 일러스트 ${(data.illustrations || []).length}장 · 피드백 ${(data.feedback || []).length}개`;
}
