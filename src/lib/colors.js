export const PALETTE = [
  '#4f6bed', '#e85d75', '#f08c3a', '#e2b33c', '#3fae6a', '#2a9d8f',
  '#2f8fd8', '#7b61d9', '#c25bc7', '#8d6e63', '#607d8b', '#334155',
];

// 커버 이미지 기본값(그라디언트). 저장 형식: 'preset:N'
export const COVER_PRESETS = [
  'linear-gradient(135deg,#667eea,#764ba2)',
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#4facfe,#00f2fe)',
  'linear-gradient(135deg,#43e97b,#38f9d7)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#30cfd0,#330867)',
  'linear-gradient(135deg,#a8edea,#fed6e3)',
  'linear-gradient(135deg,#ff9a9e,#fecfef)',
];

export function coverStyle(cover, color) {
  if (cover?.startsWith('preset:')) return { background: COVER_PRESETS[Number(cover.slice(7))] || color };
  if (cover?.startsWith('data:image/')) return { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return { background: `linear-gradient(135deg, ${color}, ${color}aa)` };
}

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
