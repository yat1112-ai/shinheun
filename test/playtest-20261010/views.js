// 화면 HTML 생성. 엔진 상태는 읽기만 하고, 상호작용은 data-action 으로 app.js 의 핸들러에 맡긴다.
import { CHARACTERS, STAGES, SKILLS, ENEMIES, EQUIPMENT, GAME_CONFIG, PRODUCTION } from './data.js';
import { calculateStats } from './engine.js';
import { MAX_SIDE, VILLAGE, FORMATIONS, placeSide, formationLabel, actionTimeline, skillTip, cooldownLeft, hpPercent, statusChips, allySkillState } from './ui-layout.js';

export const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const names = { gold:'금화', herbs:'약초', ore:'광석' };
const slots = {weapon:'무기', armor:'방어구', gloves:'장갑', boots:'신발'};
const roles = {healer:'회복', striker:'검사', rogue:'쌍검', guardian:'수호'};
export const effects = {regen:'지속 회복', defenseDown:'방어 감소', atkUp:'공격 증가', physicalVulnerability:'물리 표식', taunt:'도발', physicalDamageReduction:'물리 피해 감소', shield:'보호막'};
// HUD 상태 칩은 폭이 좁아 짧은 이름을 쓰고, 전체 이름은 title 로 둔다.
const shortEffects = {regen:'재생', defenseDown:'방어↓', atkUp:'공격↑', physicalVulnerability:'표식', taunt:'도발', physicalDamageReduction:'피해↓', shield:'보호막'};
// GP-04: 기존 프로젝트 원본 초상은 미리보기 후보이며 최종 사용자 승인 대기. 필드 임시 SVG는 유지한다.
// 도트/SD 전투 스프라이트 원본은 아직 없어 같은 슬롯·크기로 교체할 수 있게 경로만 분리해 둔다.
const PORTRAIT = { eir:'assets/art-preview-eir.webp', aren:'assets/art-preview-aren.webp', riana:'assets/art-preview-riana.webp', clea:'assets/art-preview-clea.webp' };
const SPRITE = { eir:'assets/sprite-eir.svg', aren:'assets/sprite-aren.svg', riana:'assets/sprite-riana.svg', clea:'assets/sprite-clea.svg' };
const ENEMY_ART = { stray:'assets/stray.svg', wolf:'assets/wolf.svg', boar:'assets/boar.svg', ragingBoar:'assets/boar.svg' };
export const stage = id => STAGES.find(s => s.id === Number(id));
export const rewardText = r => Object.keys(names).map(k => `${names[k]} ${r[k] || 0}`).join(' · ');
export const button = (action, text, attrs = '') => `<button data-action="${action}" ${attrs}>${text}</button>`;
const art = (id, enemy = false, cls = '', sprite = false) => {
  const src = enemy ? ENEMY_ART[id] || ENEMY_ART.stray : (sprite ? SPRITE : PORTRAIT)[id] || '';
  if (!enemy && !sprite) return `<span class="portrait-frame ${cls}" data-portrait="${esc(id)}"><img class="art ally-art portrait-image" src="${src}" alt="${esc(CHARACTERS[id]?.name || '')} 임시 초상 · 원본 아트 미리보기" draggable="false"></span>`;
  return `<img class="art ${enemy ? 'enemy-art' : 'ally-art'} ${cls}" src="${src}" alt="" draggable="false">`;
};
const unitName = u => esc(CHARACTERS[u.characterId]?.name || ENEMIES[u.enemyId]?.name || '짐승');
const rewardLine = r => `금화 ${r.gold || 0} · 경험치 ${r.xp || 0}${(r.materials?.herbs || r.herbs) ? ` · 약초 ${r.materials?.herbs || r.herbs}` : ''}${(r.materials?.ore || r.ore) ? ` · 광석 ${r.materials?.ore || r.ore}` : ''}`;
const destinationOptions = s => s.clearedStages.map(id => `<option value="${id}">${id}. ${esc(stage(id).name)}</option>`).join('');
const totalXp = s => Object.values(s.accrual.pendingXp).reduce((a, b) => a + b, 0);
const slotPads = (side, slots) => ['back', 'front'].flatMap(row => slots[row].map(p => `<i class="slot-pad ${side} ${row}" aria-hidden="true" style="left:${p.x}px;top:${p.y}px"></i>`)).join('');
const box = r => `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`;
// 회중시계 회전은 매초 다시 그려도 끊기지 않게 현재 시각 기준 위상을 준다.
const spinPhase = () => `-${((Date.now() / 1000) % 22).toFixed(1)}s`;

