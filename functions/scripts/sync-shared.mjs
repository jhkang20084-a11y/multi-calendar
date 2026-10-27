// 앱(src/lib)의 일정 계산 코드를 서버 함수에서도 그대로 쓰도록 functions/shared 로 복사한다.
// 배포(predeploy)·에뮬레이터 테스트 전에 자동으로 실행된다. 직접 고치지 말고 src/lib 를 고칠 것.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const SHARED_FILES = ['feed.js', 'recurrence.js', 'time.js', 'categories.js', 'dday.js', 'holidays-data.json'];

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '../../src/lib');
const to = join(here, '../shared');
mkdirSync(to, { recursive: true });
for (const f of SHARED_FILES) copyFileSync(join(from, f), join(to, f));
console.log(`shared: ${SHARED_FILES.length}개 파일 복사`);
