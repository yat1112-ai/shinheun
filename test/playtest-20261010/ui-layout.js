// 표현 전용 계산. 엔진 상태를 읽기만 하고 바꾸지 않는다. DOM에 의존하지 않아 Node 테스트로 검증한다.
// 논리 캔버스·영역 좌표는 확정 시안(reboot/ui-preview 1600×900)의 정보 구조를 따른다. style.css 의 숫자와 같은 값을 쓴다.
export const CANVAS = { width: 1600, height: 1000 };   // 폴드8 접은 화면 가로(1972×1248, 약 16:10) 기준 — 2026-10-09 사용자 결정
// 배율이 이 값보다 작으면(Fold8 접은 가로 등) html.compact 로 글자·터치 영역을 키운다.
export const COMPACT_BELOW = 0.65;
// style.css .ground 의 실제 크기(overflow:hidden 이라 이 밖은 잘린다). 슬롯은 이 안에서만 잡는다.
export const GROUND = { width: 1600, height: 944 };
export const MAX_SIDE = 5;
export const MAX_ROW = 4;   // 한 열(전열·후열) 최대 인원
// 진형 4종(사용자 확정 2026-10-09): 자리는 진형마다 고정이고, 캐릭터는 고정된 자리 중 하나에 선다.
// 한 열에 1명이면 그 열의 가운데. 인원이 5명보다 적으면 빈 자리는 비워 둔다(다른 유닛이 옮겨 가지 않음).
export const FORMATIONS = { A: { front: 1, back: 4 }, B: { front: 2, back: 3 }, C: { front: 3, back: 2 }, D: { front: 4, back: 1 } };
export const ENEMY_DEFAULT_FORMATION = 'B';

// 고정 논리 캔버스를 뷰포트에 맞추는 배율(여백은 배경이 채운다). 잘못된 크기는 1로 둔다.
export function fitScale(viewWidth, viewHeight, canvas = CANVAS) {
  if (!(viewWidth > 0) || !(viewHeight > 0)) return 1;
  return Math.min(viewWidth / canvas.width, viewHeight / canvas.height);
}
export const isCompact = (scale, viewWidth, viewHeight) => scale < COMPACT_BELOW && viewWidth >= viewHeight;

const FRONT_ROLES = new Set(['guardian', 'striker']);

// 아군은 역할로 전열/후열을 나눈다(엔진에는 진형 데이터가 없는 표시용 기본 배치). 적은 앞쪽 최대 2체가 전열이다.
export function splitRows(units, side, roleOf = () => null) {
  const list = (units || []).slice(0, MAX_SIDE);
  if (side === 'enemy') {
    const front = list.slice(0, Math.min(2, list.length));
    return { front, back: list.slice(front.length) };
  }
  return { front: list.filter(u => FRONT_ROLES.has(roleOf(u))), back: list.filter(u => !FRONT_ROLES.has(roleOf(u))) };
}

// 5명이 모두 있을 때만 A~D(A 전열1/후열4 … D 전열4/후열1)로 부른다. 그 밖에는 실제 열 인원만 보여 준다.
export function formationLabel(frontCount, backCount) {
  const total = frontCount + backCount;
  if (total === MAX_SIDE && frontCount >= 1 && frontCount <= 4) return { letter: 'ABCD'[frontCount - 1], text: `전열 ${frontCount} · 후열 ${backCount}` };
  return { letter: null, text: `전열 ${frontCount} · 후열 ${backCount}` };
}

