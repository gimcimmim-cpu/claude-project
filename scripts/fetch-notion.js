/**
 * fetch-notion.js
 * 노션 API에서 일정·할일·주간보고 데이터를 가져와
 * data/notion-data.json 을 갱신합니다.
 *
 * 사용법:
 *   NOTION_API_KEY=secret_xxx node scripts/fetch-notion.js
 *
 * 필요 패키지: node-fetch (Node 18+ 는 내장 fetch 사용 가능)
 */

const fs   = require('fs');
const path = require('path');

const API_KEY = process.env.NOTION_API_KEY;
if (!API_KEY) {
  console.error('❌  NOTION_API_KEY 환경 변수가 없습니다.');
  process.exit(1);
}

// ── DB 아이디 ──────────────────────────────────────
const DB_SCHEDULE   = '10798dc7e6904dda839970ab97005f00'; // 📅 일정 관리
const DB_TASKS      = '8a3af724ea954f799563a9b6c74ccf67'; // ✅ 할일 관리
const DB_WEEKLY     = '2bf56761fb4d80e39767c2ba0aab1aec'; // 주간업무보고서

const HEADERS = {
  'Authorization': `Bearer ${API_KEY}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

// ── 공통 fetch 래퍼 ────────────────────────────────
async function notionQuery(dbId, filter = {}, sorts = []) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ filter, sorts, page_size: 30 }),
  });
  if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function notionGet(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Notion API error ${res.status}`);
  return res.json();
}

// ── 텍스트 추출 헬퍼 ───────────────────────────────
function richText(arr) {
  return (arr || []).map(t => t.plain_text).join('');
}
function propText(page, key) {
  const p = page.properties?.[key];
  if (!p) return '';
  if (p.type === 'title')   return richText(p.title);
  if (p.type === 'rich_text') return richText(p.rich_text);
  if (p.type === 'select')  return p.select?.name || '';
  if (p.type === 'checkbox') return p.checkbox;
  if (p.type === 'date')    return p.date?.start || '';
  if (p.type === 'status')  return p.status?.name || '';
  return '';
}

// ── 오늘 기준 ±2주 범위 (팀장 일정 파악용) ─────────
function getWeekRange() {
  const now = new Date();
  const past = new Date(now);
  past.setDate(now.getDate() - 7);   // 1주 전 (완료된 회의도 확인)
  past.setHours(0,0,0,0);
  const future = new Date(now);
  future.setDate(now.getDate() + 21); // 3주 앞까지 (중요 일정 미리 파악)
  return {
    start: past.toISOString().slice(0,10),
    end:   future.toISOString().slice(0,10),
  };
}

// ── 1. 일정 수집 ───────────────────────────────────
async function fetchSchedule() {
  const { start, end } = getWeekRange();
  console.log(`📅 일정 수집: ${start} ~ ${end}`);

  const data = await notionQuery(
    DB_SCHEDULE,
    {
      and: [
        { property: '날짜/시간', date: { on_or_after: start } },
        { property: '날짜/시간', date: { on_or_before: end } },
      ]
    },
    [{ property: '날짜/시간', direction: 'ascending' }]
  );

  return data.results.map(p => ({
    id:    p.id,
    title: richText(p.properties?.['일정명']?.title || []) || '(제목 없음)',
    date:  p.properties?.['날짜/시간']?.date?.start || '',
    type:  propText(p, '유형'),
    place: propText(p, '장소'),
    memo:  propText(p, '준비물/메모'),
    done:  p.properties?.['완료여부']?.checkbox === true,
    url:   p.url,
  }));
}

// ── 2. 할일 수집 ───────────────────────────────────
async function fetchTasks() {
  console.log('✅ 할일 수집...');

  const data = await notionQuery(
    DB_TASKS,
    {
      and: [
        {
          or: [
            { property: '상태', select: { equals: '📥 inbox' } },
            { property: '상태', select: { equals: '🔄 진행중' } },
            { property: '상태', select: { equals: '⏸️ 보류' } },
          ]
        }
      ]
    },
    [{ property: '우선순위', direction: 'ascending' }]
  );

  return data.results.map(p => ({
    id:       p.id,
    title:    richText(p.properties?.['할일']?.title || []) || '(제목 없음)',
    status:   propText(p, '상태'),
    priority: propText(p, '우선순위'),
    due:      propText(p, '마감일'),
    category: (p.properties?.['카테고리']?.multi_select || []).map(s => s.name).join(', '),
    url:      p.url,
  }));
}

// ── 3. 최신 주간보고 수집 ──────────────────────────
async function fetchWeeklyReport() {
  console.log('📋 주간보고 수집...');

  const data = await notionQuery(
    DB_WEEKLY,
    {},
    [{ property: '보고서 날짜', direction: 'descending' }]
  );

  if (!data.results.length) return null;
  const latest = data.results[0];
  const title = richText(latest.properties?.['이름']?.title || []);

  // 주차 번호 추출
  const weekMatch = title.match(/(\d+)주차/);
  const week = weekMatch ? parseInt(weekMatch[1]) : null;

  // 날짜 범위
  const dateStart = latest.properties?.['보고서 날짜']?.date?.start || '';
  const dateEnd   = latest.properties?.['보고서 날짜']?.date?.end   || '';

  function fmtKor(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
  }

  return {
    week,
    title,
    period: `${fmtKor(dateStart)} ~ ${fmtKor(dateEnd)}`,
    url: latest.url,
    issues: [],   // 이슈는 페이지 본문 파싱이 복잡해 빈 배열 유지 (수동 관리)
    members: [],  // 팀원 현황도 동일
  };
}

// ── MAIN ───────────────────────────────────────────
async function main() {
  try {
    const [schedule, tasks, weeklyReport] = await Promise.all([
      fetchSchedule(),
      fetchTasks(),
      fetchWeeklyReport(),
    ]);

    // 기존 JSON 읽어서 issues / members 보존 (본문 파싱 어려운 부분)
    const outPath = path.join(__dirname, '..', 'data', 'notion-data.json');
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch(e) {}

    const output = {
      lastUpdated: new Date().toISOString(),
      schedule,
      tasks,
      weeklyReport: weeklyReport
        ? {
            ...weeklyReport,
            // 이슈·팀원 현황은 수동으로 관리하는 기존 데이터 유지
            issues:  existing.weeklyReport?.issues  || [],
            members: existing.weeklyReport?.members || [],
          }
        : existing.weeklyReport || null,
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

    console.log(`✅ data/notion-data.json 갱신 완료`);
    console.log(`   일정 ${schedule.length}건 / 할일 ${tasks.length}건`);
    if (weeklyReport) console.log(`   주간보고: ${weeklyReport.title}`);
    // 팀장 확인용: 미완료 일정 목록 출력
    const pending = schedule.filter(s => !s.done);
    if (pending.length) {
      console.log(`\n📋 미완료 일정 (팀장 확인 필요):`);
      pending.forEach(s => console.log(`   - [${s.date?.slice(0,10)}] ${s.title} ${s.memo ? '(' + s.memo.slice(0,30) + ')' : ''}`));
    }

  } catch(err) {
    console.error('❌ 오류 발생:', err.message);
    process.exit(1);
  }
}

main();
