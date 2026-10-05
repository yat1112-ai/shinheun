// Pure cloud-sync logic for the reboot. No browser, Firebase, or clock access (time is always passed in).
import { restoreSave, createInitialState } from './engine.js';
import { GAME_CONFIG } from './data.js';

export const CLOUD_SCHEMA = 1;
export const GAME_ID = 'shinheun-reboot';
const LOCAL_PREFIX = 'shinheun.reboot.cloud.v1';
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_DEVICE_FIELD = 64;

const fail = message => { throw new Error(message); };
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function assertUid(uid) { if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) fail('Invalid uid'); return uid; }

// (1) Local keys: one namespace per guest/uid, never the legacy prototype key.
export function localKey(uid = null, kind = 'save') {
  if (kind !== 'save' && kind !== 'backup' && kind !== 'backup-prev' && kind !== 'meta') fail('Invalid key kind');
  const scope = uid === null ? 'guest' : `uid:${assertUid(uid)}`;
  const key = `${LOCAL_PREFIX}:${scope}:${kind}`;
  if (key === GAME_CONFIG.saveKey) fail('Key collides with legacy save');
  return key;
}

// (2) Remote path: only the reboot namespace. The legacy users/$uid/save path is never produced.
export function remotePath(uid) { return `users/${assertUid(uid)}/games/${GAME_ID}/save`; }

// (3) Envelope. Engine JSON is a string so RTDB cannot drop empty arrays/null inside it.
function cleanDevice(device) {
  const d = isPlainObject(device) ? device : {};
  const text = v => (typeof v === 'string' ? v.slice(0, MAX_DEVICE_FIELD) : '');
  return { id: text(d.id), label: text(d.label) };
}

export function serializeEnvelope({ revision, engineJson, device, now }) {
  if (!Number.isSafeInteger(revision) || revision < 1) fail('Invalid revision');
  if (!Number.isFinite(now) || now < 0) fail('Invalid clock');
  restoreSave(engineJson, now); // throws on damaged/unsupported engine data
  return { schema: CLOUD_SCHEMA, game: GAME_ID, revision, engine: engineJson, device: cleanDevice(device), savedAt: now };
}

// Validates the whole envelope or rejects it; never returns partial data.
export function parseEnvelope(raw, now) {
  try {
    if (!isPlainObject(raw)) fail('Envelope must be an object');
    if (raw.schema !== CLOUD_SCHEMA) fail('Unsupported cloud schema');
    if (raw.game !== GAME_ID) fail('Wrong game');
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 1) fail('Invalid revision');
    if (typeof raw.engine !== 'string') fail('Engine data must be a string');
    if (!isPlainObject(raw.device) || typeof raw.device.id !== 'string' || typeof raw.device.label !== 'string') fail('Invalid device meta');
    if (!Number.isFinite(raw.savedAt) || raw.savedAt < 0) fail('Invalid savedAt');
    const state = restoreSave(raw.engine, now);
    return { ok: true, envelope: { schema: raw.schema, game: raw.game, revision: raw.revision, engine: raw.engine, device: cleanDevice(raw.device), savedAt: raw.savedAt }, state };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

const isEmptyRemote = raw => raw === null || raw === undefined;

// (4) Revision-based write decision, shaped for use inside a transaction update function.
// An empty remote is revision 0. Timestamps never decide the winner.
export function decideWrite({ remoteRaw, expectedRevision, engineJson, device, now }) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return { action: 'reject', reason: 'Invalid expected revision' };
  let remoteRevision = 0;
  if (!isEmptyRemote(remoteRaw)) {
    const remote = parseEnvelope(remoteRaw, now);
    if (!remote.ok) return { action: 'reject', reason: `Remote data refused: ${remote.reason}` };
    remoteRevision = remote.envelope.revision;
  }
  if (remoteRevision !== expectedRevision) return { action: 'conflict', expectedRevision, remoteRevision };
  try {
    return { action: 'write', envelope: serializeEnvelope({ revision: expectedRevision + 1, engineJson, device, now }) };
  } catch (error) {
    return { action: 'reject', reason: error.message };
  }
}

// Progress signature without timestamp-only fields, so a bare clock tick does not look like a change worth a revision write.
// Pending rewards, pending xp and dispatch progress stay in: another device cannot reconstruct them beyond the offline cap,
// so real accrual must upload.
export function syncSignature(engineJson) {
  try {
    const o = JSON.parse(engineJson);
    delete o.accrual.lastAt; delete o.accrual.productionRemainders;
    return JSON.stringify(o);
  }
  catch { return engineJson; }
}

// True when the engine holds progress the server copy does not: a dirty or in-flight write, no known synced state,
// or accrual since the last sync. Used before an account switch so such progress is saved as dirty, never as clean.
export function hasUnsyncedChange({ dirty, writing, syncedSig, engineJson }) {
  return Boolean(dirty || writing || syncedSig === null || syncSignature(engineJson) !== syncedSig);
}

