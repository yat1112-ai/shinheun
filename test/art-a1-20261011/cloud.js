// Playtest only. Cloud login, read and write intentionally disabled.
export function createCloud() {
  const status = { signedIn:false, uid:null, lastError:null, retryable:false };
  return {
    onStatus(callback) { callback(status); return () => {}; },
    status() { return status; },
    init: async () => {},
    handleRedirectResult: async () => ({ok:true, signedIn:false}),
    signIn: async () => ({ok:false, kind:'playtest-disabled'}),
    signOut: async () => ({ok:true}),
    read: async () => ({ok:false, kind:'playtest-disabled'}),
    write: async () => ({ok:false, kind:'playtest-disabled'})
  };
}