// 발 위치 기준 유닛 상자(배율 1 최대): 이름표(34)+스프라이트(124)가 발 위로, 그림자가 발 아래로 8px.
export const UNIT_BOX = { width: 124, above: 158, below: 8 };
// 전장 위에 얹힌 UI 영역(전장 좌표 = 콘텐츠 좌표, style.css 와 같은 숫자). 유닛은 이 영역과 겹치지 않는다.
export const UI_RECTS = {
  order: { x: 8, y: 8, width: 100, height: 720 },        // .order 행동 순서
  formation: { x: 1482, y: 8, width: 110, height: 112 },  // .formation 진형
  pet: { x: 585, y: 455, width: 86, height: 100 },      // .pet-slot 펫
  ticker: { x: 330, y: 8, width: 940, height: 40 },       // .ticker 전투 로그(left/right 330)
  hud: { x: 120, y: 752, width: 1360, height: 184 },      // .hud 파티 카드 띠
};
// 진형 격자(사용자 확정 2026-10-09). 전장 = 콘텐츠 전체 1600×944, UI 는 전장 위에 얹는다(style.css).
// - 모든 유닛 같은 크기(UNIT_SCALE), 아군·적 그림 틀도 같은 크기(104×124).
// - 한 열(전열·후열)은 한 대각선 직선 위에 같은 간격(ROW_DX, ROW_DY)으로 선다. 두 열은 평행. 1명뿐인 열은 그 줄 정가운데.
//   앞뒤로 살짝 겹치는 것은 허용(아래쪽 유닛이 앞에 그려짐)하되, 뒤 유닛의 이름표는 가리지 않는다.
// - 아군 후열 줄 중심 280 · 전열 480, 적은 좌우로 뒤집어 1320 · 1120. 양측 사이는 최소 약 300px 떨어진다(D 진형 318).
export const UNIT_SCALE = 0.9;
const ROW_DX = 70, ROW_DY = 105;
const COLUMN_X = { back: 280, front: 480 };
const ROW_CENTER_Y = 470;
// 한 열의 고정 자리(위→아래). n 은 그 열의 자리 수(진형이 정함). 1자리면 열 가운데.
function rowSlots(n, row, side) {
  return Array.from({ length: n }, (_, i) => {
    const k = i - (n - 1) / 2;
    const y = Math.round(ROW_CENTER_Y + k * ROW_DY), ax = Math.round(COLUMN_X[row] - k * ROW_DX);
    return { row, slot: i, side, x: side === 'enemy' ? GROUND.width - ax : ax, y, z: y, scale: UNIT_SCALE };
  });
}
export function formationSlots(letter, side) {
  const f = FORMATIONS[letter];
  return { front: rowSlots(f.front, 'front', side), back: rowSlots(f.back, 'back', side) };
}
// 빈 자리가 있을 때 채우는 순서: 열 가운데 자리부터(위아래 대칭이면 위쪽 먼저).
const centerOut = n => Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2) || a - b);

// 진형 선택 기능이 생기기 전 기본 진형: 아군은 전열 역할(수호·공격) 인원을 1~4로 맞춘 진형, 적은 B(전열 2·후열 3).
export function defaultFormation(units, side, roleOf = () => null) {
  if (side === 'enemy') return ENEMY_DEFAULT_FORMATION;
  const f = (units || []).slice(0, MAX_SIDE).filter(u => FRONT_ROLES.has(roleOf(u))).length;
  return 'ABCD'[Math.min(4, Math.max(1, f)) - 1];
}

// 한쪽 진영 배치: 진형의 고정 자리에 유닛을 세운다(발 위치 기준, 바닥 좌표). 적은 아군을 좌우 대칭으로 뒤집는다.
// 유닛은 선호 열(아군=역할, 적=앞쪽 인원)의 빈 자리에 가운데부터 서고, 그 열이 차면 반대 열의 빈 자리에 선다.
export function placeSide(units, side, roleOf, formation) {
  const list = (units || []).slice(0, MAX_SIDE);
  const letter = FORMATIONS[formation] ? formation : defaultFormation(list, side, roleOf);
  const slots = formationSlots(letter, side), free = { front: centerOut(slots.front.length), back: centerOut(slots.back.length) };
  const pref = side === 'enemy'
    ? { front: list.slice(0, FORMATIONS[letter].front), back: list.slice(FORMATIONS[letter].front) }
    : splitRows(list, side, roleOf);
  const placed = [];
  const put = (unit, row) => {
    const r = free[row].length ? row : row === 'front' ? 'back' : 'front';
    placed.push({ unit, ...slots[r][free[r].shift()] });
  };
  for (const u of pref.front) put(u, 'front');
  for (const u of pref.back) put(u, 'back');
  const count = row => placed.filter(p => p.row === row).length;
  return { formation: letter, front: count('front'), back: count('back'), slots, placed: [...placed.filter(p => p.row === 'back'), ...placed.filter(p => p.row === 'front')] };
}

// 이름표·스프라이트·그림자를 모두 포함한 실제 경계(바닥 좌표).
// 배율(scale)은 발 위치(아래 가운데) 기준으로 줄어든다(style.css .unit transform-origin 50% 100%).
export const unitRect = p => {
  const s = p.scale ?? 1;
  return { x: p.x - UNIT_BOX.width * s / 2, y: p.y - UNIT_BOX.above * s, width: UNIT_BOX.width * s, height: (UNIT_BOX.above + UNIT_BOX.below) * s };
};
export const rectsOverlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
export const rectInside = (r, outer) => r.x >= outer.x && r.y >= outer.y && r.x + r.width <= outer.x + outer.width && r.y + r.height <= outer.y + outer.height;

