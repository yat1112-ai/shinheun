import { createGameEngine } from './engine.js';
import { CHARACTERS, STORY_CHARACTERS, SKILLS, ENEMIES } from './data.js';

import { createCloud } from './cloud.js';
import { localKey, decideLogin, syncSignature, hasUnsyncedChange } from './cloud-core.js';
import { esc, stage, rewardText, button, renderView, topInfo, hasView } from './views.js';
import { fitScale } from './ui-layout.js';

let engine = createGameEngine();
const $ = selector => document.querySelector(selector);
let view = 'village', lastBattle = null, storyLines = [], storyIndex = 0, afterStory = null, suspended = document.hidden;
let log = [], lastSeenAction = '', noticeTimer, storageBlocked = false;
// 전투 결과창 표시 여부, 인스펙트 중인 아군, 시작 시점의 첫 클리어 여부(결과창 보상 안내용). 표시 전용 상태다.
let resultOpen = false, selectedUnit = null, clearedBefore = true;
const state = () => engine.state;
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
  // 전투 화면은 상단 공간이 좁아 클라우드 버튼을 숨기지만, 확인·오류·충돌 상태에서는 반드시 보여 준다.
  $('#game').dataset.alert = ['loading', 'error', 'conflict', 'import'].includes(phase) ? '1' : '';
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
  lastBattle = null; log = []; lastSeenAction = ''; firstClearBattle = null; resultOpen = false; selectedUnit = null;
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
  const start = () => { clearedBefore = state().clearedStages.includes(s.id); engine.startBattle(s.id); lastBattle = null; log = []; resultOpen = false; selectedUnit = null; view = 'battle'; persist(true); render(); };
  showStory(state().enteredStages.includes(s.id) ? [] : s.story, start);
}
const ctx = () => ({ s: state(), speed: engine.displaySpeed, lastBattle, log, selected: selectedUnit, resultOpen, clearedBefore });
const activityText = () => state().repeat ? `● ${stage(state().repeat.stageId).name} 온라인 반복 중` : state().battle ? '● 모험 진행 중' : '마을에서 쉬는 중';
const NAV = { village:'마을', adventure:'모험', characters:'동료', inventory:'가방', codex:'도감' };
function renderChrome(c) {
  $('#resources').textContent = rewardText(state().resources);
  $('#top-info').innerHTML = topInfo(view, c);
  $('#activity').textContent = activityText();
}
function render() {
  if (!hasView(view)) view = 'village';
  const c = ctx();
  document.body.dataset.view = $('#game').dataset.view = view;
  renderChrome(c);
  // 실제 진행 중인 전투나 이번 세션의 종료 결과가 있을 때만 전투 탭을 제공한다.
  const tabs = state().battle || state().repeat || lastBattle ? { ...NAV, battle:'전투' } : NAV;
  $('#nav').innerHTML = Object.entries(tabs).map(([id,label]) => button('view',label,`data-id="${id}" aria-current="${view === id ? 'page' : 'false'}"`)).join('') + button('backup','저장·백업');
  $('#content').innerHTML = renderView(view, c);
  document.documentElement.style.setProperty('--motion-time', `${700 / engine.displaySpeed}ms`);
}
// 논리 캔버스(1280×600)를 뷰포트에 맞춰 통째로 축소·확대한다. 레이아웃은 캔버스 안에서만 계산한다.
function fit() {
  const scale = fitScale(window.innerWidth, window.innerHeight);
  $('#game').style.transform = `translate(-50%,-50%) scale(${scale})`;
  document.documentElement.style.setProperty('--scale', scale.toFixed(4));
  document.documentElement.classList?.toggle?.('compact', scale < 0.65 && window.innerWidth >= window.innerHeight);
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
document.addEventListener('fullscreenchange', () => { fit(); $('#fullscreen').setAttribute('aria-pressed', String(!!document.fullscreenElement)); });
function toggleFullscreen() {
  if (document.fullscreenElement) { void document.exitFullscreen(); return; }
  const el = document.documentElement;
  if (!el.requestFullscreen) { notify('이 브라우저는 전체화면 전환을 지원하지 않습니다.'); return; }
  el.requestFullscreen().catch(() => notify('전체화면으로 전환하지 못했습니다.'));
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
    resultOpen = !state().repeat;
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
  else renderChrome(ctx());
  if (view === 'battle' && observed && changed) for (const e of observed.events) {
    const id = e.actor || e.target, el = [...document.querySelectorAll('[data-unit]')].find(el => el.dataset.unit === id);
    if (!el) continue;
    el.classList.add(e.type === 'heal' || e.type === 'revive' ? 'healing' : e.type === 'damage' ? 'hit' : 'acting');
    // 엔진 이벤트의 실제 수치만 띄운다(0 이하나 알 수 없는 이벤트는 표시하지 않음).
    if ((e.type === 'damage' || e.type === 'heal') && e.amount > 0) el.insertAdjacentHTML('beforeend', `<b class="float ${e.type}">${e.type === 'damage' ? '-' : '+'}${e.amount}</b>`);
  }
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
  try {
    const action = target.dataset.action;
    if (['login','logout','retry','resolve'].includes(action)) { void authAction(action); return; }
    if (['guest-import','fresh-account','remote-load','local-retry'].includes(action)) { void resolveChoice(action); return; }
    if (!playable() && !['backup','close-backup','export','download','saved-backup','fullscreen'].includes(action)) return;
    const id = target.dataset.id;
    switch (target.dataset.action) {
      case 'fullscreen': toggleFullscreen(); return;
      case 'inspect': selectedUnit = selectedUnit === id ? null : id; break;
      case 'view': view = id; resultOpen = id === 'battle' && !state().battle && !state().repeat && !!lastBattle && lastBattle.status !== 'active'; break;
      case 'stage': startManual(Number(id)); return;
       case 'next-stage': {
         if (!lastBattle || lastBattle.status !== 'victory' || state().battle || state().repeat)
           throw new Error('승리 후 다음 스테이지로 진행할 수 있습니다.');
         const nextId = lastBattle.stageId + 1;
         if (nextId !== Number(id) || !stage(nextId))
           throw new Error('다음 스테이지를 확인할 수 없습니다.');
         startManual(nextId);
         return;
       }
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
fit();
render();
syncUI();
void cloud.handleRedirectResult().then(result => { if (!result.ok) notify('로그인 연결 실패. 로컬 플레이를 계속하거나 로그인을 재시도하세요.'); });
if (!loaded.ok) notify('저장 데이터가 손상되어 불러오지 못했습니다. 기존 저장은 유지됩니다. JSON 백업으로 복구하세요.');
else if (loaded.found) notify('진행을 복원했습니다. 생산·파견 적립을 마을에서 수령하세요.');
setInterval(pulse,1000);
setInterval(() => { if (!suspended) persist(true); },15000);

$('#sync-dialog').addEventListener('cancel', event => event.preventDefault());
