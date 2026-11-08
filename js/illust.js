// 코디 일러스트 (Gemini 이미지 생성). 코드로 그린 그림은 쓰지 않는다.
import * as db from './db.js';
import { workerPost, workerFetch } from './calendar.js';

export const WON_PER_IMAGE = 95; // (Gemini API 직접 방식용 — 지금은 Figma 크레딧 사용)

const ROLE = { '아우터': 'outerwear', '상의': 'top', '하의': 'bottom', '원피스': 'dress', '신발': 'shoes', '가방': 'bag', '양말·스타킹': 'legwear', '액세서리': 'accessory' };
const ORDER = ['아우터', '원피스', '상의', '하의', '양말·스타킹', '신발', '가방', '액세서리'];
const THICK = { '얇음': 1, '보통': 2, '두꺼움': 3 };

function describe(i) {
  const a = [`color: ${i.color}`];
  if (i.length) a.push(`length: ${{ 미니: 'mini', 무릎: 'knee-length', 미디: 'midi, below the knee', 롱: 'long / full length' }[i.length] || i.length}`);
  if (i.thickness) a.push(`thickness: ${{ 얇음: 'thin', 보통: 'medium', 두꺼움: 'thick, warm' }[i.thickness]}`);
  if (i.heel) a.push(`heel: ${i.heel}`);
  return `${i.name} (${i.type || i.category}; ${a.join(', ')})`;
}

export function buildPrompt(outfit, byId, styleNotes = []) {
  const items = outfit.items.map(id => byId[id]).filter(Boolean)
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
  const outers = items.filter(i => i.category === '아우터').sort((a, b) => (THICK[b.thickness] || 2) - (THICK[a.thickness] || 2));
  const lines = items.map(i => {
    let role = ROLE[i.category] || i.category;
    if (i.category === '아우터' && outers.length === 2) role = i === outers[0] ? 'outermost layer, worn open' : 'worn underneath the outermost layer';
    return `- ${role}: ${describe(i)}`;
  });
  return [
    'Soft hand-drawn fashion illustration in a delicate Korean webtoon / anime style. NOT photorealistic, NOT 3D render.',
    'Clean pencil line art with light watercolor wash, soft flat shading, subtle paper texture, muted calm tones.',
    'A single slender young Korean woman in her late 20s, tall elongated fashion-illustration proportions, full body visible from head to shoes, relaxed standing pose.',
    'Long straight BLACK hair with a slight soft wave, gentle calm face.',
    'Plain light grey background, figure centered, subtle soft floor shadow.',
    '',
    'She wears exactly these items and nothing else (Korean product names given; the written color is always correct):',
    ...lines,
    '',
    'Draw only the details described for each item. Do not invent details (no extra buttons, no extra pockets, no logos). Items without described details should look simple and basic.',
    'Fashionable, modest, clean silhouette, every clothing item clearly visible. No text, no letters, no logos, no watermark.',
    ...(styleNotes.length ? ['', 'Style adjustments requested by the user:', ...styleNotes.map(s => `- ${s}`)] : []),
  ].join('\n');
}

// Figma 방식: 앱은 요청만 올리고, Claude Code가 Figma로 그려서 결과를 올려 둔다
export async function requestIllustration(date, priority = 'normal') {
  const outfit = await db.get('outfits', date);
  if (!outfit) throw new Error('이 날 코디가 없어요.');
  const items = await db.getAll('items');
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const notes = (await db.getMeta('illustStyleNotes')) || [];
  const used = outfit.items.map(id => byId[id]).filter(Boolean);
  await workerPost('/illust/request', {
    date, itemsKey: outfit.items.join(','), priority, sample: false,
    prompt: buildPrompt(outfit, byId, notes), styleNotes: notes,
    items: used.map(({ id, name, category, type, color, length, thickness, heel }) => ({ id, name, category, type, color, length, thickness, heel })),
    photos: used.filter(i => i.photo).map(i => ({ id: i.id, data: i.photo })),
  });
  const pend = new Set((await db.getMeta('illustPending')) || []);
  pend.add(date);
  await db.setMeta('illustPending', [...pend]);
}

export async function cancelIllustration(date) {
  await workerPost('/illust/cancel', { date });
  await db.setMeta('illustPending', ((await db.getMeta('illustPending')) || []).filter(d => d !== date));
}

// 앱을 켤 때: 완성된 그림 받아오기
export async function pullIllustrations() {
  const since = (await db.getMeta('illustSyncedAt')) || '';
  const r = await workerFetch(`/illust/results${since ? '?since=' + encodeURIComponent(since) : ''}`);
  const approved = await db.getMeta('illustStyleApproved');
  let got = 0, last = since;
  for (const x of r.results || []) {
    if (x.createdAt > last) last = x.createdAt;
    const o = await db.get('outfits', x.date);
    if (!o || (x.itemsKey && x.itemsKey !== o.items.join(','))) continue; // 그 사이 코디가 바뀌었으면 버림
    const image = x.image.startsWith('data:image/png') ? await toJpeg(x.image.split(',')[1], 'image/png') : x.image;
    await db.put('illustrations', { date: x.date, image, model: x.model, createdAt: x.createdAt, itemsKey: x.itemsKey, sample: false, stale: false });
    got++;
  }
  await db.setMeta('illustSyncedAt', last);
  await db.setMeta('illustPending', r.pending || []);
  return got;
}

async function toJpeg(b64, mime, maxW = 720) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('그림을 읽지 못했어요.')); i.src = `data:${mime};base64,${b64}`; });
  const s = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

export async function makeIllustration(date) {
  const outfit = await db.get('outfits', date);
  if (!outfit) throw new Error('이 날 코디가 없어요.');
  const items = await db.getAll('items');
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const notes = (await db.getMeta('illustStyleNotes')) || [];
  const prompt = buildPrompt(outfit, byId, notes);
  const images = outfit.items.map(id => byId[id]).filter(i => i?.photo).map(i => ({
    label: `Reference photo for the ${ROLE[i.category] || i.category}: ${i.name} — actual color: ${i.color}`,
    mime: i.photo.slice(5, i.photo.indexOf(';')),
    data: i.photo.slice(i.photo.indexOf(',') + 1),
  }));
  const r = await workerPost('/image', { prompt, images, aspect: '9:16' });
  const image = await toJpeg(r.image, r.mime);
  const approved = await db.getMeta('illustStyleApproved');
  await db.put('illustrations', { date, image, model: r.model, createdAt: new Date().toISOString(), itemsKey: outfit.items.join(','), sample: !approved });
  const log = (await db.getMeta('aiUsage')) || [];
  log.push({ at: new Date().toISOString(), kind: 'image', won: WON_PER_IMAGE, model: r.model, estimate: true });
  await db.setMeta('aiUsage', log.slice(-500));
  return image;
}
