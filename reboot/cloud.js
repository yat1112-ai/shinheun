// Browser Firebase adapter for the reboot. Static hosting only: CDN ESM imports, no server dependencies.
// The SDK is injectable so tests run against a mock. Only reboot paths from cloud-core.js are ever touched.
import { remotePath, decideWrite, parseEnvelope } from './cloud-core.js';

const SDK_VERSION = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
const DEFAULT_TIMEOUT_MS = 15000;

// Public browser config of the existing Firebase project (client-side web config only, overridable via createCloud({ config })).
// Never put admin keys or credentials here.
export const FIREBASE_PUBLIC_CONFIG = {apiKey:"AIzaSyCu-zBA7vxCk0xvtxFy9ldVwEKkJjoHfxI",authDomain:"shinheun.firebaseapp.com",databaseURL:"https://shinheun-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"shinheun",storageBucket:"shinheun.firebasestorage.app",messagingSenderId:"322092382965",appId:"1:322092382965:web:87fbf47524ba1f3d19e3bc"};

export async function loadFirebaseSdk() {
  const [app, auth, db] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-database.js`),
  ]);
  return { ...app, ...auth, ...db };
}

const NETWORK_CODES = /network|unavailable|disconnect|offline|timeout|deadline|failed to fetch/i;
const POPUP_FALLBACK_CODES = /popup-blocked|operation-not-supported|web-storage-unsupported/i;

export function classifyError(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  if (/permission[-_ ]denied/i.test(text)) return 'permission';
  if (NETWORK_CODES.test(text)) return 'network';
  return 'error';
}

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
  promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});

const defaultIsMobile = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

// options: { sdk, config, isMobile, timeoutMs }
export function createCloud({ sdk = null, config = FIREBASE_PUBLIC_CONFIG, isMobile = defaultIsMobile, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let api = sdk;
  let auth = null;
  let db = null;
  let uid = null;
  let epoch = 0;
  let lastError = null; // { kind, message, op } while the last operation failed; cleared by success or sign-out
  const listeners = new Set();

  const snapshotStatus = () => ({ signedIn: uid !== null, uid, lastError: uid === null ? null : lastError, retryable: uid !== null && lastError !== null && !['permission', 'conflict', 'invalid'].includes(lastError.kind) });
  const emit = () => { const s = snapshotStatus(); for (const l of listeners) l(s); };
  const setError = (op, error, kind = classifyError(error)) => { lastError = { kind, op, message: String(error?.message || error || '') }; emit(); };

  let initPromise = null;
  async function setup() {
    if (!api) api = await loadFirebaseSdk();
    if (!config) throw new Error('Firebase public config is not provided');
    const app = api.initializeApp(config);
    auth = api.getAuth(app);
    db = api.getDatabase(app);
    api.onAuthStateChanged(auth, user => {
      const next = user?.uid ?? null;
      if (next !== uid) { epoch += 1; lastError = null; }
      uid = next;
      emit();
    });
  }
  // Concurrent callers share one setup; a failed setup can be retried.
  function init() {
    if (!initPromise) initPromise = setup().catch(e => { initPromise = null; auth = null; throw e; });
    return initPromise;
  }

  // Popup first; mobile or blocked popups fall back to redirect (the page reloads, so the redirect result is handled on load).
  async function signIn() {
    try {
      await init();
      const provider = new api.GoogleAuthProvider();
      if (isMobile()) { await api.signInWithRedirect(auth, provider); return { ok: true, method: 'redirect' }; }
      await api.signInWithPopup(auth, provider);
      return { ok: true, method: 'popup' };
    } catch (error) {
      if (POPUP_FALLBACK_CODES.test(`${error?.code || ''}`)) {
        try { await api.signInWithRedirect(auth, new api.GoogleAuthProvider()); return { ok: true, method: 'redirect' }; } catch (e2) { return { ok: false, kind: classifyError(e2), message: String(e2?.message || e2) }; }
      }
      return { ok: false, kind: classifyError(error), cancelled: /closed-by-user|cancelled-popup/i.test(`${error?.code || ''}`), message: String(error?.message || error) };
    }
  }

  // Call once on page load after init so a pending redirect sign-in completes.
  async function handleRedirectResult() {
    try {
      await init();
      const result = await api.getRedirectResult(auth);
      return { ok: true, signedIn: Boolean(result?.user) };
    } catch (error) {
      return { ok: false, kind: classifyError(error), message: String(error?.message || error) };
    }
  }

  async function signOut() {
    try { await init(); } catch (error) {
      return { ok: false, kind: classifyError(error), message: String(error?.message || error) };
    }
    // Sign out first: on failure the real Firebase user is still signed in, so adapter state must not claim otherwise.
    try { await api.signOut(auth); }
    catch (error) {
      const actual = auth.currentUser?.uid ?? null;
      if (actual !== uid) { epoch += 1; lastError = null; uid = actual; emit(); }
      return { ok: false, kind: classifyError(error), message: String(error?.message || error) };
    }
    if (uid !== null) { epoch += 1; uid = null; }
    lastError = null;
    emit();
    return { ok: true };
  }

  // The callback receives the status snapshot; nothing account-specific is exposed once signed out.
  function onStatus(callback) {
    listeners.add(callback);
    callback(snapshotStatus());
    return () => listeners.delete(callback);
  }

  const current = () => ({ epoch, uid });
  const stale = ctx => ctx.epoch !== epoch || ctx.uid !== uid;
  const ref = ctx => api.ref(db, remotePath(ctx.uid));

  // Returns { ok:true, empty:true } | { ok:true, envelope, state, revision } | { ok:false, kind, ... }.
  async function read(now) {
    try { await init(); } catch (error) {
      return { ok: false, kind: classifyError(error), message: String(error?.message || error) };
    }
    const ctx = current();
    if (ctx.uid === null) return { ok: false, kind: 'signed-out' };
    try {
      const snap = await withTimeout(api.get(ref(ctx)), timeoutMs);
      if (stale(ctx)) return { ok: false, kind: 'signed-out' };
      const raw = snap.exists() ? snap.val() : null;
      lastError = null;
      emit();
      if (raw === null) return { ok: true, empty: true, revision: 0 };
      const parsed = parseEnvelope(raw, now);
      if (!parsed.ok) { setError('read', parsed.reason, 'invalid'); return { ok: false, kind: 'invalid', message: parsed.reason }; }
      return { ok: true, envelope: parsed.envelope, state: parsed.state, revision: parsed.envelope.revision };
    } catch (error) {
      if (stale(ctx)) return { ok: false, kind: 'signed-out' };
      setError('read', error);
      return { ok: false, kind: classifyError(error), message: String(error?.message || error) };
    }
  }

  // Revision-based write. Results: { ok:true, revision } | { ok:false, kind:'conflict', remoteRevision }
  // | { ok:false, kind:'network'|'permission'|'invalid'|'error'|'signed-out', retryable }.
  // The caller keeps its local backup on any !ok result and may retry with the same expectedRevision (or reload on conflict).
  async function write({ expectedRevision, engineJson, device, now }) {
    try { await init(); } catch (error) {
      const kind = classifyError(error);
      return { ok: false, kind, message: String(error?.message || error), retryable: kind !== 'permission' };
    }
    const ctx = current();
    if (ctx.uid === null) return { ok: false, kind: 'signed-out', retryable: false };
    const target = ref(ctx);
    let decision = null;
    let cancelled = false;
    try {
      // Prime the local cache so the transaction's first guess is the real server value, not null.
      await withTimeout(api.get(target), timeoutMs);
      if (stale(ctx)) return { ok: false, kind: 'signed-out', retryable: false };
      const result = await withTimeout(api.runTransaction(target, remoteRaw => {
        // Firebase may rerun this callback after an auth change or a timeout.
        if (cancelled || stale(ctx)) return undefined;
        // An empty local cache hands us null first; the SDK reruns with the real server value if it differs.
        // Do not judge a conflict on that guess: return null (no-op) and let the server value arrive.
        if (remoteRaw == null && expectedRevision > 0) { decision = { action: 'conflict', remoteRevision: 0, guess: true }; return null; }
        decision = decideWrite({ remoteRaw: remoteRaw ?? null, expectedRevision, engineJson, device, now });
        return decision.action === 'write' ? decision.envelope : undefined; // undefined aborts the transaction
      }, { applyLocally: false }), timeoutMs);
      if (stale(ctx)) return { ok: false, kind: 'signed-out', retryable: false };
      if (result?.committed && decision?.action === 'write') {
        lastError = null;
        emit();
        return { ok: true, revision: decision.envelope.revision };
      }
      // A genuinely empty server with expectedRevision>0 stays a conflict (the remote save vanished); a guess that was corrected is overwritten by the rerun's decision.
      if (decision?.action === 'conflict') {
        setError('write', `remote revision ${decision.remoteRevision}`, 'conflict');
        return { ok: false, kind: 'conflict', remoteRevision: decision.remoteRevision, expectedRevision, retryable: false };
      }
      if (decision?.action === 'reject') {
        setError('write', decision.reason, 'invalid');
        return { ok: false, kind: 'invalid', message: decision.reason, retryable: false };
      }
      setError('write', 'transaction not committed', 'network');
      return { ok: false, kind: 'network', retryable: true };
    } catch (error) {
      cancelled = true;
      if (stale(ctx)) return { ok: false, kind: 'signed-out', retryable: false };
      const kind = classifyError(error);
      setError('write', error, kind);
      return { ok: false, kind, message: String(error?.message || error), retryable: kind !== 'permission' };
    }
  }

  return { init, signIn, handleRedirectResult, signOut, onStatus, status: snapshotStatus, read, write };
}
