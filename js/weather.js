// 서울 날씨 (Open-Meteo, 무료·키 없음). 16일치 예보를 받아 날짜별로 정리한다.
const URL_ = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_min,apparent_temperature_max,precipitation_probability_max'
  + '&hourly=temperature_2m,apparent_temperature,precipitation_probability'
  + '&timezone=Asia%2FSeoul&forecast_days=16';

export function describe(code) {
  if (code === 0) return ['☀︎', '맑음'];
  if (code <= 2) return ['⛅︎', '구름 조금'];
  if (code === 3) return ['☁︎', '흐림'];
  if (code === 45 || code === 48) return ['🌫︎', '안개'];
  if (code >= 51 && code <= 57) return ['☂︎', '이슬비'];
  if (code >= 61 && code <= 67) return ['☂︎', '비'];
  if (code >= 71 && code <= 77) return ['❄︎', '눈'];
  if (code >= 80 && code <= 82) return ['☂︎', '소나기'];
  if (code >= 85 && code <= 86) return ['❄︎', '눈'];
  if (code >= 95) return ['⚡︎', '뇌우'];
  return ['', '-'];
}

export async function fetchWeather() {
  const r = await fetch(URL_, { cache: 'no-store' });
  if (!r.ok) throw new Error('날씨를 불러오지 못했어요.');
  const j = await r.json();
  const days = {};
  j.daily.time.forEach((d, i) => {
    const [icon, summary] = describe(j.daily.weather_code[i]);
    days[d] = {
      icon, summary,
      min: Math.round(j.daily.temperature_2m_min[i]), max: Math.round(j.daily.temperature_2m_max[i]),
      feelMin: Math.round(j.daily.apparent_temperature_min[i]), feelMax: Math.round(j.daily.apparent_temperature_max[i]),
      pop: j.daily.precipitation_probability_max[i], hours: {},
    };
  });
  j.hourly.time.forEach((t, i) => {
    const d = t.slice(0, 10), h = +t.slice(11, 13);
    if (days[d]) days[d].hours[h] = { t: Math.round(j.hourly.temperature_2m[i]), feel: Math.round(j.hourly.apparent_temperature[i]), pop: j.hourly.precipitation_probability[i] };
  });
  return { fetchedAt: new Date().toISOString(), days };
}

// 출근 시각의 기온 (예: "06:30–15:30 근무" → 6시)
export function commuteTemp(day, schedule = []) {
  if (!day) return null;
  const m = schedule.join(' ').match(/(\d{2}):(\d{2})–\d{2}:\d{2} 근무/);
  if (!m) return null;
  const h = +m[1];
  const x = day.hours[h];
  return x ? { hour: h, ...x } : null;
}
