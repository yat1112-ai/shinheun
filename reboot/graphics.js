// 표현 전용 헬퍼. 엔진 상태·판정을 바꾸지 않고 입력을 읽기만 한다.

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// 현재 저장소에 존재하는 오리지널 SVG만 매핑한다. 적 전용 에셋은 아직 없어 null(CSS .beast 대체)이다.
export const CHARACTER_ASSETS = {
  eir: 'assets/eir.svg',
  aren: 'assets/aren.svg',
  riana: 'assets/riana.svg',
  clea: 'assets/clea.svg',
};
export const ENEMY_ASSETS = {
  stray: null,
  wolf: null,
  boar: null,
  ragingBoar: null,
};
export const SCENE_ASSETS = {
  village: 'assets/village.svg',
  battle: 'assets/battle-forest.svg',
  pocketwatch: 'assets/pocketwatch.svg',
};

const own = (map, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);

export function assetPath(id, enemy = false) {
  return own(enemy ? ENEMY_ASSETS : CHARACTER_ASSETS, id);
}

// app.js avatar()와 같은 .avatar 구조(head/body/weapon/aura). 에셋이 있으면 img를 앞에 덧붙인다.
export function avatarMarkup(id, enemy = false) {
  const path = assetPath(id, enemy);
  const art = path ? `<img class="avatar-art" src="${esc(path)}" alt="" loading="lazy" decoding="async" draggable="false">` : '';
  return `<div class="avatar ${enemy ? 'beast' : esc(id)}"${enemy ? ` data-enemy="${esc(id)}"` : ''}${path ? ' data-art="svg"' : ''} aria-hidden="true">${art}<i class="head"></i><i class="body"></i><i class="weapon"></i><i class="aura"></i></div>`;
}

// 큰 포트레이트. 이름은 사용자/데이터 문자열이므로 이스케이프한다. 장식이므로 이미지는 alt가 비어 있다.
export function portraitMarkup(id, enemy = false, name = '') {
  const path = assetPath(id, enemy);
  const art = path ? `<img class="portrait-art" src="${esc(path)}" alt="" loading="lazy" decoding="async" draggable="false">` : '';
  const caption = name ? `<figcaption>${esc(name)}</figcaption>` : '';
  return `<figure class="portrait ${enemy ? 'beast' : esc(id)}" data-role="${enemy ? 'enemy' : 'ally'}">${art || avatarMarkup(id, enemy)}${caption}</figure>`;
}

export function prefersReducedMotion(win = typeof window !== 'undefined' ? window : null) {
  try {
    return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const num = v => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

// 이벤트 목록 → 연출 정보 배열. 같은 source→target의 damage는 (다른 대상과 교대해도, 사이에 비-damage 이벤트가 없으면) 하나의 multihit으로 묶는다.
// 각 항목: { type, unit, source, target, classes, data, amount }. data는 data-* 속성용 평문 객체.
export function describeBattleEvents(events = []) {
  const list = Array.isArray(events) ? events : [];
  const out = [];
  let runStart = 0; // 마지막 비-damage 이벤트 이후 구간. 이 안에서는 교대 대상 타격도 대상별로 합친다.
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'heal' || e.type === 'revive' || e.type === 'action') runStart = out.length + 1; // 이 이벤트 자신이 out[length]에 들어간다
    if (e.type === 'damage') {
      const prev = out.slice(runStart).find(x => x.type === 'impact' && x.source === e.source && x.target === e.target);
      if (prev) {
        prev.hits += 1;
        prev.amount += num(e.amount);
        prev.data.multihit = prev.hits;
        prev.data.amount = prev.amount;
        prev.classes = ['fx', 'fx-impact', 'fx-multihit'];
        continue;
      }
      out.push({ type: 'impact', unit: e.target, source: e.source, target: e.target, hits: 1, amount: num(e.amount),
        classes: ['fx', 'fx-impact'], data: { fx: 'impact', multihit: 1, amount: num(e.amount), absorbed: num(e.absorbed) } });
    } else if (e.type === 'heal') {
      out.push({ type: 'heal', unit: e.target, source: e.source, target: e.target, hits: 0, amount: num(e.amount),
        classes: ['fx', 'fx-heal'], data: { fx: 'heal', amount: num(e.amount) } });
    } else if (e.type === 'revive') {
      out.push({ type: 'revive', unit: e.target, source: e.source, target: e.target, hits: 0, amount: num(e.hp),
        classes: ['fx', 'fx-revive'], data: { fx: 'revive', amount: num(e.hp) } });
    } else if (e.type === 'action') {
      out.push({ type: 'action', unit: e.actor, source: e.actor, target: null, hits: 0, amount: 0,
        classes: ['fx', 'fx-action'], data: { fx: 'action', skill: String(e.skill ?? 'basicAttack') } });
    }
  }
  return out;
}

// 연출 항목 → class 문자열과 data-* 속성 문자열(값 이스케이프). reduced면 motion 비활성 표식을 붙인다.
export function effectClass(fx, reduced = false) {
  return [...fx.classes, ...(reduced ? ['fx-still'] : [])].map(esc).join(' ');
}
export function effectAttrs(fx, reduced = false) {
  const data = { ...fx.data, ...(reduced ? { still: 1 } : {}) };
  return Object.entries(data).map(([k, v]) => `data-${esc(k)}="${esc(v)}"`).join(' ');
}