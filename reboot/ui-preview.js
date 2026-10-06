/* UI 배치 미리보기 (1단계) - 스케일 맞춤, 전체화면, 가로 고정 시도, 장면 전환.
 * 외부 의존 없음. localStorage/기존 저장 데이터에 접근하지 않는다.
 * 전역은 window.UIPreview 하나만 사용하며, T4/T5는 UIPreview.onInit(fn)으로 확장한다. */
(function () {
  'use strict';

  var LOGICAL_W = 1600;
  var LOGICAL_H = 900;
  var SCENES = ['village', 'battle'];

  var initHooks = [];
  var sceneHooks = [];
  var resizeHooks = [];
  var inited = false;
  var state = { scene: 'village', scale: 1, offsetX: 0, offsetY: 0, portrait: false, fullscreen: false };
  var el = {};
  var noticeTimer = 0;

  function $(id) { return document.getElementById(id); }

  function runHooks(list, arg) {
    list.slice().forEach(function (fn) {
      try { fn(arg, api); } catch (e) { if (window.console) console.error('[UIPreview] hook error', e); }
    });
  }

  /* ---------- 스케일 / 오프셋 ---------- */
  function measure() {
    var vv = window.visualViewport;
    var w = vv ? vv.width : window.innerWidth;
    var h = vv ? vv.height : window.innerHeight;
    // #viewport는 안전 영역만큼 안쪽으로 들어가 있으므로 그 차이를 뺀다.
    if (el.viewport) {
      w -= Math.max(0, window.innerWidth - el.viewport.clientWidth);
      h -= Math.max(0, window.innerHeight - el.viewport.clientHeight);
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function applyLayout() {
    if (!el.stage) return;
    var m = measure();
    var scale = Math.min(m.w / LOGICAL_W, m.h / LOGICAL_H);
    var ox = Math.max(0, (m.w - LOGICAL_W * scale) / 2);
    var oy = Math.max(0, (m.h - LOGICAL_H * scale) / 2);
    state.scale = scale;
    state.offsetX = ox;
    state.offsetY = oy;
    var rs = document.documentElement.style;
    rs.setProperty('--scale', String(scale));
    document.documentElement.classList.toggle('compact-landscape', m.w >= m.h && scale < 0.65);
    rs.setProperty('--offset-x', ox + 'px');
    rs.setProperty('--offset-y', oy + 'px');

    var portrait = m.h > m.w;
    state.portrait = portrait;
    document.documentElement.classList.toggle('is-portrait', portrait);
    if (el.guard) {
      el.guard.hidden = !portrait;
      el.guard.classList.toggle('show', portrait);
    }
    runHooks(resizeHooks, state);
  }

  /* ---------- 전체화면 ---------- */
  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function fsSupported() {
    var d = document.documentElement;
    return !!(d.requestFullscreen || d.webkitRequestFullscreen);
  }

  function requestFs() {
    var d = document.documentElement;
    try {
      var r = d.requestFullscreen ? d.requestFullscreen() : d.webkitRequestFullscreen();
      return Promise.resolve(r);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function exitFs() {
    try {
      var r = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen();
      return Promise.resolve(r);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function updateFsUi() {
    var on = !!fsElement();
    state.fullscreen = on;
    if (el.fsBtn) el.fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (el.fsLabel) el.fsLabel.textContent = on ? '전체화면 종료' : '전체화면';
    if (el.fsIcon) el.fsIcon.textContent = on ? '⤢' : '⛶';
    if (el.fsBtn) el.fsBtn.setAttribute('aria-label', on ? '전체화면 종료' : '전체화면 시작');
    if (el.battleFsBtn) el.battleFsBtn.textContent = on ? '⤢ 전체화면 종료' : '⛶ 전체화면';
    if (el.fsStatus) el.fsStatus.textContent = on ? '전체화면 켜짐' : '전체화면 꺼짐';
    var gx = $('btn-guard-exit-fs');
    if (gx) gx.hidden = !on;
  }

  function showNotice(text, ms) {
    if (!el.notice) return;
    el.noticeText.textContent = text;
    el.notice.hidden = false;
    // 세로 가드가 stage 안내를 덮으므로 가드가 보이는 동안 가드 안내 영역에도 표시한다.
    if (el.guard && el.guidance && getComputedStyle(el.guard).display !== 'none') showGuidance(text);
    clearTimeout(noticeTimer);
    if (ms) noticeTimer = setTimeout(hideNotice, ms);
  }

  function hideNotice() {
    clearTimeout(noticeTimer);
    if (el.notice) el.notice.hidden = true;
  }

  function showGuidance(text) {
    if (!el.guidance) return;
    el.guidance.textContent = text;
    el.guidance.hidden = false;
  }

  function unsupportedMessage() {
    return '이 브라우저는 전체화면 API를 지원하지 않습니다(iPhone/iOS 등). ' +
      '공유 메뉴의 "홈 화면에 추가"로 실행하거나, 기기를 직접 가로로 돌려 이 화면 그대로 계속 사용할 수 있습니다.';
  }

  function toggleFullscreen() {
    if (fsElement()) {
      exitFs().catch(function () {
        showNotice('전체화면을 종료하지 못했습니다. 브라우저의 종료 방법(ESC 등)을 사용해 주세요.', 5000);
      }).then(updateFsUi);
      return;
    }
    if (!fsSupported()) {
      showNotice(unsupportedMessage(), 8000);
      return;
    }
    requestFs().then(updateFsUi, function () {
      updateFsUi();
      showNotice('전체화면 전환이 거부되었습니다. 이 상태로도 계속 사용할 수 있습니다.', 5000);
    });
  }

  // 세로 오버레이 버튼: 사용자 제스처 안에서 requestFullscreen -> 가로 고정 시도.
  function startFullscreenFromGuard() {
    var rotateHint = '기기를 직접 가로로 돌려 주세요. 자동 회전은 기기·브라우저에 따라 되지 않을 수 있습니다. ' +
      '회전 후에는 이 화면 그대로 계속 사용할 수 있습니다.';
    if (!fsSupported()) {
      showGuidance(unsupportedMessage() + ' ' + rotateHint);
      return;
    }
    requestFs().then(function () {
      updateFsUi();
      var o = window.screen && window.screen.orientation;
      if (!o || typeof o.lock !== 'function') {
        showGuidance('이 브라우저는 가로 고정을 지원하지 않습니다. ' + rotateHint);
        return;
      }
      var p;
      try { p = Promise.resolve(o.lock('landscape')); } catch (e) { p = Promise.reject(e); }
      return p.then(function () {
        // 잠금 요청이 받아들여졌을 뿐, 실제 회전은 보장되지 않는다.
        showGuidance('가로 고정을 요청했습니다. 화면이 돌아가지 않으면 기기를 직접 가로로 돌려 주세요.');
      }, function () {
        showGuidance('가로 고정에 실패했습니다. ' + rotateHint);
      });
    }, function () {
      updateFsUi();
      showGuidance('전체화면을 시작하지 못했습니다. ' + rotateHint);
    }).then(applyLayout);
  }

  /* ---------- 장면 전환 ---------- */
  function setScene(name) {
    if (SCENES.indexOf(name) < 0) return false;
    var prev = state.scene;
    state.scene = name;
    SCENES.forEach(function (id) {
      var s = $(id);
      if (s) s.classList.toggle('active', id === name);
    });
    document.querySelectorAll('#scene-switch [data-scene]').forEach(function (b) {
      var on = b.getAttribute('data-scene') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.documentElement.setAttribute('data-scene', name);
    if (prev !== name) runHooks(sceneHooks, name);
    return true;
  }

  /* ---------- 이벤트 ---------- */
  function onClick(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var sw = t.closest('#scene-switch [data-scene]');
    if (sw) { setScene(sw.getAttribute('data-scene')); return; }
    var act = t.closest('[data-action]');
    if (!act) return;
    switch (act.getAttribute('data-action')) {
      case 'toggle-fullscreen': toggleFullscreen(); break;
      case 'start-fullscreen': startFullscreenFromGuard(); break;
      case 'dismiss-notice': hideNotice(); break;
      case 'settings': showNotice('설정은 이 단계(1/7)에서 구현되지 않은 자리표시입니다. 실제 설정 화면은 이후 단계에서 추가됩니다.', 4000); break;
      case 'return-village': setScene('village'); break;
    }
  }

  function init() {
    if (inited) return;
    inited = true;
    el.viewport = $('viewport');
    el.stage = $('stage');
    el.guard = $('portrait-guard');
    el.guidance = $('rotate-guidance');
    el.fsBtn = $('btn-fullscreen');
    el.fsLabel = $('fullscreen-label');
    el.fsIcon = $('fullscreen-icon');
    el.battleFsBtn = $('btn-battle-fullscreen');
    el.notice = $('fullscreen-notice');
    el.noticeText = $('fullscreen-notice-text');

    // 항상 보이는 전체화면 상태 라벨(HTML에 없으므로 버튼 옆에 생성)
    if (el.fsBtn && el.fsBtn.parentNode) {
      el.fsStatus = document.createElement('span');
      el.fsStatus.id = 'fullscreen-status';
      el.fsStatus.className = 'badge';
      el.fsStatus.setAttribute('role', 'status');
      el.fsBtn.parentNode.insertBefore(el.fsStatus, el.fsBtn.nextSibling);
    }

    document.addEventListener('click', onClick);
    window.addEventListener('resize', applyLayout);
    window.addEventListener('orientationchange', function () {
      applyLayout();
      setTimeout(applyLayout, 250); // 일부 브라우저는 회전 직후 크기가 늦게 갱신된다.
    });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', applyLayout);
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (n) {
      document.addEventListener(n, function () { updateFsUi(); applyLayout(); });
    });

    updateFsUi();
    applyLayout();
    setScene(state.scene);
    runHooks(initHooks, state);
  }

  /* ---------- 공개 API ---------- */
  var api = {
    LOGICAL_WIDTH: LOGICAL_W,
    LOGICAL_HEIGHT: LOGICAL_H,
    state: state,
    // init 이후 호출 시 즉시 실행되므로 T4/T5는 로드 순서와 무관하게 등록 가능.
    onInit: function (fn) {
      if (typeof fn !== 'function') return;
      if (inited) { runHooks([fn]); } else { initHooks.push(fn); }
    },
    onSceneChange: function (fn) { if (typeof fn === 'function') sceneHooks.push(fn); },
    onResize: function (fn) { if (typeof fn === 'function') resizeHooks.push(fn); },
    setScene: setScene,
    getScene: function () { return state.scene; },
    toggleFullscreen: toggleFullscreen,
    showNotice: showNotice,
    hideNotice: hideNotice,
    relayout: applyLayout
  };

  window.UIPreview = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ---------- 전투 화면 상호작용 (T4) ----------
 * 표시 전용 데모. 전투 판정/저장/클라우드 로직 없음. 수치는 모두 배치 점검용 임시값.
 * 설명 문구는 BRIEF.md 요약만 사용하며, 요약에 없는 항목은 '미정'으로 표기한다. */
(function () {
  'use strict';

  var UNDECIDED = '설명 미정(BRIEF.md에 확정 문구 없음)';

  // pal: 아군 팔레트 번호(CSS pal-N), pose: 임시 초상화 자세 번호
  var ROSTER = [
    {
      id: 'eir', name: '에이르', pal: 1, pose: 1, hp: 100, maxHp: 100,
      statuses: [{ icon: '✚', label: '지속회복(시안)' }],
      basic: { title: '기본', body: '라운드마다 자동으로 수행하는 기본 행동. 세부 내용은 ' + UNDECIDED + '.' },
      skills: [
        { title: '스킬1', icon: '✚', body: '단일회복 + 지속회복.', cd: 0 },
        { title: '스킬2', icon: '❖', body: '전체회복.', cd: 2 }
      ],
      passive: { title: '패시브', body: '본인 생존 시 다른 동료 1회 저체력 부활(웨이브 간 초기화 없음).' }
    },
    {
      id: 'aren', name: '아렌', pal: 0, pose: 0, hp: 82, maxHp: 120,
      statuses: [{ icon: '▲', label: '자기버프(시안)' }],
      basic: { title: '기본', body: '강한 물리 단일 공격.' },
      skills: [
        { title: '스킬1', icon: '⚔', body: '공격 + 방어감소.', cd: 1 },
        { title: '스킬2', icon: '✦', body: '공격 + 자기버프.', cd: 0 }
      ],
      passive: { title: '패시브', body: '동일 대상 집중(상한/대상 변경 시 리셋).' }
    },
    {
      id: 'liana', name: '리아나', pal: 2, pose: 2, hp: 64, maxHp: 90,
      statuses: [],
      basic: { title: '기본', body: '라운드마다 자동으로 수행하는 기본 행동. 세부 내용은 ' + UNDECIDED + '.' },
      skills: [
        { title: '스킬1', icon: '✶', body: '6타 분산 난무(고르게 배분, 단일 적은 전부, 사망 시 재배분).', cd: 0 },
        { title: '스킬2', icon: '◎', body: '단일공격 + 물리피해 표식.', cd: 3 }
      ],
      passive: { title: '패시브', body: '처치 후 추가타 1회(시안).' }
    },
    {
      id: 'clea', name: '클레아', pal: 3, pose: 3, hp: 130, maxHp: 140,
      statuses: [{ icon: '☗', label: '물리피해감소 50% 임시' }, { icon: '!', label: '도발' }],
      basic: { title: '기본', body: '라운드마다 자동으로 수행하는 기본 행동. 세부 내용은 ' + UNDECIDED + '.' },
      skills: [
        { title: '스킬1', icon: '☗', body: '단일공격 + 적 전체 도발(면역 적 제외) + 본인 물리피해감소 50% 임시.', cd: 2 },
        { title: '스킬2', icon: '◍', body: '전체보호막. 광역은 아군 전체에 남음.', cd: 0 }
      ],
      passive: { title: '패시브', body: '임시 보호 보조(임시 표기).' }
    },
    {
      id: 'temp', name: '임시 동료', pal: 4, pose: 4, hp: 20, maxHp: 100,
      statuses: [{ icon: '?', label: '상태 미정', debuff: true }],
      basic: { title: '기본', body: UNDECIDED + '. 5번째 슬롯 데이터 확정 전 자리 표시.' },
      skills: [
        { title: '스킬1', icon: '?', body: UNDECIDED + '.', cd: 0 },
        { title: '스킬2', icon: '?', body: UNDECIDED + '.', cd: 0 }
      ],
      passive: { title: '패시브', body: UNDECIDED + '.' }
    }
  ];

  // 파티 인원별 사용 칸(카드/아군 슬롯 공통). 가운데부터 채워 겹침 점검이 쉽도록 한다.
  var LAYOUTS = { 1: [2], 3: [1, 2, 3], 5: [0, 1, 2, 3, 4] };
  var ENEMY_PALS = ['pal-e0', 'pal-e1', 'pal-e2', 'pal-e0', 'pal-e1'];
  var TABS = ['basic', 'skill1', 'skill2', 'passive'];

  var ui = { size: 5, selected: -1, tab: 'basic', speed: 1, effect: 'clear' };
  var dom = {};
  var battleApi;

  function $(id) { return document.getElementById(id); }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function memberAt(cell) {
    var cells = LAYOUTS[ui.size];
    var i = cells.indexOf(cell);
    return i < 0 ? null : ROSTER[i];
  }

  function hpBar(m) {
    var bar = node('div', 'hp-bar');
    var pct = Math.max(0, Math.min(100, Math.round(m.hp / m.maxHp * 100)));
    var fill = node('i');
    fill.style.setProperty('--hp', pct + '%');
    bar.appendChild(fill);
    if (pct <= 30) bar.classList.add('low');
    return bar;
  }

  function skillLabel(m, i) {
    var s = m.skills[i];
    return s.title + ' ' + s.body + (s.cd > 0 ? ' (쿨다운 ' + s.cd + '턴 남음)' : ' (사용 가능)');
  }

  /* ---------- 렌더 ---------- */
  function renderCard(cell) {
    var slot = $('card-' + cell);
    if (!slot) return;
    var m = memberAt(cell);
    slot.textContent = '';
    slot.classList.toggle('empty', !m);
    slot.classList.toggle('selected', !!m && ROSTER.indexOf(m) === ui.selected);
    slot.classList.toggle('dead', !!m && m.hp <= 0);
    if (!m) return;

    var card = node('button', 'card');
    card.type = 'button';
    card.setAttribute('data-char', m.id);
    card.setAttribute('aria-label', m.name + ' HP ' + m.hp + '/' + m.maxHp + ' 카드 선택');
    if (ROSTER.indexOf(m) === ui.selected) card.classList.add('selected');

    var portrait = node('div', 'temp-portrait pose-' + m.pose + ' pal-' + m.pal);
    portrait.setAttribute('data-temp-portrait', 'true');
    portrait.appendChild(node('span', 'temp-label', '임시 초상화 - 최종 아트 아님'));
    card.appendChild(portrait);

    var info = node('div', 'card-info');
    info.appendChild(node('div', 'card-name', m.name));
    info.appendChild(hpBar(m));
    info.appendChild(node('span', 'card-hp-text', m.hp + '/' + m.maxHp));

    var st = node('div', 'status-icons');
    m.statuses.forEach(function (s) {
      var ic = node('span', 'status-icon' + (s.debuff ? ' debuff' : ''), s.icon);
      ic.title = s.label;
      ic.setAttribute('role', 'img');
      ic.setAttribute('aria-label', s.label);
      st.appendChild(ic);
    });
    info.appendChild(st);

    var sk = node('div', 'skill-icons');
    m.skills.forEach(function (s, i) {
      var b = node('span', 'skill-icon' + (s.cd > 0 ? ' on-cd' : ''), s.icon);
      b.setAttribute('data-skill-index', String(i));
      b.setAttribute('role', 'img');
      b.setAttribute('aria-label', skillLabel(m, i));
      if (s.cd > 0) b.appendChild(node('span', 'cd-badge', String(s.cd)));
      sk.appendChild(b);
    });
    var p = node('span', 'passive-marker', 'P');
    p.setAttribute('role', 'img');
    p.setAttribute('aria-label', '패시브 있음');
    sk.appendChild(p);
    info.appendChild(sk);
    card.appendChild(info);
    slot.appendChild(card);
  }

  function renderAllySlot(cell) {
    var slot = $('ally-slot-' + cell);
    if (!slot) return;
    var m = memberAt(cell);
    var holder = slot.querySelector('.unit-holder');
    holder.textContent = '';
    slot.classList.toggle('empty', !m);
    slot.classList.toggle('selected', !!m && ROSTER.indexOf(m) === ui.selected);
    if (m) {
      slot.setAttribute('data-char', m.id);
      var tag = node('div', 'unit-tag');
      tag.appendChild(node('span', null, m.name));
      tag.appendChild(hpBar(m));
      holder.appendChild(tag);
      holder.appendChild(node('div', 'sd-unit pal-' + m.pal));
    } else {
      slot.removeAttribute('data-char');
    }
  }

  function renderEnemySlot(cell) {
    var slot = $('enemy-slot-' + cell);
    if (!slot) return;
    var holder = slot.querySelector('.unit-holder');
    holder.textContent = '';
    var tag = node('div', 'unit-tag');
    tag.appendChild(node('span', null, '임시 적 ' + (cell + 1)));
    tag.appendChild(hpBar({ hp: 100, maxHp: 100 }));
    holder.appendChild(tag);
    holder.appendChild(node('div', 'sd-unit ' + ENEMY_PALS[cell]));
  }

  function renderParty() {
    for (var c = 0; c < 5; c++) {
      renderCard(c);
      renderAllySlot(c);
    }
    document.querySelectorAll('#party-size-toggle [data-party-size]').forEach(function (b) {
      var on = Number(b.getAttribute('data-party-size')) === ui.size;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderEffects();
  }

  function renderPanel() {
    var m = ROSTER[ui.selected];
    if (!m) { dom.panel.hidden = true; return; }
    dom.panel.hidden = false;
    $('skill-panel-name').textContent = m.name;
    dom.panel.querySelectorAll('[data-skill-tab]').forEach(function (b) {
      var on = b.getAttribute('data-skill-tab') === ui.tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var d, meta = '';
    if (ui.tab === 'basic') d = m.basic;
    else if (ui.tab === 'passive') { d = m.passive; meta = '패시브 · 자동 적용'; }
    else {
      var s = m.skills[ui.tab === 'skill1' ? 0 : 1];
      d = s;
      meta = (s.cd > 0 ? '남은 쿨다운 ' + s.cd + '턴' : '사용 가능') + ' · 쿨다운 수치는 표시용 임시값';
    }
    $('skill-desc-title').textContent = d.title;
    $('skill-desc-body').textContent = d.body;
    $('skill-desc-meta').textContent = meta;
  }

  function renderSelection() {
    renderParty();
    renderPanel();
  }

  function renderJin() {
    $('jin-blessing-desc').textContent = '초기 회중시계 가호: 작은 공통 버프(수치 임시). 표시 전용.';
    var list = $('spirit-list');
    list.textContent = '';
    list.appendChild(node('div', null, '신령: 후속 범위 · 자리 표시만'));
  }

  /* ---------- 이펙트 데모 ---------- */
  function anchorPoint(slot, layerRect, scale) {
    var a = slot.querySelector('.feet-anchor');
    var r = a.getBoundingClientRect();
    return {
      x: (r.left + r.width / 2 - layerRect.left) / scale,
      y: (r.top + r.height / 2 - layerRect.top) / scale
    };
  }

  function addFx(layer, kind, pt, floatText, floatCls) {
    var fx = node('div', 'fx fx-' + kind);
    fx.style.left = pt.x + 'px';
    fx.style.top = (pt.y - 70) + 'px'; // 발 기준점에서 몸통 중심으로 올림
    if (floatText) {
      var f = node('span', 'dmg-float' + (floatCls ? ' ' + floatCls : ''), floatText);
      f.style.top = '-60px';
      fx.appendChild(f);
    }
    layer.appendChild(fx);
  }

  function renderEffects() {
    var layer = $('effects-layer');
    if (!layer) return;
    layer.textContent = '';
    document.querySelectorAll('#effect-toggle [data-effect]').forEach(function (b) {
      var eff = b.getAttribute('data-effect');
      var on = eff === ui.effect;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (ui.effect === 'clear' || !document.getElementById('battle').classList.contains('active')) return;
    var scale = battleApi && battleApi.state.scale ? battleApi.state.scale : 1;
    var lr = layer.getBoundingClientRect();
    var enemies = document.querySelectorAll('.enemy-slot');
    var allies = document.querySelectorAll('.ally-slot:not(.empty)');
    if (ui.effect === 'hit') {
      enemies.forEach(function (s) { addFx(layer, 'hit', anchorPoint(s, lr, scale), '-999'); });
    } else if (ui.effect === 'skill') {
      enemies.forEach(function (s) { addFx(layer, 'skill', anchorPoint(s, lr, scale), '-999'); });
      allies.forEach(function (s) { addFx(layer, 'shield', anchorPoint(s, lr, scale)); });
    } else if (ui.effect === 'heal') {
      allies.forEach(function (s) { addFx(layer, 'heal', anchorPoint(s, lr, scale), '+999', 'heal'); });
    }
  }

  /* ---------- 상호작용 ---------- */
  function selectChar(id, tab) {
    var idx = -1;
    ROSTER.forEach(function (m, i) { if (m.id === id) idx = i; });
    if (idx < 0 || idx >= LAYOUTS[ui.size].length) return;
    ui.selected = idx;
    if (tab) ui.tab = tab;
    renderSelection();
  }

  function setPartySize(n) {
    if (!LAYOUTS[n]) return;
    ui.size = n;
    if (ui.selected >= LAYOUTS[n].length) ui.selected = -1;
    renderSelection();
  }

  function setSpeed(n) {
    if (n !== 1 && n !== 2) return; // 1x/2x만 지원, 표시 상태만 변경
    ui.speed = n;
    document.documentElement.setAttribute('data-battle-speed', String(n));
    document.querySelectorAll('#speed-controls [data-speed]').forEach(function (b) {
      var on = Number(b.getAttribute('data-speed')) === n;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function onClick(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    if (!t.closest('#battle')) return;

    if (t.closest('#btn-demo-tools') || t.closest('#btn-demo-close')) {
      var tools = $('demo-controls');
      tools.hidden = !tools.hidden;
      $('btn-demo-tools').setAttribute('aria-expanded', String(!tools.hidden));
      return;
    }

    var size = t.closest('#party-size-toggle [data-party-size]');
    if (size) { setPartySize(Number(size.getAttribute('data-party-size'))); return; }

    var sp = t.closest('#speed-controls [data-speed]');
    if (sp) { setSpeed(Number(sp.getAttribute('data-speed'))); return; }

    var fx = t.closest('#effect-toggle [data-effect]');
    if (fx) {
      var eff = fx.getAttribute('data-effect');
      // 같은 이펙트를 다시 누르면 끈다.
      ui.effect = (eff === ui.effect) ? 'clear' : eff;
      renderEffects();
      return;
    }

    var tab = t.closest('[data-skill-tab]');
    if (tab) {
      ui.tab = tab.getAttribute('data-skill-tab');
      renderPanel();
      return;
    }

    if (t.closest('[data-action="close-skill-panel"]')) {
      ui.selected = -1;
      renderSelection();
      return;
    }

    var card = t.closest('.card[data-char]');
    if (card) {
      var si = t.closest('.skill-icon[data-skill-index]');
      var pm = t.closest('.passive-marker');
      var next = si ? 'skill' + (Number(si.getAttribute('data-skill-index')) + 1) : (pm ? 'passive' : 'basic');
      selectChar(card.getAttribute('data-char'), next);
      return;
    }

    var slot = t.closest('.ally-slot[data-char]');
    if (slot) selectChar(slot.getAttribute('data-char'), 'basic');
  }

  function start(state, api) {
    battleApi = api;
    dom.panel = $('skill-panel');
    renderJin();
    for (var e = 0; e < 5; e++) renderEnemySlot(e);
    setSpeed(1);
    renderSelection();
    document.addEventListener('click', onClick);
    // 전투 장면이 보일 때/크기 변경 시 이펙트 좌표를 다시 계산한다.
    api.onSceneChange(function (name) { if (name === 'battle') renderEffects(); });
    api.onResize(function () { renderEffects(); });
  }

  if (window.UIPreview && typeof window.UIPreview.onInit === 'function') {
    window.UIPreview.onInit(start);
  }
})();

/* ---------- 마을 화면 상호작용 (T5) ----------
 * 표시 전용 데모. 저장/클라우드/타이머 없음. 진행바 값은 고정 임시값.
 * 가정: BRIEF.md에 1챕터 범위의 '사용 가능' 건물 확정 정보가 없어 모험/광산/파견만 available로 둔다.
 *       바꾸려면 아래 VILLAGE_AVAILABILITY 한 곳만 수정한다(UI_LAYOUT_QA.md에 가정으로 기록). */
(function () {
  'use strict';

  var VILLAGE_AVAILABILITY = {
    pocketwatch: 'available',
    mine: 'available',
    dispatch: 'available',
    raid: 'future',
    tower: 'future',
    church: 'future',
    market: 'future'
  };

  var BUILDINGS = {
    pocketwatch: { name: '모험 회중시계', desc: '아트/UI 미리보기입니다. 누르면 임시 전투 배치를 확인합니다.', go: 'battle' },
    mine: { name: '광산', desc: '광석을 모으는 곳. 데모에서는 상세 화면 없이 안내만 표시합니다.' },
    dispatch: { name: '파견소', desc: '동료를 파견 보내는 곳. 진행 현황은 오른쪽 파견 패널에 고정값으로 표시됩니다.' },
    raid: { name: '레이드', desc: '후속 범위 자리 표시입니다.' },
    tower: { name: '탑', desc: '후속 범위 자리 표시입니다.' },
    church: { name: '성당', desc: '후속 범위 자리 표시입니다.' },
    market: { name: '시장', desc: '후속 범위 자리 표시입니다.' }
  };

  var NAV_INFO = {
    companions: '동료: 보유 동료 목록 화면이 들어갈 자리입니다.',
    party: '파티: 1/3/5인 편성 화면이 들어갈 자리입니다.',
    equipment: '장비: 장비 장착 화면이 들어갈 자리입니다.',
    codex: '도감: 수집 도감 화면이 들어갈 자리입니다.',
    bag: '가방: 소지품 화면이 들어갈 자리입니다.'
  };

  // 데모용 고정 진행값(%)
  var DISPATCH_DEMO = [
    { name: '광산 순찰', pct: 65 },
    { name: '숲 탐색', pct: 30 }
  ];
  var REPEAT_DEMO = { pct: 40, text: '온라인 반복 진행 중 · 데모 고정값' };

  var toast, toastTimer = 0, selectedHs = null, navBtn = null;

  function $(id) { return document.getElementById(id); }

  function isAvailable(key) { return VILLAGE_AVAILABILITY[key] === 'available'; }

  function applyAvailability() {
    document.querySelectorAll('#village-map .hotspot[data-building]').forEach(function (b) {
      var key = b.getAttribute('data-building');
      var ok = isAvailable(key);
      b.setAttribute('data-status', ok ? 'available' : 'future');
      b.classList.toggle('available', ok);
      b.classList.toggle('future', !ok);
      // 안내 패널을 열어야 하므로 disabled 대신 aria-disabled만 사용한다.
      if (ok) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
      var tag = b.querySelector('.hs-tag');
      if (tag) tag.textContent = ok ? '이용 가능' : '미래 슬롯';
    });
  }

  function renderProgress() {
    var list = $('dispatch-list');
    if (list) {
      list.textContent = '';
      DISPATCH_DEMO.forEach(function (d) {
        var li = document.createElement('li');
        var name = document.createElement('span');
        name.textContent = d.name;
        var pct = document.createElement('span');
        pct.textContent = d.pct + '%';
        var bar = document.createElement('div');
        bar.className = 'progress-bar';
        var fill = document.createElement('i');
        fill.style.setProperty('--p', d.pct + '%');
        bar.appendChild(fill);
        li.appendChild(name);
        li.appendChild(pct);
        li.appendChild(bar);
        list.appendChild(li);
      });
    }
    var rf = $('repeat-bar-fill');
    if (rf) rf.style.setProperty('--p', REPEAT_DEMO.pct + '%');
    var rt = $('repeat-text');
    if (rt) rt.textContent = REPEAT_DEMO.text;
  }

  function hideToast() {
    clearTimeout(toastTimer);
    if (toast) toast.hidden = true;
    if (selectedHs) { selectedHs.classList.remove('selected'); selectedHs = null; }
    navBtn = null;
  }

  function showToast(title, body, tag) {
    toast.textContent = '';
    var b = document.createElement('b');
    b.textContent = title + (tag ? ' · ' + tag : '');
    var p = document.createElement('div');
    p.textContent = body;
    toast.appendChild(b);
    toast.appendChild(p);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }

  function onBuilding(btn) {
    var key = btn.getAttribute('data-building');
    var info = BUILDINGS[key];
    if (!info) return;
    hideToast();
    selectedHs = btn;
    btn.classList.add('selected');
    if (isAvailable(key)) {
      showToast(info.name, info.desc, '이용 가능(데모)');
      if (info.go && window.UIPreview) {
        hideToast();
        window.UIPreview.setScene(info.go);
      }
    } else {
      showToast(info.name, info.desc, '미래 슬롯');
    }
  }

  function onClick(ev) {
    var t = ev.target;
    if (!t || !t.closest || !toast) return;
    if (!t.closest('#village')) return;
    var hs = t.closest('#village-map .hotspot[data-building]');
    if (hs) { onBuilding(hs); return; }
    var nav = t.closest('#village-nav [data-nav]');
    if (nav) {
      var key = nav.getAttribute('data-nav');
      var same = navBtn === nav && !toast.hidden;
      hideToast();
      if (same) return;
      navBtn = nav;
      showToast('임시 안내', NAV_INFO[key] || '화면 준비 중입니다.', '데모');
      return;
    }
    if (t.closest('#village-info') || !toast.hidden) hideToast();
  }

  function start(state, api) {
    toast = $('village-info');
    applyAvailability();
    renderProgress();
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideToast(); });
    api.onSceneChange(function () { hideToast(); });
  }

  if (window.UIPreview && typeof window.UIPreview.onInit === 'function') {
    window.UIPreview.onInit(start);
  }
})();


/* ======================= SHINHEUN PHASE 2 PARALLAX ======================= */
(() => {
  const village = document.getElementById("village");
  const layerRoot = document.getElementById("hub-phase2-layers");
  if (!village || !layerRoot) return;

  const depthMap = [
    [".hub-church", -5.0],
    [".hub-market", -8.0],
    [".hub-mine", 4.0],
    [".hub-dispatch", 7.0],
    [".hub-raid", 9.0],
    [".hub-clock-base", 11.0],
    [".hub-clock-motion", 13.0],
    [".hub-mine-motion", 6.0],
    [".hub-dispatch-motion", 8.0],
    [".hub-raid-motion", 10.0]
  ].map(([selector, depth]) => [layerRoot.querySelector(selector), depth])
   .filter(([el]) => el);

  let targetX = 0, targetY = 0, currentX = 0, currentY = 0, raf = 0;

  function renderParallax() {
    raf = 0;
    currentX += (targetX - currentX) * 0.09;
    currentY += (targetY - currentY) * 0.09;
    for (const [el, depth] of depthMap) {
      const x = currentX * depth;
      const y = currentY * depth * 0.55;
      el.style.translate = x.toFixed(2) + "px " + y.toFixed(2) + "px";
    }
    if (Math.abs(targetX-currentX) > 0.001 || Math.abs(targetY-currentY) > 0.001) {
      raf = requestAnimationFrame(renderParallax);
    }
  }

  function setTarget(clientX, clientY) {
    const rect = village.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    targetX = ((clientX - rect.left) / rect.width - 0.5) * 2;
    targetY = ((clientY - rect.top) / rect.height - 0.5) * 2;
    if (!raf) raf = requestAnimationFrame(renderParallax);
  }

  village.addEventListener("pointermove", (event) => setTarget(event.clientX, event.clientY), { passive: true });
  village.addEventListener("pointerleave", () => {
    targetX = 0;
    targetY = 0;
    if (!raf) raf = requestAnimationFrame(renderParallax);
  }, { passive: true });

  // Touch/mobile: a very small device-orientation-free drift on first interaction.
  village.addEventListener("pointerdown", (event) => setTarget(event.clientX, event.clientY), { passive: true });
})();


/* SHINHEUN PHASE 2 DOM TEXT HOTFIX */
(() => {
  const style = document.createElement("style");
  style.id = "phase2-dom-text-hotfix";
  style.textContent = `
    #village-nav button{
      font-size:0!important;
      line-height:0!important;
      color:transparent!important;
      text-shadow:none!important;
      overflow:hidden!important;
    }
    #village-nav button::before,
    #village-nav button::after{content:none!important;display:none!important}
    #village-nav button .nav-icon{display:none!important}
  `;
  document.head.appendChild(style);
})();
