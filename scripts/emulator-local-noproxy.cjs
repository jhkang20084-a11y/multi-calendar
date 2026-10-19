// 테스트 전용: firebase-tools 가 NO_PROXY 를 무시하고 127.0.0.1(에뮬레이터끼리) 요청까지 프록시로 보내는 문제를 막는다.
// 외부 주소는 그대로 프록시를 쓴다. (NODE_OPTIONS=--require 로 에뮬레이터 실행 시에만 불러옴)
const path = require('node:path');
let undici;
try { undici = require(require.resolve('undici', { paths: [path.join(__dirname, '../node_modules/firebase-tools')] })); } catch { return; }
const direct = new undici.Agent();
const orig = undici.ProxyAgent.prototype.dispatch;
undici.ProxyAgent.prototype.dispatch = function (opts, handler) {
  const host = new URL(String(opts.origin)).hostname;
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') return direct.dispatch(opts, handler);
  return orig.call(this, opts, handler);
};