function facility(key, name, tag) {
  return `<div class="spot future" aria-disabled="true" style="${box(VILLAGE.spots[key])}"><span class="plate"><b>${name}</b><small>${tag}</small></span></div>`;
}
function village(c) {
  const s = c.s, pending = s.accrual.pending, dispatchOpen = s.clearedStages.includes(10);
  const spots = VILLAGE.spots;
  const repeatLine = s.repeat ? `${esc(stage(s.repeat.stageId).name)} 반복 중` : s.resumeRepeatStage ? '이전 반복 재개 가능 (모험)' : '대기 중';
  const dispatchLine = !dispatchOpen ? '1챕터 클리어 후 개방' : s.dispatch ? `${Math.floor(s.dispatch.progressSeconds)}/${s.dispatch.durationSeconds}초` : '대기 중';
  return `<div class="village-scene"><img class="hub-bg" src="assets/final-hub-bg.webp" alt="" draggable="false">
<article class="panel claim-card" style="${box(VILLAGE.claimCard)}" title="${esc(PRODUCTION.map(p => `${p.name} ${p.intervalSeconds / 60}분`).join(' · '))}"><h3>마을의 하루</h3><ul class="plain"><li>금화 ${pending.gold || 0}</li><li>약초 ${pending.herbs || 0}</li><li>광석 ${pending.ore || 0}</li><li>경험치 ${totalXp(s)}</li></ul>${button('claim','일괄 수령')}</article>
<article class="panel status-card" style="${box(VILLAGE.statusCard)}"><h3>진행 현황</h3><p><b>온라인 반복</b><span class="line" title="${repeatLine}">${repeatLine}</span></p><p><b>파견</b><span class="line" title="${dispatchLine}">${dispatchLine}</span></p></article>
${facility('church', '성당', '준비 중')}${facility('market', '시장', '준비 중')}${facility('mine', '광산', '준비 중')}${facility('raid', '레이드', '준비 중')}
<button class="spot ${dispatchOpen ? 'available' : 'future'}" data-action="view" data-id="dispatch" ${dispatchOpen ? '' : 'disabled'} style="${box(spots.dispatch)}"><span class="plate"><b>파견소</b><small>${dispatchOpen ? (s.dispatch ? '파견 진행 중' : '파견 슬롯 1') : '1챕터 클리어 후'}</small></span></button>
<button class="spot clock-spot available" data-action="view" data-id="adventure" aria-label="모험 회중시계: 스테이지 선택" style="${box(spots.clock)}"><img class="clock-base" src="assets/final-clock-base.webp" alt="" draggable="false"><img class="clock-rotor" src="assets/final-clock-rotor.webp" alt="" draggable="false" style="animation-delay:${spinPhase()}"><span class="plate"><b>모험 회중시계</b><small>${s.battle ? '진행 중인 전투가 있습니다' : '스테이지 선택'}</small></span></button></div>`;
}
function dispatchView(c) {
  const s = c.s;
  if (!s.clearedStages.includes(10)) return `<div class="panel-view"><article class="panel"><h2>파견소</h2><p>1챕터를 클리어하면 파견 슬롯이 열립니다.</p></article></div>`;
  const d = s.dispatch;
  return `<div class="panel-view"><h2>오프라인 파견 · 1슬롯</h2><article class="panel">${d ? `<p>${esc(stage(d.stageId).name)} · ${d.members.map(id => esc(CHARACTERS[id].name)).join(', ')} · ${Math.floor(d.progressSeconds)}/${d.durationSeconds}초</p><progress max="${d.durationSeconds}" value="${d.progressSeconds}"></progress>${button('stop-dispatch','파견 종료')}` : `<select id="dispatch-stage" aria-label="파견 목적지">${destinationOptions(s)}</select><div class="actions">${s.recruited.map(id => `<label><input type="checkbox" name="dispatch-member" value="${id}" checked>${esc(CHARACTERS[id].name)}</label>`).join('')}</div>${button('dispatch','파견 시작')}`}<small>전투 동료 중복 등록 가능 · 직접 전투 보상의 약 50% · 도감 증가 없음 · 전투력으로 시간 산정</small></article></div>`;
}
function repeatBar(s) {
  const resume = s.resumeRepeatStage && !s.repeat ? `<div class="actions"><span>이전 ${esc(stage(s.resumeRepeatStage).name)} 반복을 재개할까요?</span>${button('resume','반복 재개')}${button('dismiss-resume','나중에')}</div>` : '';
  const control = s.repeat ? `<span>${esc(stage(s.repeat.stageId).name)} 반복 중</span>${button('stop-repeat','반복 종료')}` : `<label>온라인 반복 <select id="repeat-stage" aria-label="반복 목적지" ${s.clearedStages.length ? '' : 'disabled'}>${destinationOptions(s)}</select></label>${button('repeat','반복 시작', s.clearedStages.length && !s.battle ? '' : 'disabled')}`;
  return `<div class="panel repeat-bar"><div class="actions">${control}</div>${resume}</div>`;
}
function adventure(c) {
  const s = c.s;
  return `<div class="panel-view stage-board"><div class="section-title"><div><small>CHAPTER 01</small><h2>어머니를 찾아 숲으로</h2></div><p>${s.clearedStages.length} / 10 완료</p></div>${repeatBar(s)}<div class="stage-grid">${STAGES.map(st => {
    const clear = s.clearedStages.includes(st.id), locked = st.unlockAfterStage && !s.clearedStages.includes(st.unlockAfterStage);
    return `<article class="stage panel ${clear ? 'cleared' : ''} ${locked ? 'locked' : ''}"><small>STAGE ${String(st.id).padStart(2,'0')} · ${clear ? '완료' : locked ? '앞 단계 완료 필요' : '모험 가능'}</small><h3>${esc(st.name)}</h3><p>${st.waves.length}웨이브 · 금화 ${st.rewards.gold} · 경험치 ${st.rewards.xp}</p>${button('stage', clear ? '재도전' : '입장', `data-id="${st.id}" ${locked || s.battle || s.repeat ? 'disabled' : ''}`)}</article>`;
  }).join('')}</div></div>`;
}
function characters(c) {
  const s = c.s;
  return `<div class="panel-view"><h2>함께 걷는 동료</h2><p class="lead">레벨은 승리·파견 경험치로 성장합니다. 회중시계 가호: 체력 +${GAME_CONFIG.watchBlessing.hp}, 공격 +${GAME_CONFIG.watchBlessing.atk} · 도감 공격 +${s.codex.sharedAtk} · 전투 중 장비 변경은 다음 전투부터 반영됩니다.</p><div class="character-grid">${s.recruited.map(id => {
    const ch = s.characters[id], stats = calculateStats(s, id), def = CHARACTERS[id];
    return `<article class="panel character">${art(id, false, 'card-art')}<div class="character-body"><h3>${esc(def.name)} <small>${roles[def.role]} · Lv.${ch.level}</small></h3><p>경험치 ${ch.xp} / ${50 + (ch.level - 1) * 25} · 출전 ${s.codex.appearances[id] || 0}회<br>체력 ${stats.hp} · 공격 ${stats.atk} · 방어 ${stats.defense} · 속도 ${stats.speed}</p>${button('party', s.party.includes(id) ? '편성 해제' : '편성 추가', `data-id="${id}" ${s.battle ? 'disabled' : ''}`)}<div class="equip-grid">${Object.entries(slots).map(([slot, label]) => `<label class="equipment-label">${label}<select data-character="${id}" data-slot="${slot}" aria-label="${esc(def.name)} ${label}"><option value="">없음</option>${s.inventory.filter(item => EQUIPMENT[item].slot === slot).map(item => `<option value="${item}" ${ch.equipment[slot] === item ? 'selected' : ''}>${esc(EQUIPMENT[item].name)}</option>`).join('')}</select></label>`).join('')}</div><small>${def.skills.map(k => esc(SKILLS[k].name)).join(' · ')} / ${esc(SKILLS[def.passive].name)}</small></div></article>`;
  }).join('')}</div></div>`;
}
function inventory(c) {
  const s = c.s;
  return `<div class="panel-view"><h2>가방과 마을 장비</h2><p class="lead">장비 수치는 테스트용 초안입니다. 보유 장비는 동료 화면에서 착용하세요.</p><div class="stage-grid">${Object.values(EQUIPMENT).map(e => `<article class="panel"><small>${slots[e.slot]}</small><h3>${esc(e.name)}</h3><p>${Object.entries(e.stats).map(([k, v]) => `${({hp:'체력',atk:'공격',defense:'방어',speed:'속도'})[k]} +${v}`).join(' · ')}</p>${button('buy', s.inventory.includes(e.id) ? '보유 중' : `${e.price} 금화 · 구매`, `data-id="${e.id}" ${s.inventory.includes(e.id) || s.resources.gold < e.price ? 'disabled' : ''}`)}</article>`).join('')}</div></div>`;
}
function codex(c) {
  const s = c.s;
  return `<div class="panel-view"><h2>숲의 기록</h2><p class="lead">실제 전투 최종 승리에서만 처치·출전을 기록합니다. 종류별 100처치 보상: 공통 공격 +1.</p><div class="stage-grid">${Object.values(ENEMIES).map(e => { const n = s.codex.kills[e.id] || 0, claimed = s.codex.claimed.includes(e.id); return `<article class="panel codex-entry">${art(e.id, true, 'codex-art')}<h3>${esc(e.name)}</h3><p>${n} / 100 처치</p><progress max="100" value="${Math.min(n, 100)}"></progress>${button('codex', claimed ? '수령 완료' : '공격 +1 수령', `data-id="${e.id}" ${claimed || n < 100 ? 'disabled' : ''}`)}</article>`; }).join('')}</div></div>`;
}