// (5) Login. "Progressed" means the save differs from a fresh start in anything the player earned.
export function isProgressed(engineJson, now = 0) {
  let s;
  // Restore at the save's own clock so offline catch-up of an idle guest is not mistaken for progress;
  // rewards already accrued into pending/pendingXp are real earnings and do count.
  try { s = restoreSave(engineJson, JSON.parse(engineJson).accrual.lastAt); } catch { return false; }
  const fresh = createInitialState(0);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return !(same(s.resources, fresh.resources) && same(s.accrual.pending, fresh.accrual.pending) && Object.keys(s.accrual.pendingXp).length === 0 && same(s.characters, fresh.characters) && same(s.party, fresh.party)
    && same(s.recruited, fresh.recruited) && same(s.inventory, fresh.inventory) && s.clearedStages.length === 0
    && s.enteredStages.length === 0 && same(s.codex, fresh.codex) && s.dispatch === null && s.nextBattleId === 1
    && s.settledBattles.length === 0 && s.resumeRepeatStage === null);
}

// remoteRaw: server value or null. guestJson: guest engine JSON or null.
// accountLocal: this account's cached { engineJson, baseRevision, dirty } or null.
// The server wins; nothing is written here, and the guest save is always kept (keepGuestBackup).
export function decideLogin({ uid, remoteRaw, guestJson = null, accountLocal = null, now }) {
  assertUid(uid);
  const base = { uid, keepGuestBackup: guestJson !== null };
  // A damaged account cache is unusable: ignore it for the decision but tell the caller to preserve it before anything replaces it.
  if (accountLocal) {
    let usable = true;
    try { restoreSave(accountLocal.engineJson, now); } catch { usable = false; }
    if (!usable) return { ...decideLogin({ uid, remoteRaw, guestJson, accountLocal: null, now }), preserveLocal: accountLocal.engineJson };
  }
  if (isEmptyRemote(remoteRaw)) {
    // A dirty cache based on the empty server (revision 0) is this account's own unsynced progress.
    if (accountLocal && accountLocal.dirty) {
      if (accountLocal.baseRevision === 0) return { ...base, action: 'push-local', expectedRevision: 0, remoteRevision: 0 };
      return { ...base, action: 'conflict', baseRevision: accountLocal.baseRevision, remoteRevision: 0, remote: null };
    }
    if (guestJson !== null && isProgressed(guestJson, now)) return { ...base, action: 'prompt-import', reason: 'Empty account and guest has progress' };
    return { ...base, action: 'init-empty', expectedRevision: 0 };
  }
  const remote = parseEnvelope(remoteRaw, now);
  if (!remote.ok) return { ...base, action: 'blocked', reason: `Remote data refused: ${remote.reason}` };
  const revision = remote.envelope.revision;
  if (accountLocal && accountLocal.dirty) {
    if (accountLocal.baseRevision === revision) return { ...base, action: 'push-local', expectedRevision: revision, remoteRevision: revision };
    return { ...base, action: 'conflict', baseRevision: accountLocal.baseRevision, remoteRevision: revision, remote: remote.envelope };
  }
  // A clean cache at the server's revision with the same player progress holds the newer clock-derived accrual
  // (online pending rewards, dispatch progress) that is never uploaded; keep it so a re-login does not lose it.
  if (accountLocal && accountLocal.baseRevision === revision && syncSignature(accountLocal.engineJson) === syncSignature(remote.envelope.engine)) {
    return { ...base, action: 'keep-local', revision, expectedRevision: revision, remoteRevision: revision };
  }
  return { ...base, action: 'load-remote', revision, envelope: remote.envelope };
}

// Pure session transitions. Async results carry (epoch, uid) and are dropped if the session moved on,
// so a slow response for account A can never land in account B or in a logged-out guest session.
export function createSession() { return { epoch: 0, uid: null, phase: 'guest', revision: 0, detail: null }; }

export function activeKeys(session) {
  return { save: localKey(session.uid, 'save'), backup: localKey(session.uid, 'backup'), meta: localKey(session.uid, 'meta') };
}

const PHASE_BY_ACTION = { 'load-remote': 'ready', 'keep-local': 'ready', 'init-empty': 'ready', 'push-local': 'ready', 'prompt-import': 'needs-import', conflict: 'conflict', blocked: 'error' };

export function reduceSession(session, event) {
  const current = e => e.epoch === session.epoch && e.uid === session.uid && session.uid !== null;
  switch (event.type) {
    case 'login':
      if (session.uid === event.uid) return session;
      return { epoch: session.epoch + 1, uid: assertUid(event.uid), phase: 'syncing', revision: 0, detail: null };
    case 'logout':
      return { epoch: session.epoch + 1, uid: null, phase: 'guest', revision: 0, detail: null };
    case 'decided': {
      if (!current(event) || !PHASE_BY_ACTION[event.decision.action]) return session;
      const d = event.decision;
      return { ...session, phase: PHASE_BY_ACTION[d.action], revision: d.revision ?? d.expectedRevision ?? d.remoteRevision ?? 0, detail: d };
    }
    case 'written':
      return current(event) && Number.isSafeInteger(event.revision) ? { ...session, phase: 'ready', revision: event.revision, detail: null } : session;
    case 'write-failed': // local backup is kept by the caller; session stays retryable at the same revision
      return current(event) ? { ...session, phase: 'error', detail: { action: 'write-failed', reason: String(event.reason || '') } } : session;
    case 'conflict':
      return current(event) ? { ...session, phase: 'conflict', detail: { action: 'conflict', remoteRevision: event.remoteRevision } } : session;
    default:
      return session;
  }
}