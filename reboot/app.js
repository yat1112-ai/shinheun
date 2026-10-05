import { createGameEngine, calculateStats } from './engine.js';
import { CHARACTERS, STORY_CHARACTERS, STAGES, SKILLS, ENEMIES, EQUIPMENT, GAME_CONFIG, PRODUCTION } from './data.js';

import { createCloud } from './cloud.js';
import { localKey, decideLogin, syncSignature, hasUnsyncedChange } from './cloud-core.js';

let engine = createGameEngine();
const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = { gold:'금화', herbs:'약초', ore:'광석' };
const slots = {weapon:'무기', armor:'방어구', gloves:'장갑', boots:'신발'};
const roles = {healer:'회복', striker:'검사', rogue:'쌍검', guardian:'수호'};
const effects = {regen:'지속 회복', defenseDown:'방어 감소', atkUp:'공격 증가', physicalVulnerability:'물리 표식', taunt:'도발', physicalDamageReduction:'물리 피해 감소', shield:'보호막'};
let view = 'village', lastBattle = null, storyLines = [], storyIndex = 0, afterStory = null, suspended = document.hidden;
let log = [], lastSeenAction = '', noticeTimer, storageBlocked = false;
const state = () => engine.state;
const stage = id => STAGES.find(s => s.id === Number(id));
const rewardText = r => Object.keys(names).map(k => `${names[k]} ${r[k] || 0}`).join(' · ');
const button = (action, text, attrs = '') => `<button data-action="${action}" ${attrs}>${text}</button>`;
function notify(text) { $('#notice').textContent = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('#notice').textContent = '', 6000); }
// The global is a test seam only (tests/cloud.test.js injects a mock-SDK adapter); production never sets it.
const cloud = globalThis.__SHINHEUN_CLOUD__ ?? createCloud();
// Unsynced progress whose durable save failed during an account switch or logout. Memory only, one record per
// namespace, restored only when that same account/guest is active again and never offered to any other.
const recovery = new Map();
// Original storage values that could not be backed up before being overwritten; account-isolated, memory only.
const originals = new Map();
const recoveryKey = account => account === null ? 'guest' : `uid:${account}`;
let uid = null, epoch = 0, revision = 0, phase = 'guest', initialized = true;
let writing = false, resolving = false, dirty = false, cachedJson = null, guestJson = null;
let seenRevision = null, pendingPush = false, saveSeq = 0, syncedSig = null, inflightSig = null;
const signature = syncSignature;
const scopedStorage = (account = uid) => ({
  getItem: () => localStorage.getItem(localKey(account)),
  setItem: (_key, json) => localStorage.setItem(localKey(account), json),
});
const playable = () => initialized && !['loading', 'conflict', 'import'].includes(phase);
function syncUI() {
  $('#cloud-status').textContent = ({guest:'로컬 · 게스트', loading:'클라우드 확인 중', ready: dirty ? '로컬 저장 · 동기화 대기' : '클라우드 연결', writing:'클라우드 저장 중', error:'오류 · 로컬 백업 보존', conflict:'충돌 · 복구 선택 필요', import:'빈 계정 · 가져오기 선택'})[phase];
  $('#login').hidden = uid !== null;
  $('#logout').hidden = uid === null;
  $('#retry').hidden = phase !== 'error';
  $('#resolve').hidden = phase !== 'conflict';
  // The menu is inert while loading/error/conflict, so the backup dialog (recovery export) needs its own entry point.
  $('#recover').hidden = playable();
  $('#content').inert = !playable();
  $('#nav').inert = !playable();
}
function localSave(markDirty = true) {
  if (storageBlocked || !initialized) return false;
  if (uid !== null) {
    // Meta first: a failed JSON write after this leaves dirty=true, never a stale clean flag over newer local progress.
    const nextDirty = markDirty || dirty;
    try { localStorage.setItem(localKey(uid, 'meta'), JSON.stringify({ revision, dirty: nextDirty })); }
    catch { notify('동기화 정보 저장 실패. JSON 백업을 다운로드하세요.'); return false; }
    if (markDirty) { dirty = true; saveSeq++; }
  }
  return engine.save(scopedStorage());
}
function persist(quiet = false) {
  if (!playable()) return false;
  if (storageBlocked) { if (!quiet) notify('손상된 기존 저장을 보존 중입니다. JSON 백업으로 복구하세요.'); return false; }
  // Same progress as the last pulled/pushed cloud state: refresh the local cache only, no dirty flag, no revision write.
  const sig = uid !== null ? signature(engine.exportSave()) : null;
  const unchanged = uid !== null && ((!dirty && syncedSig !== null && sig === syncedSig) || (writing && inflightSig !== null && sig === inflightSig));
  if (!localSave(!unchanged)) { notify('로컬 저장 실패. JSON 백업을 다운로드하세요.'); return false; }
  if (!quiet) notify('현재 진행을 로컬에 저장했습니다.');
  syncUI();
  if (unchanged) return true;
  if (uid !== null && phase === 'ready') void pushCloud();
  else if (uid !== null && phase === 'writing') pendingPush = true;
  return true;
}
async function pushCloud() {
  if (writing || uid === null || !initialized || storageBlocked) return;
  const token = epoch, account = uid, json = engine.exportSave(), seq = saveSeq;
  writing = true; phase = 'writing'; inflightSig = signature(json); syncUI();
  const result = await cloud.write({ expectedRevision:revision, engineJson:json, device:{id:'browser',label:'웹 브라우저'}, now:Date.now() });
  if (token !== epoch || account !== uid) return;
  writing = false; inflightSig = null;
  if (result.ok) {
    revision = result.revision; dirty = saveSeq !== seq; phase = 'ready'; syncedSig = signature(json);
    try { localStorage.setItem(localKey(uid, 'meta'), JSON.stringify({revision, dirty})); }
    catch { dirty = true; phase = 'error'; }
  } else {
    phase = result.kind === 'conflict' ? 'conflict' : 'error'; pendingPush = false;
    if (phase === 'conflict') seenRevision = result.remoteRevision ?? null;
    notify('클라우드 저장 실패. 로컬 진행은 보존됩니다.');
  }
  syncUI();
  if (phase === 'conflict') openChoice('conflict');
  else if (phase === 'ready' && pendingPush) { pendingPush = false; void pushCloud(); }
}
function openChoice(kind) {
  $('#sync-title').textContent = kind === 'import' ? '빈 계정에 게스트 진행을 가져올까요?' : '서버와 로컬 진행이 다릅니다';
  $('#sync-description').textContent = kind === 'import' ? '게스트 저장과 백업은 그대로 보존됩니다.' : '원격을 불러오면 현재 로컬 진행을 별도 백업으로 보존합니다. 로컬 유지·재시도는 서버 진행을 교체하며, 교체 전 서버 진행을 별도 백업으로 보존합니다. 지금 보고 있는 서버 리비전과 다르면 덮어쓰지 않고 다시 선택하게 합니다.';
  $('#sync-choices').innerHTML = kind === 'import' ? button('guest-import','게스트 가져오기') + button('fresh-account','새로 시작') : button('remote-load','원격 불러오기') + button('local-retry','로컬 유지·재시도');
  if (!$('#sync-dialog').open) $('#sync-dialog').showModal();
}
function resetView() {
  lastBattle = null; log = []; lastSeenAction = ''; firstClearBattle = null;
  finishedStoryBattles.clear(); afterStory = null; storyLines = [];
  $('#story').close(); $('#backup').close(); $('#backup-text').value = '';
  view = 'village'; render(); syncUI();
}
// Keep the two most recent distinct preserved originals so a second preservation never erases the first.
function preserve(json, account = uid) {
  if (!json) return;
  const current = localStorage.getItem(localKey(account, 'backup'));
  if (current === json) return;
  if (current) localStorage.setItem(localKey(account, 'backup-prev'), current);
  localStorage.setItem(localKey(account, 'backup'), json);
}
async function initializeAccount() {
  const token = epoch, account = uid;
  phase = 'loading'; initialized = false; syncUI();
  const result = await cloud.read(Date.now());
  if (token !== epoch || account !== uid) return;
  if (!result.ok) { phase = 'error'; syncUI(); notify(recovery.has(recoveryKey(uid)) ? '서버를 확인하지 못했습니다. 저장·백업 → 보존한 원본 보기로 진행을 먼저 내보낸 뒤 재시도하세요.' : '서버를 확인하지 못했습니다. 재시도하거나 로그아웃하세요.'); return; }
  try {
    // A recovery record is newer than any stored cache of this account: it holds progress that never reached storage.
    const rec = recovery.get(recoveryKey(uid));
    const local = rec ? rec.json : localStorage.getItem(localKey(uid));
    cachedJson = local;
    const meta = rec ? { revision: rec.revision, dirty: true } : JSON.parse(localStorage.getItem(localKey(uid, 'meta')) || 'null');
    const decision = decideLogin({ uid, remoteRaw: result.empty ? null : result.envelope, guestJson, now: Date.now(),
      accountLocal: local ? { engineJson: local, baseRevision: meta?.revision, dirty: meta ? meta.dirty !== false : true } : null });
    revision = result.revision;
    if (decision.preserveLocal) preserve(decision.preserveLocal);
    if (decision.action === 'conflict') { seenRevision = result.revision; phase = 'conflict'; openChoice('conflict'); syncUI(); return; }
    if (decision.action === 'prompt-import') { phase = 'import'; openChoice('import'); syncUI(); return; }
    engine = createGameEngine();
    if (decision.action === 'push-local' || decision.action === 'keep-local') engine.importSave(local);
    else if (!result.empty) engine.importSave(result.envelope.engine);
    initialized = true; storageBlocked = false; phase = 'ready';
    // Freshly pulled server state (or a clean cache with the same progress) is already in sync; only local-ahead data (push-local) or a new account must upload.
    if (decision.action === 'load-remote' || decision.action === 'keep-local') { dirty = false; syncedSig = signature(engine.exportSave()); }
    resetView();
    const saved = persist(true);
    if (rec) {
      if (saved) { recovery.delete(recoveryKey(uid)); notify('저장 실패로 보관했던 진행을 복원했습니다. 저장 공간을 확인하고 JSON 백업을 받아 두세요.'); }
      else notify('복원한 진행을 아직 저장하지 못했습니다. JSON 백업을 다운로드하세요.');
    }
    resume();
  } catch { phase = cachedJson ? 'conflict' : 'error'; if (cachedJson) openChoice('conflict'); syncUI(); notify('계정 로컬 데이터 또는 저장 공간 오류. 원본은 보존됩니다.'); }
}
async function resolveChoice(action) {
  if (resolving) return;
  resolving = true;
  const token = epoch;
  try {
    if (action === 'guest-import' || action === 'fresh-account') {
      engine = createGameEngine();
      if (action === 'guest-import') engine.importSave(guestJson);
    } else {
      const local = initialized ? engine.exportSave() : cachedJson;
      const remote = await cloud.read(Date.now());
      if (token !== epoch) return;
      if (!remote.ok) { notify('서버 확인 실패. 선택을 유지하고 재시도하세요.'); return; }
      if (action === 'local-retry' && seenRevision !== null && remote.revision !== seenRevision) {
        seenRevision = remote.revision; revision = remote.revision;
        notify('그 사이 서버 진행이 바뀌었습니다. 덮어쓰지 않았습니다. 다시 선택하세요.'); return;
      }
      if (action === 'local-retry' && !remote.empty) preserve(remote.envelope.engine);
      if (action === 'remote-load') {
        preserve(local);
        const next = createGameEngine();
        if (!remote.empty) next.importSave(remote.envelope.engine);
        engine = next;
      } else if (!initialized) { const next = createGameEngine(); next.importSave(local); engine = next; }
      revision = remote.revision;
      if (action === 'remote-load') { dirty = false; syncedSig = signature(engine.exportSave()); }
      else syncedSig = null;
    }
    initialized = true; storageBlocked = false; phase = 'ready'; cachedJson = null;
    $('#sync-dialog').close(); resetView();
    const saved = persist(true);
    // Remote-load already preserved the local copy as a backup; otherwise the record stays until it is durably saved.
    if (action === 'remote-load' || saved) recovery.delete(recoveryKey(uid));
    resume();
  } catch { notify('복구 실패. 원본 데이터를 보존했습니다. JSON 백업을 확인하세요.'); }
  finally { if (token === epoch) resolving = false; }
}
cloud.onStatus(status => {
  if (status.uid === uid) return;
  // Only write the outgoing namespace locally; never push it through the new auth context.
  // A cache already in sync stays clean so the next login does not raise a false conflict.
  // Accrual since the last autosave (pending rewards, dispatch progress) changes the signature, so it must be marked dirty here or the next login would replace it with the server copy.
  // A damaged-save guard blocks durable writes but play continues in memory, so that progress needs the recovery record too.
  if (initialized) {
    const unsynced = uid !== null && hasUnsyncedChange({ dirty, writing, syncedSig, engineJson: engine.exportSave() });
    if (localSave(unsynced)) recovery.delete(recoveryKey(uid));
    else if (uid === null || unsynced) {
      // Durable storage failed: the engine is about to be replaced, so this memory copy may be the only one. Keep it for this namespace only.
      recovery.set(recoveryKey(uid), { json: engine.exportSave(), revision });
      notify('저장소 오류로 현재 진행을 메모리에만 보관했습니다. 같은 계정(게스트)으로 다시 들어오면 복원·재시도합니다. 탭을 닫기 전에 복구하세요.');
    }
  }
  if (uid === null) {
    try { guestJson = recovery.get(recoveryKey(null))?.json ?? localStorage.getItem(localKey(null)); } catch { guestJson = null; }
    // A failed backup write must not drop the guest JSON that the import prompt still needs.
    try { preserve(guestJson, null); } catch { notify('게스트 백업 저장에 실패했습니다. 가져오기용 진행은 메모리에 유지합니다.'); }
  }
  uid = status.uid; epoch++; writing = false; resolving = false; dirty = false; revision = 0; cachedJson = null; seenRevision = null; pendingPush = false; syncedSig = null; inflightSig = null;
  $('#sync-dialog').close();
  engine = createGameEngine(); storageBlocked = false; initialized = false;
  if (uid !== null) { resetView(); void initializeAccount(); }
  else { initialized = true; phase = 'guest'; const loaded = engine.load(scopedStorage(null)); storageBlocked = !loaded.ok;
    const rec = recovery.get(recoveryKey(null));
    if (rec) {
      try {
        const stored = localStorage.getItem(localKey(null));
        // The primary key is about to be overwritten: preserve the original first, and keep it in memory if that backup fails.
        let kept = true;
        try { preserve(stored, null); } catch { kept = false; }
        if (!kept && stored && stored !== rec.json) originals.set(recoveryKey(null), stored);
        engine.importSave(rec.json); storageBlocked = false;
        if (engine.save(scopedStorage(null))) {
          recovery.delete(recoveryKey(null));
          notify(kept ? '저장 실패로 보관했던 게스트 진행을 복원했습니다. JSON 백업을 받아 두세요.' : '게스트 진행을 복원했지만 기존 저장본을 백업하지 못했습니다. 저장·백업 → 보존한 원본 보기로 원본을 내보내세요.');
        }
        else notify('복원한 게스트 진행을 아직 저장하지 못했습니다. JSON 백업을 다운로드하세요.');
      } catch { notify('게스트 복구 기록을 복원하지 못했습니다. 메모리 기록은 유지됩니다.'); }
    }
    resetView(); }
});
async function authAction(action) {
  if (action === 'retry') { if (!initialized) await initializeAccount(); else { if (localSave()) await pushCloud(); } return; }
  if (action === 'resolve') { openChoice('conflict'); return; }
  // A redirect/popup fallback reloads the page: never start it while the only copy of the guest progress is in memory.
  if (action === 'login' && !persist(true)) {
    notify('로컬 저장에 실패해 로그인을 중단했습니다. 저장·백업에서 JSON을 내보낸 뒤 저장 공간을 확인하고 다시 시도하세요.');
    return;
  }
  const result = await (action === 'login' ? cloud.signIn() : cloud.signOut());
  if (!result.ok) notify('인증 실패. 로그인 또는 로그아웃을 다시 시도하세요.');
}
function showStory(lines, done) {
  if (!lines?.length) { done?.(); return; }
  storyLines = lines; storyIndex = 0; afterStory = done; drawStory(); $('#story').showModal();
}
function drawStory() { const line = storyLines[storyIndex]; $('#story-content').innerHTML = `<small>돌아가는 길 · 이야기 ${storyIndex + 1}/${storyLines.length}</small><h2>${esc(CHARACTERS[line.speaker]?.name || STORY_CHARACTERS[line.speaker]?.name || line.speaker)}</h2><p>${esc(line.text)}</p>`; $('#story-next').textContent = storyIndex === storyLines.length - 1 ? '계속하기' : '다음'; }
function nextStory() { if (++storyIndex < storyLines.length) drawStory(); else { $('#story').close(); const done = afterStory; afterStory = null; done?.(); } }
$('#story-next').addEventListener('click', nextStory);
$('#story').addEventListener('cancel', event => event.preventDefault());
function startManual(id) {
  if (state().battle || state().repeat) throw new Error('진행 중인 전투가 있습니다. 반복을 먼저 종료하세요.');
  const s = stage(id);
  if (s.unlockAfterStage && !state().clearedStages.includes(s.unlockAfterStage)) throw new Error('앞 스테이지를 먼저 완료하세요.');
  const start = () => { engine.startBattle(s.id); lastBattle = null; log = []; view = 'battle'; persist(true); render(); };
  showStory(state().enteredStages.includes(s.id) ? [] : s.story, start);
}
function avatar(id, enemy = false) { return `<div class="avatar ${enemy ? 'beast' : esc(id)}" aria-hidden="true"><i class="head"></i><i class="body"></i><i class="weapon"></i><i class="aura"></i></div>`; }
function unitCard(u) { const id = u.characterId || u.enemyId; return `<div class="fighter ${u.hp <= 0 ? 'fallen' : ''}" data-unit="${esc(u.id)}">${avatar(id, u.side === 'enemy')}<strong>${esc(CHARACTERS[id]?.name || ENEMIES[id]?.name)}</strong><progress max="${u.maxHp}" value="${u.hp}" aria-label="체력"></progress><small>${u.hp} / ${u.maxHp}</small><small>${u.effects.map(e => esc(effects[e.type] || e.type)).join(' · ')}</small></div>`; }
function destinationOptions() { return state().clearedStages.map(id => `<option value="${id}">${id}. ${esc(stage(id).name)}</option>`).join(''); }
function village() { const s = state(), pending = s.accrual.pending; return `<div class="village-scene"><div class="sun"></div><div class="hills"></div><div class="house chapel"><span>성당</span></div><div class="house inn"><span>마을 쉼터</span></div><div class="village-party">${s.recruited.map(id => avatar(id)).join('')}</div><div class="welcome"><small>회중시계의 작은 가호</small><h2>잠시 쉬어 가도 괜찮아.</h2><p>함께 돌아갈 길을 찾아요.</p></div></div><div class="two-columns"><article><h3>마을의 하루</h3><p>${PRODUCTION.map(p => `${esc(p.name)} · ${p.intervalSeconds / 60}분`).join(' / ')}</p><p>수령 대기: ${rewardText(pending)} · 경험치 ${Object.values(s.accrual.pendingXp).reduce((a,b) => a+b,0)}</p>${button('claim','생산·파견 일괄 수령')}<small>온라인은 실제 경과 시간, 오프라인은 생산과 파견을 함께 최대 12시간 적립합니다.</small></article><article><h3>온라인 모험 반복</h3><p>마을·동료·가방 이용 중 실제 전투를 이어갑니다.</p>${s.repeat ? `<p>${esc(stage(s.repeat.stageId).name)} 반복 중</p>${button('stop-repeat','반복 종료')}` : `<select id="repeat-stage" aria-label="반복 목적지">${destinationOptions()}</select>${button('repeat','반복 시작', s.clearedStages.length && !s.battle ? '' : 'disabled')}`}<small>종료·화면 숨김 시 미완료 전투 취소, 완료 보상 보존. 배속으로 보상 속도는 증가하지 않습니다.</small>${s.resumeRepeatStage && !s.repeat ? `<p>이전에 진행한 ${esc(stage(s.resumeRepeatStage).name)} 반복을 재개할까요?</p>${button('resume','반복 재개')}${button('dismiss-resume','나중에')}` : ''}</article></div>${s.clearedStages.includes(10) ? dispatchPanel() : ''}`; }
function dispatchPanel() { const d = state().dispatch; return `<article><h3>오프라인 파견 · 1슬롯</h3>${d ? `<p>${esc(stage(d.stageId).name)} · ${d.members.map(id => esc(CHARACTERS[id].name)).join(', ')} · ${Math.floor(d.progressSeconds)}/${d.durationSeconds}초</p><progress max="${d.durationSeconds}" value="${d.progressSeconds}"></progress>${button('stop-dispatch','파견 종료')}` : `<select id="dispatch-stage" aria-label="파견 목적지">${destinationOptions()}</select><div class="actions">${state().recruited.map(id => `<label><input type="checkbox" name="dispatch-member" value="${id}" checked>${esc(CHARACTERS[id].name)}</label>`).join('')}</div>${button('dispatch','파견 시작')}`}<small>전투 동료 중복 등록 가능 · 직접 전투 보상의 약 50% · 도감 증가 없음 · 전투력으로 시간 산정</small></article>`; }
function adventure() { return `<div class="section-title"><div><small>CHAPTER 01</small><h2>어머니를 찾아 숲으로</h2></div><p>${state().clearedStages.length} / 10 완료</p></div><div class="stage-grid">${STAGES.map(s => { const clear = state().clearedStages.includes(s.id), locked = s.unlockAfterStage && !state().clearedStages.includes(s.unlockAfterStage); return `<article class="stage ${clear ? 'cleared' : ''}"><small>STAGE ${String(s.id).padStart(2,'0')} · ${clear ? '완료' : locked ? '앞 단계 완료 필요' : '모험 가능'}</small><h3>${esc(s.name)}</h3><p>${s.waves.length}웨이브 · 금화 ${s.rewards.gold} · 경험치 ${s.rewards.xp}</p>${button('stage',clear ? '재도전' : '입장', `data-id="${s.id}" ${locked || state().battle || state().repeat ? 'disabled' : ''}`)}</article>`; }).join('')}</div>`; }
function characters() { const s = state(); return `<h2>함께 걷는 동료</h2><p>레벨은 승리·파견 경험치로 성장합니다. 회중시계 가호: 체력 +${GAME_CONFIG.watchBlessing.hp}, 공격 +${GAME_CONFIG.watchBlessing.atk} · 도감 공격 +${s.codex.sharedAtk}</p><div class="character-grid">${s.recruited.map(id => { const c = s.characters[id], stats = calculateStats(s,id), def = CHARACTERS[id]; return `<article>${avatar(id)}<h3>${esc(def.name)} <small>${roles[def.role]} · Lv.${c.level}</small></h3><p>경험치 ${c.xp} / ${50+(c.level-1)*25} · 출전 ${s.codex.appearances[id] || 0}회</p><p>체력 ${stats.hp} · 공격 ${stats.atk} · 방어 ${stats.defense} · 속도 ${stats.speed}</p>${button('party',s.party.includes(id) ? '편성 해제' : '편성 추가', `data-id="${id}" ${s.battle ? 'disabled' : ''}`)}${Object.entries(slots).map(([slot,label]) => `<label class="equipment-label">${label}<select data-character="${id}" data-slot="${slot}" aria-label="${esc(def.name)} ${label}"><option value="">없음</option>${s.inventory.filter(item => EQUIPMENT[item].slot === slot).map(item => `<option value="${item}" ${c.equipment[slot] === item ? 'selected' : ''}>${esc(EQUIPMENT[item].name)}</option>`).join('')}</select></label>`).join('')}<small>${def.skills.map(k => esc(SKILLS[k].name)).join(' · ')} / ${esc(SKILLS[def.passive].name)}</small></article>`; }).join('')}</div><p>전투 중 장비 변경은 다음 전투부터 반영됩니다. 편성 변경은 전투 종료 후 가능합니다.</p>`; }
function inventory() { return `<h2>가방과 마을 장비</h2><p>장비 수치는 테스트용 초안입니다. 보유 장비는 동료 화면에서 착용하세요.</p><div class="stage-grid">${Object.values(EQUIPMENT).map(e => `<article><small>${slots[e.slot]}</small><h3>${esc(e.name)}</h3><p>${Object.entries(e.stats).map(([k,v]) => `${({hp:'체력',atk:'공격',defense:'방어',speed:'속도'})[k]} +${v}`).join(' · ')}</p>${button('buy',state().inventory.includes(e.id) ? '보유 중' : `${e.price} 금화 · 구매`, `data-id="${e.id}" ${state().inventory.includes(e.id) || state().resources.gold < e.price ? 'disabled' : ''}`)}</article>`).join('')}</div>`; }
function codex() { return `<h2>숲의 기록</h2><p>실제 전투 최종 승리에서만 처치·출전을 기록합니다. 종류별 100처치 보상: 공통 공격 +1.</p><div class="stage-grid">${Object.values(ENEMIES).map(e => { const n = state().codex.kills[e.id] || 0, claimed = state().codex.claimed.includes(e.id); return `<article>${avatar(e.id,true)}<h3>${esc(e.name)}</h3><p>${n} / 100 처치</p><progress max="100" value="${Math.min(n,100)}"></progress>${button('codex',claimed ? '수령 완료' : '공격 +1 수령', `data-id="${e.id}" ${claimed || n<100 ? 'disabled' : ''}`)}</article>`; }).join('')}</div>`; }
function battleView() { const b = state().battle || lastBattle; if (!b) return `<article><h2>모험을 시작해 보세요.</h2>${button('view','스테이지 선택','data-id="adventure"')}</article>`; return `<div class="section-title"><div><small>${state().repeat ? '온라인 반복' : '모험'}</small><h2>${esc(stage(b.stageId).name)}</h2></div><div class="actions">${[1,2,4].map(n => button('speed',`${n}×`, `data-id="${n}" aria-pressed="${engine.displaySpeed === n}"`)).join('')}</div></div><p>라운드 ${b.round} · 웨이브 ${b.waveIndex+1}/${b.waves.length} · ${b.status === 'active' ? '자동 전투 중' : b.status === 'victory' ? '승리 · 보상 지급 완료' : '패배 · 동료를 정비해 다시 도전하세요'}</p><div class="battlefield"><div class="team">${b.allies.map(unitCard).join('')}</div><div class="versus">VS</div><div class="team enemies">${b.enemies.map(unitCard).join('')}</div></div><div class="battle-bottom"><div><small>배속은 모션 시간만 변경합니다. 판정은 실제 시간 1초당 행동 1회입니다.</small>${b.status !== 'active' ? button('view','다음 모험 선택','data-id="adventure"') : ''}${state().repeat ? button('stop-repeat','반복 종료') : ''}</div><ol class="combat-log">${log.slice(-5).map(l => `<li>${esc(l)}</li>`).join('')}</ol></div>`; }
const views = {village, adventure, characters, inventory, codex, battle:battleView};
function render() {
  $('#resources').textContent = rewardText(state().resources);
  $('#nav').innerHTML = Object.entries({village:'마을', adventure:'모험', characters:'동료', inventory:'가방', codex:'도감', battle:'전투'}).map(([id,label]) => button('view',label,`data-id="${id}" aria-current="${view === id ? 'page' : 'false'}"`)).join('') + button('backup','저장·백업');
  $('#content').innerHTML = views[view]();
  $('#activity').textContent = state().repeat ? `● ${stage(state().repeat.stageId).name} 온라인 반복 중` : state().battle ? '● 모험 진행 중' : '마을에서 쉬는 중';
  document.documentElement.style.setProperty('--motion-time', `${700 / engine.displaySpeed}ms`);
}
function processBattle(b) {
  if (!b) return false;
  const key = `${b.id}:${b.actionCount}:${b.waveIndex}:${b.status}`;
  if (lastSeenAction === key) return false;
  lastSeenAction = key;
  const unitName = id => CHARACTERS[id]?.name || ENEMIES[b.enemies.find(u => u.id === id)?.enemyId]?.name || '짐승';
  for (const event of b.events) {
    if (event.type === 'action') log.push(`${unitName(event.actor)} · ${SKILLS[event.skill]?.name || (event.skill === 'basicAttack' ? '기본 공격' : event.skill)}`);
    else if (event.type === 'heal') log.push(`${unitName(event.target)} 체력 +${event.amount}`);
    else if (event.type === 'revive') log.push(`${unitName(event.target)} 부활`);
  }
  log = log.slice(-30); lastBattle = b;
  if (b.status !== 'active') {
    const firstVictory = b.status === 'victory' && !finishedStoryBattles.has(b.id);
    finishedStoryBattles.add(b.id);
    if (firstVictory && !state().repeat && state().clearedStages.includes(b.stageId) && firstClearBattle === b.id) showStory(stage(b.stageId).victoryStory, () => render());
    notify(b.status === 'victory' ? '승리! 보상과 경험치를 받았습니다.' : '패배했습니다. 장비와 편성을 정비해 보세요.'); persist(true);
  }
  return true;
}
const finishedStoryBattles = new Set(); let firstClearBattle = null;
function pulse() {
  if (suspended || !playable()) return;
  const previous = state().battle;
  if (previous && !state().clearedStages.includes(previous.stageId)) firstClearBattle = previous.id;
  engine.tick();
  const observed = previous || state().battle;
  const changed = processBattle(observed);
  // Keep forms stable while players choose equipment or dispatch members.
  if (view === 'battle' || view === 'village' && !$('#content').contains(document.activeElement)) render();
  else { $('#resources').textContent = rewardText(state().resources); $('#activity').textContent = state().repeat ? `● ${stage(state().repeat.stageId).name} 온라인 반복 중` : state().battle ? '● 모험 진행 중' : '마을에서 쉬는 중'; }
  if (view === 'battle' && observed && changed) for (const e of observed.events) {
    const id = e.actor || e.target, el = [...document.querySelectorAll('[data-unit]')].find(el => el.dataset.unit === id);
    if (el) el.classList.add(e.type === 'heal' || e.type === 'revive' ? 'healing' : e.type === 'damage' ? 'hit' : 'acting');
  }
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
  try {
    const action = target.dataset.action;
    if (['login','logout','retry','resolve'].includes(action)) { void authAction(action); return; }
    if (['guest-import','fresh-account','remote-load','local-retry'].includes(action)) { void resolveChoice(action); return; }
    if (!playable() && !['backup','close-backup','export','download','saved-backup'].includes(action)) return;
    const id = target.dataset.id;
    switch (target.dataset.action) {
      case 'view': view = id; break;
      case 'stage': startManual(Number(id)); return;
      case 'speed': engine.setDisplaySpeed(Number(id)); break;
      case 'save': persist(); return;
      case 'repeat': engine.startRepeat(Number($('#repeat-stage').value)); lastBattle = null; break;
      case 'resume': engine.startRepeat(state().resumeRepeatStage); break;
      case 'dismiss-resume': state().resumeRepeatStage = null; break;
      case 'stop-repeat': engine.stopRepeat(); lastBattle = null; break;
      case 'claim': engine.accrue(); notify(`수령 완료: ${rewardText(engine.claimRewards())}`); break;
      case 'party': engine.setParty(state().party.includes(id) ? state().party.filter(c => c !== id) : [...state().party,id]); break;
      case 'buy': engine.buyEquipment(id); notify('장비를 가방에 담았습니다.'); break;
      case 'codex': engine.claimCodex(id); notify('모든 동료의 공격이 1 증가했습니다.'); break;
      case 'dispatch': engine.startDispatch(Number($('#dispatch-stage').value), [...document.querySelectorAll('[name="dispatch-member"]:checked')].map(el => el.value)); break;
      case 'stop-dispatch': engine.stopDispatch(); break;
      case 'backup': $('#backup-text').value = ''; $('#backup').showModal(); return;
      case 'close-backup': $('#backup').close(); return;
      case 'export': $('#backup-text').value = engine.exportSave(); return;
      case 'saved-backup': $('#backup-text').value = recovery.get(recoveryKey(uid))?.json || originals.get(recoveryKey(uid)) || localStorage.getItem(localKey(uid, 'backup')) || cachedJson || ''; notify('보존한 원본 백업을 표시했습니다. 이전 보존본은 한 단계 더 유지됩니다.'); return;
      case 'download': { const url = URL.createObjectURL(new Blob([$('#backup-text').value || engine.exportSave()],{type:'application/json'})); const a = document.createElement('a'); a.href = url; a.download = 'shinheun-ch1-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); return; }
      case 'import': engine.importSave($('#backup-text').value); storageBlocked = false; lastBattle = null; log = []; view = 'village'; $('#backup').close(); notify('백업을 복구했습니다. 오프라인 적립은 최대 12시간입니다.'); break;
    }
    persist(true); render();
  } catch (error) { notify(`실행하지 못했습니다: ${error.message}`); }
});
document.addEventListener('change', event => { const el = event.target; if (!el.dataset.slot || !playable()) return; try { engine.equip(el.dataset.character,el.dataset.slot,el.value || null); persist(true); notify('장비 변경 완료. 진행 중인 전투에는 다음 전투부터 반영됩니다.'); render(); } catch(error) { notify(error.message); } });
function disconnect() { if (suspended) return; if (playable()) { engine.disconnect(); lastBattle = null; persist(true); } suspended = true; }
// Also called when an account load or conflict choice finishes, so a hide/show during those phases cannot leave the loop paused.
function resume() { if (suspended && !document.hidden && playable()) { engine.reconnect(); suspended = false; render(); } }
document.addEventListener('visibilitychange', () => { if (document.hidden) disconnect(); else resume(); });
window.addEventListener('pagehide',disconnect);
window.addEventListener('pageshow', resume);
const loaded = engine.load(scopedStorage(null));
storageBlocked = !loaded.ok;
render();
syncUI();
void cloud.handleRedirectResult().then(result => { if (!result.ok) notify('로그인 연결 실패. 로컬 플레이를 계속하거나 로그인을 재시도하세요.'); });
if (!loaded.ok) notify('저장 데이터가 손상되어 불러오지 못했습니다. 기존 저장은 유지됩니다. JSON 백업으로 복구하세요.');
else if (loaded.found) notify('진행을 복원했습니다. 생산·파견 적립을 마을에서 수령하세요.');
setInterval(pulse,1000);
setInterval(() => { if (!suspended) persist(true); },15000);

$('#sync-dialog').addEventListener('cancel', event => event.preventDefault());