// HP 구간: 위험(25% 이하)·경고(50% 이하)를 색과 맥동으로 구분한다.
const hpTier = u => u.hp <= 0 ? 'down' : hpPercent(u) <= 25 ? 'crit' : hpPercent(u) <= 50 ? 'warn' : 'ok';
// 머리 위 상태 배지: 첫 상태 1개와 나머지 개수만 보여 캐릭터를 가리지 않는다.
function tagBadge(u) {
  const all = statusChips(u, effects), raw = u.effects || [];
  if (!all.length) return '';
  return `<u class="tag-badge" title="${esc(all.map(e => `${e.label} ${e.remaining}턴`).join(', '))}">${esc(shortEffects[raw[0]?.type] || all[0].label)}${all.length > 1 ? `<b>+${all.length - 1}</b>` : ''}</u>`;
}
function unitMarkup(p) {
  const u = p.unit, enemy = u.side === 'enemy', id = u.characterId || u.enemyId;
  return `<div class="unit ${u.side} ${p.row} ${u.hp <= 0 ? 'fallen' : ''}" data-unit="${esc(u.id)}" style="left:${p.x}px;top:${p.y}px;z-index:${p.z};--s:${p.scale ?? 1}"><div class="tag ${hpTier(u)}"><span>${unitName(u)}</span><i class="bar" role="img" aria-label="체력 ${Math.max(0,u.hp)} / ${u.maxHp}"><b style="width:${hpPercent(u)}%"></b></i><em class="tag-hp">${Math.max(0,u.hp)}<small>/${u.maxHp}</small></em>${u.hp <= 0 ? '' : tagBadge(u)}</div><div class="sprite">${art(id, enemy, '', true)}</div><i class="shadow"></i></div>`;
}
function hudCard(u, c) {
  const def = CHARACTERS[u.characterId], lv = c.s.characters[u.characterId]?.level ?? 1;
  const all = statusChips(u, effects), raw = u.effects || [];
  const shown = all.slice(0, 2).map((e, i) => `<span class="chip" title="${esc(e.label)} ${e.remaining}턴">${esc(shortEffects[raw[i]?.type] || e.label)} <b>${e.remaining}턴</b></span>`).join('');
  const more = all.length > 2 ? `<span class="chip more" title="${esc(all.slice(2).map(e => `${e.label} ${e.remaining}턴`).join(', '))}">+${all.length - 2}</span>` : '';
  const selected = c.selected === u.id;
  const skillIcons = { eirHeal:'prayer', eirGroupHeal:'heal', eirRevive:'revive', arenBreak:'heavy', arenBuff:'buff', rianaFlurry:'dual', rianaMark:'mark', cleaTaunt:'ward', cleaShield:'fortress', rianaBasic:'cleave' };
  return `<article class="hud-card ${u.hp <= 0 ? 'fallen' : ''} ${selected ? 'selected' : ''}" data-card="${esc(u.id)}">
    <div class="hud-top"><button class="hud-portrait" data-action="inspect" data-id="${esc(u.id)}" aria-label="${esc(def.name)} 스킬 보기 · 임시 초상 · 최종 승인 대기" aria-pressed="${selected}" title="${esc(def.name)} 상세 보기 · 원본 아트 미리보기 · 최종 승인 대기">${art(u.characterId, false, 'hud-art')}<small class="portrait-note">아트 미리보기</small></button>
    <div class="hud-main"><strong>${esc(def.name)}</strong><span class="lv">Lv.${lv} · ${esc(roles[def.role])}</span><div class="hp ${hpTier(u)}" role="img" aria-label="체력 ${Math.max(0,u.hp)} / ${u.maxHp}"><i style="width:${hpPercent(u)}%"></i><span>${Math.max(0,u.hp)} / ${u.maxHp}</span></div><small class="hud-mode">${u.hp <= 0 ? '전투 불가' : selected ? '선택됨 · 상세 표시' : '자동 스킬 · 표시용'}</small></div></div>
    <div class="skills">${def.skills.map(k => { const sk = SKILLS[k], state = allySkillState(u, k), tip = `${skillTip(sk)} · 자동 발동 · 표시용`, tipId = `tip-${u.id}-${k}`; return `<span class="skill ${state.state}" tabindex="0" aria-label="${esc(sk.name)} · ${state.label} · 자동 스킬 표시용" aria-describedby="${esc(tipId)}"><span class="skill-bezel"><img class="skill-icon" src="assets/skill-${skillIcons[k] || 'cleave'}.svg" alt="" draggable="false"></span><span class="skill-copy"><em>${esc(sk.name)}</em><b>${state.label}</b></span><span class="skill-tip" role="tooltip" id="${esc(tipId)}">${esc(tip)}</span></span>`; }).join('')}</div>
    <div class="status">${shown || '<span class="chip none">상태 없음</span>'}${more}</div></article>`;
}
function resultPanel(b, c) {
  const st = stage(b.stageId), win = b.status === 'victory';
  const receipt = b.result;
  const first = win && (receipt ? receipt.firstClear : !c.clearedBefore)
    ? `<p>첫 클리어 보상: ${esc(rewardLine(receipt?.firstClearRewards || st.firstClearRewards || {}))}</p>` : '';
  const paid = receipt ? { ...receipt.rewards, xp: receipt.xp } : st.rewards;
  const members = receipt?.members.map(id => esc(CHARACTERS[id]?.name || id)).join(', ');
  const onward = win && st.id < STAGES.length
    ? button('next-stage','다음 스테이지', `data-id="${st.id + 1}"`)
    : button('view', win ? '챕터 완료' : '스테이지 선택', `data-id="${win ? 'village' : 'adventure'}"`);
  return `<div class="result ${win ? 'win' : 'lose'}" role="group" aria-label="전투 결과" data-battle-id="${b.id}"><img class="result-ornament" src="assets/ornament-divider.svg" alt=""><h2>${win ? '승리' : '패배'}</h2>
    <p class="stage-name">${esc(st.name)}</p>
    ${win ? `<p class="reward">보상: ${esc(rewardLine(paid))}</p>${first}${members ? `<p>경험치 지급: ${members} · 각 ${receipt.xp}</p>` : ''}<p class="paid">보상 지급 완료</p>` : '<p>획득 보상 없음 · 경험치 0</p><p>동료와 장비를 정비해 다시 도전하세요.</p>'}
    <div class="actions">${button('stage','재도전', `data-id="${st.id}"`)}${button('view','마을로','data-id="village"')}${onward}</div></div>`;
}
function battle(c) {
  const b = c.s.battle || c.lastBattle;
  if (!b) return `<div class="panel-view"><article class="panel"><h2>모험을 시작해 보세요.</h2><p>회중시계에서 스테이지를 고르면 자동 전투가 시작됩니다.</p>${button('view','스테이지 선택','data-id="adventure"')}</article></div>`;
  const allies = placeSide(b.allies, 'ally', u => CHARACTERS[u.characterId]?.role, b.formation), foes = placeSide(b.enemies, 'enemy', null, b.enemyFormation);
  const form = formationLabel(FORMATIONS[allies.formation].front, FORMATIONS[allies.formation].back), selected = b.allies.find(u => u.id === c.selected);
  const order = actionTimeline(b, 9);
  const sumHp = units => ({ current:units.reduce((v,u)=>v+Math.max(0,u.hp),0), maximum:units.reduce((v,u)=>v+u.maxHp,0) });
  const allyHp=sumHp(b.allies), enemyHp=sumHp(b.enemies);
  const percent=hp=>hp.maximum ? Math.round(hp.current*100/hp.maximum):0;

  const detail = selected ? (() => { const def = CHARACTERS[selected.characterId]; return `${esc(def.name)} — ${[...def.skills, def.passive].map(k => esc(skillTip(SKILLS[k]) || SKILLS[k]?.name || k)).join(' / ')}`; })() : esc(c.log.slice(-2).join('  ›  ') || '자동 전투 대기 중');
  return `<div class="battle">
<div class="ground" aria-label="전투 지면">
<div class="team-hp-vs" aria-label="아군 대 적군 총 체력">
  <div class="team-hp ally-side"><span>아군 HP</span><div class="track"><i style="width:${percent(allyHp)}%"></i></div><b>${allyHp.current} / ${allyHp.maximum}</b></div>
  <strong class="vs-seal">VS</strong>
  <div class="team-hp enemy-side"><b>${enemyHp.current} / ${enemyHp.maximum}</b><div class="track"><i style="width:${percent(enemyHp)}%"></i></div><span>적군 HP</span></div>
</div>
<aside class="order" aria-label="행동 순서"><h4>행동 순서</h4><ol>${order.map(({unit:u,roundOffset}, i) => `<li class="${u.side} ${i === 0 ? 'next' : ''} ${roundOffset ? 'future' : ''}" data-order-unit="${esc(u.id)}" data-round-offset="${roundOffset}" aria-current="${i === 0 ? 'step' : 'false'}" title="${unitName(u)} · ${roundOffset ? '다음 라운드 예상' : '이번 라운드'}">${art(u.characterId || u.enemyId, u.side === 'enemy', 'mini')}<span>${unitName(u)}</span>${roundOffset && (i===0 || order[i-1].roundOffset !== roundOffset) ? '<small>다음</small>' : ''}</li>`).join('')}</ol></aside>
${slotPads('ally', allies.slots)}${slotPads('enemy', foes.slots)}${allies.placed.map(unitMarkup).join('')}${foes.placed.map(unitMarkup).join('')}
<div class="pet-preview" data-pet-state="demo" role="img" aria-label="펫 슬롯 (준비 중), 펫 시연용 도트 캐릭터, 현재 미장착">
  <span class="pet-preview-name">펫 · 시연</span>
  <img class="pet-preview-art" src="./assets/pet-fox-demo.png" alt="" draggable="false">
  <i class="pet-preview-shadow" aria-hidden="true"></i>
  <span class="pet-preview-state">미장착 · DEMO</span>
</div><div class="ticker" role="status">${detail}</div>
<aside class="rail"><div class="formation" aria-label="진형"><h4>진형</h4><b class="letter">${form.letter || '-'}</b><span>${form.text}</span><small>${form.letter ? '' : '5인 편성 시 A~D'}</small></div>
</aside></div>
<div class="hud" aria-label="아군 5인 상태">${b.allies.map(u => hudCard(u, c)).join('')}${'<div class="hud-card empty" aria-label="빈 자리"><img class="empty-seal" src="assets/icon-state.svg" alt=""><span>빈 자리</span><small>출전 동료 없음</small></div>'.repeat(Math.max(0, MAX_SIDE - b.allies.length))}</div>
${b.status !== 'active' && c.resultOpen ? resultPanel(b, c) : ''}</div>`;
}