// 마을 장면(캔버스 좌표). 시설 위치는 확정 시안(final-hub-bg 위 핫스팟)과 같고, 패널은 시설과 겹치지 않는 빈 하늘·광장에 둔다.
export const VILLAGE = {
  topbar: { x: 0, y: 0, width: 1600, height: 112 },
  claimCard: { x: 16, y: 12, width: 240, height: 318 },
  statusCard: { x: 1314, y: 12, width: 270, height: 220 },
  nav: { x: 0, y: 888, width: 1600, height: 112 },
  spots: {
    church: { x: 265, y: 215, width: 230, height: 150 },
    market: { x: 175, y: 445, width: 245, height: 155 },
    mine: { x: 1010, y: 185, width: 270, height: 175 },
    dispatch: { x: 1320, y: 245, width: 250, height: 155 },
    raid: { x: 1270, y: 510, width: 270, height: 180 },
    clock: { x: 645, y: 300, width: 310, height: 430 },
  },
};

// 남은 행동 순서. 라운드 도중이면 큐의 남은 생존 유닛, 라운드 경계이면 다음 라운드 속도 예상 순서.
export function actionOrder(battle, limit = 10) {
  if (!battle || (battle.status && battle.status !== 'active')) return [];
  const all = [...battle.allies, ...battle.enemies], byId = new Map(all.map(u => [u.id, u]));
  let ids = (battle.queue || []).slice(battle.cursor || 0).filter(id => byId.get(id)?.hp > 0);
  if (!ids.length) ids = all.filter(u => u.hp > 0).sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id)).map(u => u.id);
  return ids.slice(0, limit).map(id => byId.get(id));
}

const TARGETS = { lowestHpAlly: '가장 다친 아군', allAllies: '아군 전체', singleEnemy: '적 단일', distributedEnemies: '적 분산' };
const KINDS = { heal: '회복', attack: '공격', shield: '보호막' };
export function skillTip(skill) {
  if (!skill) return '';
  const parts = [skill.name, KINDS[skill.type] || skill.type, TARGETS[skill.target] || skill.target];
  if (Number.isFinite(skill.cooldown)) parts.push(`재사용 ${skill.cooldown}턴`);
  return parts.filter(Boolean).join(' · ');
}

// Show the next living actors continuously, including predicted upcoming rounds.
export function actionTimeline(battle, limit = 9) {
  if (!battle || battle.status !== 'active') return [];
  const live = [...battle.allies, ...battle.enemies].filter(u => u.hp > 0);
  if (!live.length) return [];
  const map = new Map(live.map(u => [u.id,u]));
  const ranked = [...live].sort((a,b) => b.speed - a.speed || a.id.localeCompare(b.id));
  const pending = (battle.queue || []).slice(battle.cursor || 0)
    .map(id => map.get(id)).filter(Boolean);
  const output = pending.map(unit => ({unit, roundOffset:0}));
  let offset = pending.length ? 1 : 0;
  while (output.length < limit) {
    for (const unit of ranked) {
      if (output.length >= limit) break;
      output.push({unit, roundOffset:offset});
    }
    offset++;
  }
  return output.slice(0, limit);
}

export const cooldownLeft = (unit, skillId) => Math.max(0, Number(unit?.cooldowns?.[skillId]) || 0);
export const hpPercent = unit => unit && unit.maxHp > 0 ? Math.max(0, Math.min(100, Math.round(unit.hp / unit.maxHp * 100))) : 0;

// 상태 칩: 남은 라운드를 함께 보여 준다.
export function statusChips(unit, labels = {}) {
  return (unit?.effects || []).map(e => ({ label: labels[e.type] || e.type, remaining: Math.max(0, Number(e.remaining) || 0) }));
}

// Automatic skills are read-only indicators; incapacitation takes priority over cooldown.
export function allySkillState(unit, skillId) {
  const cooldown = cooldownLeft(unit, skillId);
  return { cooldown, state: unit.hp <= 0 ? 'down' : cooldown > 0 ? 'cool' : 'ready',
    label: unit.hp <= 0 ? '전투 불가' : cooldown > 0 ? `${cooldown}턴` : '준비' };
}
