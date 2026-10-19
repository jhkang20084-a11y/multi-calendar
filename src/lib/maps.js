/** 네이버 지도 검색 주소. 휴대폰에서 네이버 지도 앱이 있으면 앱으로 열린다(유니버설 링크). */
export function naverMapUrl(place) {
  return `https://map.naver.com/p/search/${encodeURIComponent(String(place).trim())}`;
}