export function topInfo(view, c) {
  if (view !== 'battle') return `<div class="brand"><small>신흔 · CHAPTER 01</small><h1>${({village:'돌아가는 길',adventure:'모험',characters:'동료',inventory:'가방',codex:'도감',dispatch:'파견소'})[view] || '돌아가는 길'}</h1></div>`;
  const b = c.s.battle || c.lastBattle;
  if (!b) return `<div class="brand"><h1>전투</h1></div>`;
  const st = stage(b.stageId), mode = c.s.repeat ? '반복' : '모험';
  return `<div class="battle-info"><span class="info-chip stage-title"><small>${mode} · STAGE ${String(st.id).padStart(2, '0')}</small><strong>${esc(st.name)}</strong></span><span class="info-chip turn">현재 턴 <b>라운드 ${b.round}</b></span><span class="info-chip wave">웨이브 <b>${b.waveIndex + 1}/${b.waves.length}</b></span><div class="speed" role="group" aria-label="전투 배속">${[1, 2, 4].map(n => button('speed', `${n}×`, `data-id="${n}" aria-pressed="${c.speed === n}"`)).join('')}</div>${button('view','마을','data-id="village"')}${c.s.repeat ? button('stop-repeat','반복 종료') : ''}</div>`;
}
const VIEWS = { village, adventure, characters, inventory, codex, dispatch: dispatchView, battle };
export const hasView = name => Object.hasOwn(VIEWS, name);
export const renderView = (name, c) => VIEWS[name](c);
