import { GAME_CONFIG, CHARACTERS, SKILLS, ENEMIES, STAGES, EQUIPMENT, INITIAL_EQUIPMENT, PRODUCTION, ACTIVITY_RULES } from './data.js';

export const SAVE_KEY = GAME_CONFIG.saveKey;
export const SAVE_VERSION = GAME_CONFIG.saveVersion;
export const ENGINE_POLICY = Object.freeze({ online: 'elapsedTime; one basic action per 1000ms, independent of display speed', offline: 'shared 43200 second production/dispatch window; no combat simulation', effects: 'expire at round end after their creation round; regeneration ticks at subsequent round ends', cooldown: 'decrement at owner action start, excluding cast action; cooldown N blocks next N opportunities', balance: 'data.js approved draft values; no original save system reused' });
const clone = value => JSON.parse(JSON.stringify(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const alive = units => units.filter(u => u.hp > 0);
const stageById = id => STAGES.find(s => s.id === Number(id));
const sumEffect = (u, type) => u.effects.filter(e => e.type === type).reduce((n, e) => n + (e.ratio || 0), 0);
const resources = () => ({ gold: 0, herbs: 0, ore: 0 });
function addResources(target, reward, multiplier = 1) { for (const key of ['gold', 'herbs', 'ore']) target[key] += (reward[key] || 0) * multiplier; }
function rewardResources(reward) { return { gold: reward.gold || 0, herbs: reward.materials?.herbs || reward.herbs || 0, ore: reward.materials?.ore || reward.ore || 0 }; }
export function createInitialState(now = Date.now()) {
  return { version: SAVE_VERSION, resources: { ...resources(), ...GAME_CONFIG.startingResources }, characters: Object.fromEntries(Object.keys(CHARACTERS).map(id => [id, { level: 1, xp: 0, equipment: clone(INITIAL_EQUIPMENT[id]) }])), party: [...GAME_CONFIG.initialParty], recruited: [...GAME_CONFIG.initialParty], inventory: [...new Set(Object.values(INITIAL_EQUIPMENT).flatMap(e => Object.values(e)).filter(Boolean))], clearedStages: [], enteredStages: [], codex: { kills: {}, appearances: {}, claimed: [], sharedAtk: 0 }, battle: null, repeat: null, resumeRepeatStage: null, nextBattleId: 1, settledBattles: [], dispatch: null, accrual: { lastAt: now, productionRemainders: {}, pending: resources(), pendingXp: {} } };
}
export function calculateStats(state, id) {
  const def = CHARACTERS[id]; assert(def && state.characters[id], 'Unknown character');
  const c = state.characters[id], growth = GAME_CONFIG.level.statGrowth;
  const stats = { ...def.stats };
  for (const key of ['hp', 'atk', 'defense']) stats[key] += (c.level - 1) * growth[key];
  stats.hp += GAME_CONFIG.watchBlessing.hp; stats.atk += GAME_CONFIG.watchBlessing.atk + state.codex.sharedAtk;
  for (const slot of GAME_CONFIG.equipmentSlots) { const item = EQUIPMENT[c.equipment[slot]]; if (item) for (const [key, value] of Object.entries(item.stats)) stats[key] = (stats[key] || 0) + value; }
  return stats;
}
function unit(id, stats, side, extra = {}) { return { id, side, ...stats, maxHp: stats.hp, effects: [], cooldowns: {}, reviveUsed: false, focusTarget: null, focusStacks: 0, ...extra }; }
function applyEffects(battle, target, effects, source, extra = {}) {
  for (const effect of effects || []) {
    if (effect.type === 'taunt' && target.immunities?.includes('taunt')) continue;
    // Refresh identical effects from the same source rather than stack them.
    target.effects = target.effects.filter(e => !(e.type === effect.type && e.source === source.id));
    target.effects.push({ ...clone(effect), source: source.id, appliedRound: battle.round, remaining: effect.durationRounds, healAmount: effect.healAtkRatio ? Math.round(attack(source) * effect.healAtkRatio) : undefined, ...extra });
  }
}
function shield(battle, targets, source, ratio, duration) { for (const t of targets) applyEffects(battle, t, [{ type: 'shield', durationRounds: duration }], source, { amount: Math.round(source.maxHp * ratio) }); }
function loadWave(battle) {
  battle.enemies = battle.waves[battle.waveIndex].enemies.map((entry, index) => {
    const e = ENEMIES[entry.enemyId], level = entry.level || 1;
    return unit(`enemy:${battle.waveIndex}:${index}`, { ...e.stats, hp: e.stats.hp + (level - 1) * 12, atk: e.stats.atk + (level - 1) * 2 }, 'enemy', { enemyId: e.id, skills: clone(e.skills || []), immunities: [...(e.immunities || [])] });
  });
  battle.queue = []; battle.cursor = 0;
}
export function createBattle(state, stageId, id = state.nextBattleId || 1) {
  const stage = stageById(stageId); assert(stage, 'Unknown stage');
  const battle = { id, stageId: stage.id, status: 'active', round: 1, waveIndex: 0, waves: clone(stage.waves), allies: state.party.map(id => unit(id, calculateStats(state, id), 'ally', { characterId: id })), enemies: [], queue: [], cursor: 0, kills: {}, events: [], actionCount: 0, cost: clone(stage.entryCost) };
  loadWave(battle);
  const clea = battle.allies.find(u => u.id === 'clea');
  if (clea) { const p = SKILLS.cleaSupport; shield(battle, battle.allies, clea, p.shieldOwnerMaxHpRatio, p.durationRounds); }
  return battle;
}
function attack(u) { return u.atk * (1 + sumEffect(u, 'atkUp')); }
function revive(battle) {
  const eir = battle.allies.find(u => u.id === 'eir' && u.hp > 0 && !u.reviveUsed);
  const dead = battle.allies.find(u => u.hp <= 0 && u.id !== 'eir');
  if (eir && dead) { eir.reviveUsed = true; dead.hp = Math.max(1, Math.round(dead.maxHp * SKILLS.eirRevive.restoredHpRatio)); battle.events.push({ type: 'revive', source: eir.id, target: dead.id, hp: dead.hp }); }
}
function damage(battle, source, target, ratio = 1, focus = true) {
  let bonus = 0;
  if (source.id === 'aren' && focus) { const p = SKILLS.arenFocus; if (source.focusTarget !== target.id) { source.focusTarget = target.id; source.focusStacks = 0; } bonus = source.focusStacks * p.damageBonusPerStack; source.focusStacks = Math.min(p.maxStacks, source.focusStacks + 1); }
  const defense = target.defense * Math.max(0, 1 - sumEffect(target, 'defenseDown'));
  let amount = Math.max(1, Math.round((attack(source) * ratio * (1 + bonus) - defense) * (1 + sumEffect(target, 'physicalVulnerability')) * Math.max(0, 1 - sumEffect(target, 'physicalDamageReduction'))));
  const raw = amount;
  for (const e of target.effects.filter(e => e.type === 'shield')) { const absorbed = Math.min(e.amount, amount); e.amount -= absorbed; amount -= absorbed; }
  target.effects = target.effects.filter(e => e.type !== 'shield' || e.amount > 0);
  target.hp = Math.max(0, target.hp - amount);
  battle.events.push({ type: 'damage', source: source.id, target: target.id, amount, absorbed: raw - amount });
  if (target.hp === 0) { if (target.side === 'enemy') battle.kills[target.enemyId] = (battle.kills[target.enemyId] || 0) + 1; else revive(battle); }
  return target.hp === 0;
}
const heal = (battle, source, target, ratio) => { const amount = Math.min(target.maxHp - target.hp, Math.round(attack(source) * ratio)); target.hp += amount; battle.events.push({ type: 'heal', source: source.id, target: target.id, amount }); };
export function chooseSkill(battle, actor) {
  if (actor.side === 'enemy') return (actor.skills || []).find((s, i) => !(actor.cooldowns[`enemySkill${i}`] > 0)) || null;
  const friends = alive(battle.allies), foes = alive(battle.enemies);
  for (const id of CHARACTERS[actor.id].aiPriority) {
    if (id === 'basicAttack') return null;
    const s = SKILLS[id]; if (actor.cooldowns[id] > 0) continue;
    if (s.type === 'heal') {
      const threshold = s.ai.missingHpRatioAtLeast;
      if (friends.filter(t => (t.maxHp - t.hp) / t.maxHp >= threshold).length < (s.ai.injuredAlliesAtLeast || 1)) continue;
    }
    if (id === 'cleaShield' && !friends.some(t => t.hp / t.maxHp < 0.8 && !t.effects.some(e => e.type === 'shield'))) continue;
    if (id === 'cleaTaunt' && actor.effects.some(e => e.type === 'physicalDamageReduction') && !foes.some(t => !t.immunities.includes('taunt') && !t.effects.some(e => e.type === 'taunt'))) continue;
    if (id === 'arenBreak' && foes[0]?.effects.some(e => e.type === 'defenseDown')) continue;
    if (id === 'arenBuff' && actor.effects.some(e => e.type === 'atkUp')) continue;
    if (id === 'rianaMark' && foes[0]?.effects.some(e => e.type === 'physicalVulnerability')) continue;
    return s;
  }
  return null;
}
function act(battle, actor) {
  // Cooldowns are checked before decrement so N full opportunities are blocked.
  const s = chooseSkill(battle, actor);
  for (const key of Object.keys(actor.cooldowns)) actor.cooldowns[key] = Math.max(0, actor.cooldowns[key] - 1);
  const friends = alive(battle.allies); let killed = false;
  if (s?.type === 'heal') {
    const targets = s.target === 'allAllies' ? friends : [...friends].sort((a,b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0,1);
    for (const target of targets) { heal(battle, actor, target, s.healAtkRatio); applyEffects(battle, target, s.effects, actor); }
  } else if (s?.type === 'shield') shield(battle, friends, actor, s.shieldOwnerMaxHpRatio, s.durationRounds);
  else if (actor.side === 'enemy') {
    const taunt = actor.effects.find(e => e.type === 'taunt' && battle.allies.some(a => a.id === e.source && a.hp > 0));
    const targets = s?.target === 'allAllies' ? friends : [friends.find(a => a.id === taunt?.source) || friends[0]];
    for (const target of targets.filter(Boolean)) damage(battle, actor, target, s?.atkRatio || 1);
  } else {
    const hitCounts = {};
    for (let hit = 0; hit < (s?.hits || 1); hit++) {
      const foes = alive(battle.enemies); if (!foes.length) break;
      const target = s?.hits ? [...foes].sort((a,b) => (hitCounts[a.id] || 0) - (hitCounts[b.id] || 0))[0] : foes[0];
      hitCounts[target.id] = (hitCounts[target.id] || 0) + 1;
      killed = damage(battle, actor, target, s?.atkRatioPerHit || s?.atkRatio || 1) || killed;
      if (target.hp > 0) applyEffects(battle, target, s?.effects, actor);
    }
    applyEffects(battle, actor, s?.selfEffects, actor);
    if (s?.enemyEffects) for (const enemy of alive(battle.enemies)) applyEffects(battle, enemy, s.enemyEffects, actor);
    if (actor.id === 'riana' && killed && alive(battle.enemies).length) damage(battle, actor, alive(battle.enemies)[0], SKILLS.rianaFollowup.atkRatio, false);
  }
  if (s) { const key = s.id || `enemySkill${actor.skills.indexOf(s)}`; actor.cooldowns[key] = s.cooldown; }
  battle.events.push({ type: 'action', actor: actor.id, skill: s?.id || s?.name || 'basicAttack', round: battle.round, wave: battle.waveIndex });
  battle.actionCount++;
}
function endRound(battle) {
  for (const u of [...battle.allies, ...battle.enemies]) {
    for (const e of u.effects) if (e.appliedRound < battle.round) {
      if (e.type === 'regen' && u.hp > 0) u.hp = Math.min(u.maxHp, u.hp + e.healAmount);
      e.remaining--;
    }
    u.effects = u.effects.filter(e => e.remaining > 0);
  }
  battle.round++; battle.queue = []; battle.cursor = 0;
}
export function stepBattle(battle) {
  if (battle.status !== 'active') return battle;
  battle.events = [];
  if (!battle.queue.length) battle.queue = [...alive(battle.allies), ...alive(battle.enemies)].sort((a,b) => b.speed - a.speed || a.id.localeCompare(b.id)).map(u => u.id);
  const id = battle.queue[battle.cursor++], actor = [...battle.allies, ...battle.enemies].find(u => u.id === id);
  if (actor?.hp > 0) act(battle, actor);
  if (!alive(battle.allies).length) battle.status = 'defeat';
  else if (!alive(battle.enemies).length) {
    if (battle.waveIndex + 1 === battle.waves.length) battle.status = 'victory';
    else { // Complete this round's effect clock before replacing enemies; never reset cooldowns/passives.
      endRound(battle); battle.waveIndex++; loadWave(battle);
    }
  } else if (battle.cursor >= battle.queue.length) endRound(battle);
  return battle;
}
export function simulateBattle(stateOrBattle, stageId, options = {}) {
  const battle = stageId == null ? clone(stateOrBattle) : createBattle(stateOrBattle, stageId);
  const limit = options.maxActions || 10000;
  while (battle.status === 'active' && battle.actionCount < limit) stepBattle(battle);
  assert(battle.status !== 'active', 'Combat action limit reached'); return battle;
}
function gainXp(state, id, amount) {
  const c = state.characters[id]; c.xp += amount;
  while (c.level < GAME_CONFIG.level.max) { const need = GAME_CONFIG.level.experiencePerLevel + (c.level - 1) * GAME_CONFIG.level.experienceGrowth; if (c.xp < need) break; c.xp -= need; c.level++; }
}
function recruit(state, ids) { for (const id of ids || []) if (!state.recruited.includes(id)) { state.recruited.push(id); if (state.party.length < GAME_CONFIG.maxPartySize) state.party.push(id); } }
export function settleBattle(state, battle) {
  assert(battle.status !== 'active', 'Battle is unfinished');
  if (state.settledBattles.includes(battle.id)) return false;
  assert(state.battle?.id === battle.id, 'Battle does not belong to this state');
  state.settledBattles.push(battle.id);
  // Runtime-only receipt: keep the existing save schema unchanged.
  const definition = stageById(battle.stageId);
  const firstClear = battle.status === 'victory' && !state.clearedStages.includes(battle.stageId);
  battle.result = { battleId: battle.id, firstClear, rewards: resources(), xp: 0, members: [], firstClearRewards: resources() };
  if (battle.status === 'victory') {
    battle.result.rewards = rewardResources(definition.rewards);
    battle.result.xp = definition.rewards.xp || 0;
    battle.result.members = battle.allies.map(u => u.id);
    if (firstClear) battle.result.firstClearRewards = rewardResources(definition.firstClearRewards);
  }
  if (battle.status === 'victory') {
    const stage = stageById(battle.stageId); addResources(state.resources, rewardResources(stage.rewards));
    if (!state.clearedStages.includes(stage.id)) { state.clearedStages.push(stage.id); addResources(state.resources, rewardResources(stage.firstClearRewards)); recruit(state, stage.recruitOnVictory); }
    for (const u of battle.allies) { gainXp(state, u.id, stage.rewards.xp || 0); state.codex.appearances[u.id] = (state.codex.appearances[u.id] || 0) + 1; }
    for (const [id, count] of Object.entries(battle.kills)) state.codex.kills[id] = (state.codex.kills[id] || 0) + count;
  }
  state.battle = null; return true;
}
export function accrue(state, now = Date.now(), offline = false) {
  assert(Number.isFinite(now) && now >= 0, 'Invalid clock');
  const elapsed = Math.max(0, now - state.accrual.lastAt) / 1000;
  const seconds = offline ? Math.min(elapsed, ACTIVITY_RULES.accrual.offlineMaxSeconds) : elapsed;
  state.accrual.lastAt = Math.max(state.accrual.lastAt, now);
  for (const p of PRODUCTION) {
    const total = (state.accrual.productionRemainders[p.id] || 0) + seconds;
    const count = Math.floor(total / p.intervalSeconds); state.accrual.productionRemainders[p.id] = total % p.intervalSeconds;
    addResources(state.accrual.pending, p.reward, count);
  }
  if (state.dispatch) {
    const d = state.dispatch, total = d.progressSeconds + seconds, count = Math.floor(total / d.durationSeconds);
    d.progressSeconds = total % d.durationSeconds; addResources(state.accrual.pending, d.reward, count);
    for (const id of d.members) state.accrual.pendingXp[id] = (state.accrual.pendingXp[id] || 0) + d.xp * count;
  }
  return clone(state.accrual.pending);
}
export function claimAccrual(state) { const reward = clone(state.accrual.pending); addResources(state.resources, reward); state.accrual.pending = resources(); const xp = clone(state.accrual.pendingXp); for (const [id, amount] of Object.entries(xp)) gainXp(state, id, amount); state.accrual.pendingXp = {}; return { ...reward, xp }; }
export function claimCodex(state, enemyId) {
  assert(ENEMIES[enemyId], 'Unknown enemy');
  if ((state.codex.kills[enemyId] || 0) < GAME_CONFIG.codex.killThreshold || state.codex.claimed.includes(enemyId)) return false;
  state.codex.claimed.push(enemyId); state.codex.sharedAtk += GAME_CONFIG.codex.claimReward.sharedAtk; return true;
}
function cancelBattle(state) { if (state.battle?.status === 'active') { addResources(state.resources, state.battle.cost); state.battle = null; } else if (state.battle) settleBattle(state, state.battle); }

// Explicit field validation: imported JSON must never create NaN stats, fabricated rewards,
// unknown content, prototype-bearing equipment keys, or an imported active combat payout.
export function validateSave(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Save must be an object');
  assert(value.version === SAVE_VERSION, 'Unsupported save version');
  const n = (v, max = Number.MAX_SAFE_INTEGER) => Number.isFinite(v) && v >= 0 && v <= max;
  const integer = (v, max) => n(v, max) && Number.isInteger(v);
  const ids = (list, known, max = known.length) => Array.isArray(list) && list.length <= max && new Set(list).size === list.length && list.every(id => known.includes(id));
  const chars = Object.keys(CHARACTERS), enemies = Object.keys(ENEMIES), stages = STAGES.map(s => s.id);
  const validResources = r => r && Object.keys(r).length === 3 && Object.keys(resources()).every(k => integer(r[k]));
  assert(validResources(value.resources), 'Invalid resources');
  assert(ids(value.recruited, chars) && ids(value.party, chars, GAME_CONFIG.maxPartySize) && value.party.length && value.party.every(id => value.recruited.includes(id)) && value.recruited.includes('eir'), 'Invalid party');
  assert(ids(value.inventory, Object.keys(EQUIPMENT)), 'Invalid inventory');
  assert(ids(value.clearedStages, stages) && value.clearedStages.every(id => id === 1 || value.clearedStages.includes(id - 1)) && ids(value.enteredStages, stages), 'Invalid stage progress');
  for (const id of chars) {
    const c = value.characters?.[id]; assert(c && integer(c.level, GAME_CONFIG.level.max) && c.level >= 1 && integer(c.xp), 'Invalid character level');
    assert(c.equipment && Object.keys(c.equipment).length === 4, 'Invalid equipment slots');
    for (const slot of GAME_CONFIG.equipmentSlots) { const item = c.equipment[slot]; assert(item === null || (EQUIPMENT[item]?.slot === slot && value.inventory.includes(item)), 'Invalid equipment'); }
  }
  const codex = value.codex;
  assert(codex && ids(codex.claimed, enemies) && codex.sharedAtk === codex.claimed.length * GAME_CONFIG.codex.claimReward.sharedAtk, 'Invalid codex reward');
  for (const [map, allowed] of [[codex.kills, enemies], [codex.appearances, chars]]) { assert(map && typeof map === 'object' && !Array.isArray(map), 'Invalid codex'); for (const [id, count] of Object.entries(map)) assert(allowed.includes(id) && integer(count), 'Invalid codex count'); }
  assert(codex.claimed.every(id => codex.kills[id] >= GAME_CONFIG.codex.killThreshold), 'Unqualified codex claim');
  assert(integer(value.nextBattleId) && value.nextBattleId >= 1 && Array.isArray(value.settledBattles) && value.settledBattles.every(id => integer(id) && id < value.nextBattleId) && new Set(value.settledBattles).size === value.settledBattles.length, 'Invalid battle ledger');
  // Export is a quiescent snapshot. Runtime battles are cancelled/refunded in its clone.
  assert(value.battle === null && value.repeat === null, 'Active battles are not accepted in backups');
  assert(value.resumeRepeatStage === null || value.clearedStages.includes(value.resumeRepeatStage), 'Invalid repeat destination');
  const a = value.accrual; assert(a && n(a.lastAt) && validResources(a.pending) && a.productionRemainders && typeof a.productionRemainders === 'object', 'Invalid accrual');
  assert(a.pendingXp && typeof a.pendingXp === 'object' && !Array.isArray(a.pendingXp), 'Invalid pending experience'); for (const [id, amount] of Object.entries(a.pendingXp)) assert(chars.includes(id) && integer(amount), 'Invalid pending experience');
  for (const [id, remainder] of Object.entries(a.productionRemainders)) { const p = PRODUCTION.find(p => p.id === id); assert(p && n(remainder) && remainder < p.intervalSeconds, 'Invalid production remainder'); }
  if (value.dispatch !== null) {
    const d = value.dispatch, rule = ACTIVITY_RULES.dispatch;
    assert(d && value.clearedStages.includes(rule.unlockAfterStage) && value.clearedStages.includes(d.stageId) && ids(d.members, chars) && d.members.length && d.members.every(id => value.recruited.includes(id)), 'Invalid dispatch');
    assert(integer(d.durationSeconds, rule.baseDurationSeconds * 100) && d.durationSeconds >= rule.minimumDurationSeconds && n(d.progressSeconds) && d.progressSeconds < d.durationSeconds, 'Invalid dispatch time');
    const expected = rewardResources(stageById(d.stageId).rewards); for (const k of Object.keys(expected)) expected[k] = Math.floor(expected[k] * rule.rewardRatio);
    assert(validResources(d.reward) && Object.keys(expected).every(k => expected[k] === d.reward[k]) && d.xp === Math.floor((stageById(d.stageId).rewards.xp || 0) * rule.rewardRatio), 'Invalid dispatch reward');
  }
  // Return only known fields so unknown JSON properties do not survive restoration.
  const clean = createInitialState(a.lastAt);
  for (const key of Object.keys(clean)) clean[key] = clone(value[key]);
  return clean;
}
export function exportSave(state) {
  const snapshot = clone(state); snapshot.resumeRepeatStage = snapshot.repeat?.stageId || snapshot.resumeRepeatStage;
  cancelBattle(snapshot); snapshot.repeat = null;
  return JSON.stringify(validateSave(snapshot));
}
export function restoreSave(json, now = Date.now()) { assert(typeof json === 'string' && json.length <= 2000000, 'Invalid backup input'); const state = validateSave(JSON.parse(json)); accrue(state, now, true); return state; }

export function createGameEngine(options = {}) {
  const clock = options.now || (() => Date.now());
  let state = options.state ? validateSave(options.state) : createInitialState(clock());
  let lastCombatAt = clock(), displaySpeed = 1, saveError = null;
  const start = (stageId, repeating = false) => {
    assert(!state.battle, 'Only one combat may be active'); const stage = stageById(stageId); assert(stage, 'Unknown stage');
    assert(!stage.unlockAfterStage || state.clearedStages.includes(stage.unlockAfterStage), 'Stage locked');
    if (repeating) assert(state.clearedStages.includes(stage.id), 'Repeat requires cleared destination');
    const cost = stage.entryCost; for (const [key, value] of Object.entries(cost)) assert(state.resources[key] >= value, 'Insufficient entry resources');
    let story = [];
    if (!state.enteredStages.includes(stage.id)) { state.enteredStages.push(stage.id); recruit(state, stage.recruitOnFirstEntry); story = clone(stage.story); }
    addResources(state.resources, cost, -1);
    state.battle = createBattle(state, stage.id, state.nextBattleId++); lastCombatAt = clock(); return { battle: state.battle, story };
  };
  const step = () => {
    if (!state.battle && state.repeat) start(state.repeat.stageId, true);
    if (!state.battle) return null;
    const battle = state.battle; stepBattle(battle);
    if (battle.status !== 'active') { settleBattle(state, battle); if (battle.status === 'defeat') state.repeat = null; }
    return battle;
  };
  const api = {
    get state() { return state; }, get displaySpeed() { return displaySpeed; }, get saveError() { return saveError; }, policy: ENGINE_POLICY,
    startBattle: stageId => { assert(!state.repeat, 'Stop repeat before manual combat'); return start(stageId); }, step,
    setDisplaySpeed: speed => { assert([1,2,4].includes(speed), 'Unsupported display speed'); displaySpeed = speed; },
    tick(now = clock()) { accrue(state, now, false); const elapsedCombat = Math.max(0, now - lastCombatAt); const steps = Math.floor(elapsedCombat / 1000); for (let i = 0; i < steps && (state.battle || state.repeat); i++) step(); lastCombatAt = now - elapsedCombat % 1000; return state; },
    startRepeat(stageId) { assert(!state.repeat && !state.battle, 'Only one online combat loop'); assert(state.clearedStages.includes(Number(stageId)), 'Repeat requires cleared destination'); const started = start(stageId, true); state.repeat = { stageId: Number(stageId) }; state.resumeRepeatStage = null; return started; },
    stopRepeat() { state.repeat = null; state.resumeRepeatStage = null; cancelBattle(state); },
    disconnect(now = clock()) { accrue(state, now, false); state.resumeRepeatStage = state.repeat?.stageId || state.resumeRepeatStage; state.repeat = null; cancelBattle(state); lastCombatAt = now; },
    reconnect(now = clock()) { accrue(state, now, true); lastCombatAt = now; return state.resumeRepeatStage; },
    setParty(ids) { assert(!state.battle, 'Party changes require no active battle'); assert(Array.isArray(ids) && ids.length && ids.length <= GAME_CONFIG.maxPartySize && new Set(ids).size === ids.length && ids.every(id => state.recruited.includes(id)), 'Invalid party'); state.party = [...ids]; },
    equip(id, slot, itemId) { assert(state.recruited.includes(id) && GAME_CONFIG.equipmentSlots.includes(slot), 'Invalid equipment target'); assert(itemId === null || (state.inventory.includes(itemId) && EQUIPMENT[itemId]?.slot === slot), 'Invalid equipment'); state.characters[id].equipment[slot] = itemId; },
    buyEquipment(itemId) { const item = EQUIPMENT[itemId]; assert(item, 'Unknown equipment'); if (state.inventory.includes(itemId)) return false; assert(state.resources.gold >= item.price, 'Insufficient gold'); state.resources.gold -= item.price; state.inventory.push(itemId); return true; },
    startDispatch(stageId, members = state.party, now = clock()) {
      accrue(state, now, false); const r = ACTIVITY_RULES.dispatch;
      assert(!state.dispatch, 'Only one dispatch slot'); assert(state.clearedStages.includes(r.unlockAfterStage) && state.clearedStages.includes(Number(stageId)), 'Dispatch locked');
      assert(Array.isArray(members) && members.length && new Set(members).size === members.length && members.every(id => state.recruited.includes(id)), 'Invalid dispatch party');
      const power = members.reduce((total,id) => { const s = calculateStats(state,id); return total + s.hp / 10 + s.atk * 2 + s.defense; },0);
      const reward = rewardResources(stageById(stageId).rewards); for (const key of Object.keys(reward)) reward[key] = Math.floor(reward[key] * r.rewardRatio);
      state.dispatch = { stageId: Number(stageId), members: [...members], durationSeconds: Math.max(r.minimumDurationSeconds, Math.ceil(r.baseDurationSeconds * 100 / Math.max(1,power))), progressSeconds: 0, reward, xp: Math.floor((stageById(stageId).rewards.xp || 0) * r.rewardRatio) }; return clone(state.dispatch);
    },
    stopDispatch(now = clock()) { accrue(state, now, false); state.dispatch = null; },
    accrue: (now = clock(), offline = false) => accrue(state, now, offline), claimRewards: () => claimAccrual(state), claimCodex: id => claimCodex(state,id),
    exportSave: () => exportSave(state),
    importSave(json, now = clock()) { const restored = restoreSave(json,now); state = restored; lastCombatAt = now; saveError = null; return state; },
    save(storage = globalThis.localStorage) { try { assert(storage?.setItem, 'Storage unavailable'); storage.setItem(SAVE_KEY, exportSave(state)); saveError = null; return true; } catch (error) { saveError = error.message; return false; } },
    load(storage = globalThis.localStorage, now = clock()) { try { assert(storage?.getItem, 'Storage unavailable'); const json = storage.getItem(SAVE_KEY); if (!json) return { ok: true, found: false }; const restored = restoreSave(json,now); state = restored; lastCombatAt = now; saveError = null; return { ok: true, found: true, resumeRepeatStage: state.resumeRepeatStage }; } catch (error) { saveError = error.message; return { ok: false, error: saveError, preservedState: true }; } },
  };
  return api;
}
export const createEngine = createGameEngine;
export default createGameEngine;


