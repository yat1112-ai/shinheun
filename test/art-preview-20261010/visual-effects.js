// Display-only projection of the engine's latest event batch. Never advances combat.
export function feedbackFor(battle, skillName = id => id) {
  const feedback = new Map();
  const get = id => {
    if (!feedback.has(id)) feedback.set(id, { classes: new Set(), labels: [] });
    return feedback.get(id);
  };
  for (const event of battle?.events || []) {
    if (event.type === 'action' && event.actor) {
      const item = get(event.actor);
      item.classes.add('gp05-turn');
      item.classes.add('gp05-attack');
      item.labels.push(skillName(event.skill));
    } else if (event.target && ['damage', 'heal', 'revive'].includes(event.type)) {
      const item = get(event.target);
      if (event.type === 'revive') {
        item.classes.add('gp05-heal'); item.labels.push('부활');
      } else if (Number.isFinite(event.amount) && event.amount > 0) {
        item.classes.add(event.type === 'damage' ? 'gp05-damage' : 'gp05-heal');
        item.labels.push(`${event.type === 'damage' ? '−' : '+'}${event.amount}`);
      }
      if (event.type === 'damage' && Number.isFinite(event.absorbed) && event.absorbed > 0) {
        item.classes.add('gp05-block'); item.labels.push(`실드 ${event.absorbed}`);
      }
    }
  }
  // Multi-hit/AOE stays bounded: at most two text rows per field unit.
  for (const item of feedback.values()) item.labels = item.labels.slice(0, 2);
  return feedback;
}

export function createVisualEffects({ skillName } = {}) {
  let seen = null;
  return {
    reset() { seen = null; },
    render(root, battle, { fresh = false, speed = 1 } = {}) {
      if (!battle || !root) { seen = null; return; }
      const units = new Map([...root.querySelectorAll('[data-unit]')].map(el => [el.dataset.unit, el]));
      for (const unit of [...battle.allies, ...battle.enemies]) {
        const el = units.get(unit.id);
        if (!el) continue;
        el.classList.toggle('gp05-shield', unit.hp > 0 && unit.effects.some(e => e.type === 'shield' && e.amount > 0));
      }
      const key = `${battle.id}:${battle.actionCount}:${battle.waveIndex}:${battle.status}`;
      if (!fresh || seen === key) return;
      seen = key;
      const duration = Math.round(640 / Math.min(4, Math.max(1, speed)));
      for (const [id, item] of feedbackFor(battle, skillName)) {
        const el = units.get(id);
        if (!el || !item.classes.size) continue;
        el.style.setProperty('--gp05-duration', `${duration}ms`);
        el.classList.add(...item.classes);
        const label = root.ownerDocument.createElement('span');
        label.className = 'gp05-feedback';
        // Decorative duplicate of the real HP/status/log information; no live-region spam.
        label.setAttribute('aria-hidden', 'true');
        label.textContent = item.labels.join(' · ');
        el.querySelector('.sprite')?.append(label);
        setTimeout(() => {
          el.classList.remove(...item.classes); label.remove();
        }, duration);
      }
    }
  };
}
