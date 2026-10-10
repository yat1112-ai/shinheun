// Display-only projection of real engine events; never advances combat.
export const FX_LIMIT = 24;
export const fxDuration = speed => Math.round(760 / Math.min(4, Math.max(1, Number(speed) || 1)));
export function feedbackFor(battle, skillName = id => id) {
  const feedback = new Map();
  const get = id => {
    if (!feedback.has(id)) feedback.set(id, { classes: new Set(), labels: [], effects: [] });
    return feedback.get(id);
  };
  const events = battle?.events || [];
  for (const event of events) {
    if (event.type === 'action' && event.actor) {
      const item = get(event.actor);
      item.classes.add('gp05-turn');
      const offensive = events.some(e => e.type === 'damage' && e.source === event.actor);
      item.classes.add(offensive ? 'gp05-attack' : 'gp05-cast');
      if (offensive) item.effects.push(event.actor === 'riana' ? 'dual-slash' : 'slash');
      if (event.skill === 'cleaShield') {
        for (const u of battle.allies || []) if (u.hp > 0 && u.effects.some(e => e.type === 'shield' && e.source === event.actor && e.amount > 0)) get(u.id).effects.push('shield');
      }
      if (event.skill === 'cleaTaunt') item.effects.push('taunt');
      // Skill names already appear in HUD/log; keep number lanes clear.
      void skillName;
    } else if (event.target && ['damage', 'heal', 'revive'].includes(event.type)) {
      const item = get(event.target);
      if (event.type === 'revive') {
        item.classes.add('gp05-heal'); item.effects.push('revive'); item.labels.push('부활');
      } else if (Number.isFinite(event.amount) && event.amount > 0) {
        const damage = event.type === 'damage';
        item.classes.add(damage ? 'gp05-damage' : 'gp05-heal');
        item.labels.push(`${damage ? '−' : '+'}${event.amount}`);
        item.effects.push(damage ? 'spark' : 'heal');
      }
      if (event.type === 'damage' && Number.isFinite(event.absorbed) && event.absorbed > 0) {
        item.classes.add('gp05-block'); item.effects.push('shield'); item.labels.push(`방어 ${event.absorbed}`);
      }
    }
  }
  for (const item of feedback.values()) {
    item.labels = item.labels.slice(0, 4);
    item.effects = [...new Set(item.effects)].slice(0, 2);
  }
  return feedback;
}
export function createVisualEffects({ skillName, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let seen = null;
  const pending = new Map();
  const cleanup = () => {
    for (const [timer, remove] of pending) { cancel(timer); remove(); }
    pending.clear();
  };
  return {
    reset() { cleanup(); seen = null; },
    dispose() { cleanup(); seen = null; },
    render(root, battle, { fresh = false, speed = 1 } = {}) {
      for (const [timer, remove] of pending) if (!remove.host.isConnected) { cancel(timer); remove(); pending.delete(timer); }
      if (!battle || !root) { cleanup(); seen = null; return; }
      const units = new Map([...root.querySelectorAll('[data-unit]')].map(el => [el.dataset.unit, el]));
      for (const unit of [...battle.allies, ...battle.enemies]) {
        const el = units.get(unit.id);
        if (!el) continue;
        el.classList.toggle('gp05-shield', unit.hp > 0 && unit.effects.some(e => e.type === 'shield' && e.amount > 0));
        el.classList.toggle('gp05-taunted', unit.hp > 0 && unit.effects.some(e => e.type === 'taunt'));
      }
      const key = `${battle.id}:${battle.actionCount}:${battle.waveIndex}:${battle.status}`;
      if (!fresh || seen === key) return;
      cleanup(); seen = key;
      const duration = fxDuration(speed);
      let count = 0;
      const feedback = feedbackFor(battle, skillName);
      for (const [id, item] of feedback) {
        const el = units.get(id), sprite = el?.querySelector('.sprite');
        if (!sprite) continue;
        el.style.setProperty('--gp05-duration', `${duration}ms`);
        el.classList.add(...item.classes);
        const nodes = [];
        for (const effect of item.effects) {
          if (count >= FX_LIMIT) break;
          const node = root.ownerDocument.createElement('span');
          node.className = `combat-fx fx-${effect}`; node.setAttribute('aria-hidden', 'true');
          sprite.append(node); nodes.push(node); count++;
        }
        for (const [lane, text] of item.labels.entries()) {
          if (count >= FX_LIMIT) break;
          const node = root.ownerDocument.createElement('span');
          node.className = `gp05-feedback ${text.startsWith('+') || text === '부활' ? 'fx-number-heal' : text.startsWith('방어') ? 'fx-number-block' : 'fx-number-damage'}`;
          node.style.setProperty('--fx-lane', lane); node.setAttribute('aria-hidden', 'true'); node.textContent = text;
          el.append(node); nodes.push(node); count++;
        }
        const remove = () => { el.classList.remove(...item.classes); nodes.forEach(n => n.remove()); };
        remove.host = el;
        const timer = schedule(() => { remove(); pending.delete(timer); }, duration); pending.set(timer, remove);
      }
      if ([...feedback.values()].some(item => item.classes.has('gp05-damage'))) {
        const ground = root.querySelector('.ground');
        if (ground) {
          ground.style.setProperty('--gp05-duration', `${duration}ms`); ground.classList.add('gp05-shake');
          const remove = () => ground.classList.remove('gp05-shake'); remove.host = ground;
          const timer = schedule(() => { remove(); pending.delete(timer); }, duration); pending.set(timer, remove);
        }
      }
    }
  };
}
