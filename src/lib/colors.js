// 빈티지 톤 캘린더/일정 색상
export const PALETTE = [
  '#6f95c4', '#e4513a', '#e8a3a0', '#e6a157', '#d9b44a', '#8fa876',
  '#5f9e8f', '#9b87c4', '#c48aa8', '#a07a5e', '#7d8a96', '#3b3530',
];

const svg = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

function tulip(x, y, s, color, stemH) {
  return `<path d="M${x} ${y + s} q${-s * 0.4} ${stemH * 0.5} ${s * 0.1} ${stemH}" stroke="#6f8a5c" stroke-width="${s * 0.16}" fill="none" stroke-linecap="round"/>`
    + `<path d="M${x} ${y + s * 2.2} q${-s * 1.6} ${-s * 0.4} ${-s * 1.5} ${s * 2.6} q${s * 1.2} ${-s * 0.6} ${s * 1.5} ${-s * 2.6}" fill="#86a06f"/>`
    + `<path d="M${x - s} ${y - s * 0.2} Q${x - s} ${y + s * 1.05} ${x} ${y + s * 1.05} Q${x + s} ${y + s * 1.05} ${x + s} ${y - s * 0.2} L${x + s * 0.5} ${y + s * 0.2} L${x} ${y - s * 0.6} L${x - s * 0.5} ${y + s * 0.2} Z" fill="${color}"/>`
    + `<path d="M${x - s * 0.15} ${y - s * 0.1} Q${x} ${y + s * 0.7} ${x + s * 0.5} ${y + s * 0.85}" stroke="rgba(255,255,255,.35)" stroke-width="${s * 0.12}" fill="none"/>`;
}

const TULIPS = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" preserveAspectRatio="xMidYMid slice">
<rect width="600" height="200" fill="#d9c7bd"/>
${tulip(330, 70, 34, '#d9573f', 140)}${tulip(420, 40, 30, '#f0d79a', 170)}${tulip(500, 85, 36, '#d9573f', 130)}
${tulip(250, 110, 26, '#f0d79a', 100)}${tulip(565, 30, 26, '#e07a62', 180)}${tulip(180, 60, 22, '#e07a62', 150)}
</svg>`);

const HEARTS = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
<rect width="44" height="44" fill="#f3d9d4"/>
<path d="M11 15c-2-3-7-2-7 2 0 3 4 6 7 8 3-2 7-5 7-8 0-4-5-5-7-2z" fill="#e4776a"/>
<path d="M33 37c-1.4-2-5-1.4-5 1.4 0 2 2.8 4.2 5 5.6 2.2-1.4 5-3.6 5-5.6 0-2.8-3.6-3.4-5-1.4z" fill="#e8a3a0"/>
<path d="M33 9c-1.4-2-5-1.4-5 1.4 0 2 2.8 4.2 5 5.6 2.2-1.4 5-3.6 5-5.6 0-2.8-3.6-3.4-5-1.4z" fill="#e8a3a0"/>
</svg>`);

// 커버 이미지 기본값. 저장 형식: 'preset:N'
export const COVER_PRESETS = [
  { name: '튤립', css: { background: `${TULIPS} center/cover` } },
  { name: '하트', css: { background: `${HEARTS} 0 0/44px 44px` } },
  {
    name: '깅엄 체크',
    css: {
      backgroundColor: '#f6efe4',
      backgroundImage: 'linear-gradient(90deg, rgba(228,81,58,.35) 50%, transparent 50%), linear-gradient(rgba(228,81,58,.35) 50%, transparent 50%)',
      backgroundSize: '28px 28px',
    },
  },
  { name: '물방울', css: { backgroundColor: '#f2dfa7', backgroundImage: 'radial-gradient(#fff9ec 22%, transparent 24%)', backgroundSize: '26px 26px' } },
  { name: '세이지', css: { background: 'linear-gradient(160deg, #a9bb9c, #7f9a6a)' } },
  { name: '로즈', css: { background: 'linear-gradient(160deg, #f0c4bd, #d98c86)' } },
  { name: '스트라이프', css: { background: 'repeating-linear-gradient(90deg, #f6efe4 0 16px, #9fb6d3 16px 32px)' } },
];

export function coverStyle(cover, color) {
  if (cover?.startsWith('preset:')) return COVER_PRESETS[Number(cover.slice(7))]?.css || { background: color };
  if (cover?.startsWith('data:image/')) return { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return { background: `linear-gradient(160deg, ${color}, color-mix(in srgb, ${color} 60%, #3b3530))` };
}

/** 찢어진 종이 가장자리 모양 (0~100 너비, 0~10 높이) */
export const TORN_PATH = (() => {
  let d = 'M0 10 L0 5';
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let x = 1.5; x < 100; x += 1.2 + rnd() * 1.8) d += ` L${x.toFixed(1)} ${(2 + rnd() * 6).toFixed(1)}`;
  return `${d} L100 4 L100 10 Z`;
})();

/** 업로드한 이미지를 작은 JPEG(data URL)로 줄인다. Firestore 문서 크기 제한(1MB) 때문에 400KB 이하로 저장. */
export function resizeImage(file, maxW = 1200, maxH = 400) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('이미지 파일만 사용할 수 있습니다.')); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.max(maxW / img.width, maxH / img.height);
      const sw = maxW / scale;
      const sh = maxH / scale;
      const canvas = document.createElement('canvas');
      canvas.width = maxW;
      canvas.height = maxH;
      canvas.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, maxW, maxH);
      URL.revokeObjectURL(url);
      let q = 0.8;
      let data = canvas.toDataURL('image/jpeg', q);
      while (data.length > 380000 && q > 0.3) { q -= 0.1; data = canvas.toDataURL('image/jpeg', q); }
      if (data.length > 380000) reject(new Error('이미지가 너무 큽니다.'));
      else resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다.')); };
    img.src = url;
  });
}
