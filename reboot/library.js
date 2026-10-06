/* 신흥 리부트 검수 라이브러리 — 읽기 전용 카탈로그.
 * 소스는 fetch 후 textContent로만 표시하며 실행하지 않는다.
 * 저장은 localStorage 'shinheun-review:' 네임스페이스만 사용하고 게임 저장 키는 접근하지 않는다.
 * 네트워크 쓰기·외부 의존성·인라인 이벤트·eval 없음. */
(function () {
  'use strict';

  var MANIFEST_URL = 'library-manifest.json';
  var NS = 'shinheun-review:';
  var NOTE_PREFIX = NS + 'note:';
  var PAGE_SIZE_WIDE = 12;
  var PAGE_SIZE_COMPACT = 6; /* 좁은/세로 화면: 카드 목록이 길어지지 않도록 */
  var COMPACT_MQ = window.matchMedia ? window.matchMedia('(max-width: 800px), (orientation: portrait)') : null;
  var SOURCE_LIMIT = 400000;

  var STATUS_LABEL = { applied: '적용됨', draft: '초안', placeholder: '임시', missing: '없음' };
  var VFX_KINDS = ['flurry', 'heavy', 'prayer', 'brace'];
  /* 비공개 설정 파일은 소스 표시 자체를 차단하고, 그 외 소스의 비밀 값 형태는 마스킹한다 */
  var BLOCKED_PATH = /(^|\/)(cloud\.js|\.env[^/]*|[^/]*(secret|credential|firebase)[^/]*)$/i;
  var SECRET_RE = /((?:api[_-]?key|secret|password|private[_-]?key|auth[_-]?token|access[_-]?token)['"]?\s*[:=]\s*)(['"])[^'"\n]*\2/gi;
  var observed = {};
  var VFX_TARGETS = [
    { id: 'enemy', label: '적 (시뮬레이션 대상)', bg: 'radial-gradient(circle at 35% 30%, #ff9a9a, #7a2b2b)' },
    { id: 'ally', label: '아군 (시뮬레이션 대상)', bg: 'radial-gradient(circle at 35% 30%, #9af0b5, #2b7a45)' },
    { id: 'self', label: '자신 (시뮬레이션 대상)', bg: 'radial-gradient(circle at 35% 30%, #8fb8ff, #2b4a8a)' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    search: $('search'), category: $('filter-category'), status: $('filter-status'),
    count: $('result-count'), grid: $('grid'), empty: $('empty'), pager: $('pager'),
    main: document.querySelector('.library-main'),
    detail: $('detail'), panel: document.querySelector('.library-detail-panel'),
    title: $('detail-title'), meta: $('detail-meta'), info: $('detail-info'),
    close: $('detail-close'), source: $('source-view'), preview: $('preview'),
    previewLabel: $('preview-label'), vfxControls: $('vfx-controls'),
    vfxPlay: $('vfx-play'), vfxPause: $('vfx-pause'), vfxReplay: $('vfx-replay'),
    vfxTarget: $('vfx-target'), note: $('note'), noteStatus: $('note-status'),
    exportJson: $('export-json'), exportMd: $('export-md')
  };

  var state = {
    manifest: null, entries: [], filtered: [], page: 1,
    current: null, opener: null, loadToken: 0, backgroundInert: [],
    stage: null, speed: 1, targetIdx: 0, dlg: { i: 0 }
  };

  /* ---------- 유틸 ---------- */
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function statusLabel(s) { return STATUS_LABEL[s] || String(s || '미확인'); }

  /* 저장소 상대 경로만 허용 (절대경로·프로토콜·상위 이동 거부) */
  function safeRelPath(p) {
    if (typeof p !== 'string' || !p) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p) || p.charAt(0) === '/' || p.charAt(0) === '\\') return null;
    if (p.indexOf('\\') !== -1) return null;
    var parts = p.split('/');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..' || parts[i] === '') return null;
    }
    return p;
  }

  function encodePath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  function storageOk() {
    try { return !!window.localStorage; } catch (e) { return false; }
  }

  /* ---------- 매니페스트 로드 ---------- */
  function showBanner(title, text) {
    var old = document.getElementById('library-error');
    if (old) old.parentNode.removeChild(old);
    var box = make('div', 'library-empty');
    box.id = 'library-error';
    box.setAttribute('role', 'alert');
    box.appendChild(make('p', 'library-empty-title', title));
    box.appendChild(make('p', 'library-empty-text', text));
    el.main.insertBefore(box, el.main.firstChild);
  }

  function loadManifest() {
    if (location.protocol === 'file:') {
      showBanner('file:// 로 열려 있어 매니페스트를 읽을 수 없습니다',
        '브라우저는 file:// 에서 fetch를 막습니다. 저장소 폴더에서 로컬 서버(예: python -m http.server)를 실행한 뒤 http://localhost:포트/library.html 로 열어 주세요. 항목은 만들어 보여주지 않습니다.');
      el.count.textContent = '0개 항목';
      el.empty.hidden = false;
      return;
    }
    fetch(MANIFEST_URL, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (m) {
        if (!m || !Array.isArray(m.entries)) throw new Error('entries 배열이 없습니다');
        state.manifest = m;
        state.entries = m.entries;
        applyFilters();
      })
      .catch(function (err) {
        showBanner('library-manifest.json 을 불러오지 못했습니다',
          '원인: ' + (err && err.message ? err.message : err) + '. 파일 위치와 서버 상태를 확인해 주세요. 항목은 만들어 보여주지 않습니다.');
        el.count.textContent = '0개 항목';
        el.empty.hidden = false;
      });
  }

  /* ---------- 검색 / 필터 / 페이지 ---------- */
  function haystack(e) {
    return [e.id, e.title, e.path, e.provenance, e.category, e.kind, e.status,
      (e.usedIn || []).join(' ')].join('\n').toLowerCase();
  }

  function applyFilters() {
    var q = el.search.value.trim().toLowerCase();
    var cat = el.category.value;
    var st = el.status.value;
    state.filtered = state.entries.filter(function (e) {
      if (cat && e.category !== cat) return false;
      if (st && e.status !== st) return false;
      return !q || haystack(e).indexOf(q) !== -1;
    });
    state.page = 1;
    render();
  }

  function pageSize() { return COMPACT_MQ && COMPACT_MQ.matches ? PAGE_SIZE_COMPACT : PAGE_SIZE_WIDE; }

  function pageCount() { return Math.max(1, Math.ceil(state.filtered.length / pageSize())); }

  function render() {
    var total = state.filtered.length;
    var pages = pageCount();
    if (state.page > pages) state.page = pages;
    el.count.textContent = total + '개 항목 / 전체 ' + state.entries.length + '개 · ' + state.page + '/' + pages + ' 페이지';
    clear(el.grid);
    el.empty.hidden = total !== 0;

    var size = pageSize();
    var start = (state.page - 1) * size;
    state.filtered.slice(start, start + size).forEach(function (e) {
      var li = make('li');
      var btn = make('button', 'library-card');
      btn.type = 'button';
      btn.setAttribute('data-id', e.id);
      btn.appendChild(make('span', 'library-card-id', e.title || e.id));
      btn.appendChild(make('span', 'library-card-path', e.path ? e.path : '(파일 없음) ' + e.id));
      var row = make('span', 'library-card-row');
      var b = make('span', 'library-badge', statusLabel(e.status));
      b.setAttribute('data-status', e.status || '');
      row.appendChild(b);
      row.appendChild(make('span', 'library-badge', e.category || '-'));
      if (e.localOnly) row.appendChild(make('span', 'library-badge', '로컬 전용'));
      btn.appendChild(row);
      li.appendChild(btn);
      el.grid.appendChild(li);
    });
    renderPager(pages);
  }

  function renderPager(pages) {
    clear(el.pager);
    if (pages <= 1) return;
    function add(label, page, opts) {
      var b = make('button', 'library-btn', label);
      b.type = 'button';
      b.setAttribute('data-page', String(page));
      if (opts && opts.aria) b.setAttribute('aria-label', opts.aria);
      if (opts && opts.disabled) b.disabled = true;
      if (opts && opts.current) b.setAttribute('aria-current', 'page');
      el.pager.appendChild(b);
    }
    add('이전', state.page - 1, { disabled: state.page <= 1, aria: '이전 페이지' });
    for (var p = 1; p <= pages; p++) {
      add(String(p), p, { current: p === state.page, aria: p + ' 페이지' });
    }
    add('다음', state.page + 1, { disabled: state.page >= pages, aria: '다음 페이지' });
  }

  /* ---------- 상세 팝업 ---------- */
  function findEntry(id) {
    for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === id) return state.entries[i];
    return null;
  }

  function addInfo(label, value, linkPath) {
    el.info.appendChild(make('dt', null, label));
    var dd = make('dd');
    if (linkPath) {
      var a = make('a', null, linkPath);
      a.href = encodePath(linkPath);
      a.target = '_blank';
      a.rel = 'noopener';
      dd.appendChild(a);
    } else {
      dd.textContent = value;
    }
    el.info.appendChild(dd);
    return dd;
  }

  function sha256Hex(buf) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', buf).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  function openDetail(entry, opener) {
    state.current = entry;
    state.opener = opener || null;
    state.loadToken++;
    stopVfx();
    el.title.textContent = entry.title || entry.id;
    el.meta.textContent = entry.id + ' · ' + (entry.category || '-') + ' · ' + statusLabel(entry.status);

    clear(el.info);
    var safe = safeRelPath(entry.path);
    addInfo('id', entry.id);
    if (entry.path == null) addInfo('경로', '없음 (실제 파일 없음)');
    else if (safe) addInfo('경로', null, safe);
    else addInfo('경로', '표시 불가: 허용되지 않는 경로 형식');
    addInfo('출처', entry.provenance || '미기재');
    addInfo('상태', statusLabel(entry.status));
    addInfo('사용처', entry.usedIn && entry.usedIn.length ? entry.usedIn.join(', ') : '없음/미확인');
    addInfo('게시 동일성', entry.localOnly ? '로컬 전용 (게시본과 동일성 미확인)' : '확인 정보 없음');
    addInfo('sha256', entry.sha256 ? entry.sha256 : '미검증 (매니페스트에 값 없음)');
    state.hashCmp = entry.path && entry.sha256 ? addInfo('해시 대조', '소스를 불러오면 매니페스트 값과 비교') : null;
    state.hashDd = entry.path ? addInfo('관측 해시', '계산 전 (소스를 불러오면 브라우저가 계산)') : null;
    state.syncDd = Array.isArray(entry.dialogue) ? addInfo('원문 동기화', '확인 전') : null;
    if (entry.version) addInfo('버전', String(entry.version));
    if (entry.dataKey) addInfo('데이터 키', entry.dataKey);

    clear(el.source);
    clear(el.preview);
    el.previewLabel.textContent = '';
    el.vfxControls.hidden = true;
    state.stage = null;

    renderSource(entry, safe);
    renderPreview(entry, safe);
    loadNote(entry);

    el.detail.hidden = false;
    if (!state.backgroundInert.length) {
      Array.prototype.forEach.call(document.body.children, function (node) {
        if (node === el.detail || node.tagName === 'SCRIPT') return;
        state.backgroundInert.push({ node: node, value: node.getAttribute('inert') });
        node.setAttribute('inert', '');
      });
    }
    document.body.classList.add('library-lock');
    el.panel.focus();
  }

  function closeDetail() {
    if (el.detail.hidden) return;
    stopVfx();
    state.loadToken++;
    el.detail.hidden = true;
    state.backgroundInert.forEach(function (saved) {
      if (saved.value === null) saved.node.removeAttribute('inert');
      else saved.node.setAttribute('inert', saved.value);
    });
    state.backgroundInert = [];
    document.body.classList.remove('library-lock');
    state.current = null;
    if (state.opener && document.contains(state.opener)) state.opener.focus();
    state.opener = null;
  }

  /* data.js의 stage(n, …) / victoryStory / line('화자','본문') 순서열을 읽어 매니페스트 대사와 정확히 비교 */
  function parseSourceDialogue(text) {
    var re = /\bstage\(\s*(\d+)\s*,|victoryStory\s*:|\bline\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g;
    var unesc = function (s) { return s.replace(/\\(.)/g, '$1'); };
    var out = [], stage = 0, victory = false, m;
    while ((m = re.exec(text))) {
      if (m[1] !== undefined) { stage = Number(m[1]); victory = false; }
      else if (m[2] === undefined) victory = true;
      else out.push({ group: '스테이지 ' + stage + (victory ? ' 승리 후' : ''), speaker: unesc(m[2]), text: unesc(m[3]) });
    }
    return out;
  }

  function compareDialogue(expected, text) {
    var actual = parseSourceDialogue(text);
    if (!actual.length) return { ok: false, total: expected.length, reason: '원문에서 line() 대사를 해석하지 못함' };
    if (actual.length !== expected.length) {
      return { ok: false, total: expected.length, reason: '줄 수 다름 (매니페스트 ' + expected.length + ' / 원문 ' + actual.length + ')' };
    }
    for (var i = 0; i < actual.length; i++) {
      var a = actual[i], e = expected[i] || {};
      if (a.group !== e.group || a.speaker !== e.speaker || a.text !== e.text) {
        return { ok: false, total: expected.length, reason: (i + 1) + '번째 줄의 스테이지·화자·본문 중 다름' };
      }
    }
    return { ok: true, total: expected.length };
  }

  function renderSource(entry, safe) {
    if (entry.kind === 'image' || !entry.path) {
      el.source.textContent = entry.path ? '(이미지 파일은 소스 텍스트가 없습니다)' : '(실제 파일이 없어 표시할 소스가 없습니다)';
      return;
    }
    if (!safe) { el.source.textContent = '(허용되지 않는 경로라 불러오지 않았습니다)'; return; }
    if (BLOCKED_PATH.test(safe)) {
      el.source.textContent = '(비공개 설정 파일일 수 있어 소스를 표시하지 않습니다)';
      if (state.hashDd) state.hashDd.textContent = '표시 차단됨';
      return;
    }
    if (location.protocol === 'file:') {
      el.source.textContent = 'file:// 로 열려 소스를 읽을 수 없습니다. 로컬 서버로 여세요.';
      return;
    }
    var token = state.loadToken;
    el.source.textContent = '불러오는 중…';
    fetch(encodePath(safe), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        var text = new TextDecoder('utf-8').decode(buf);
        sha256Hex(buf).then(function (h) {
          observed[safe] = h;
          if (token === state.loadToken && state.hashDd) {
            state.hashDd.textContent = h ? h + ' (이 브라우저가 현재 서빙본에서 계산, 매니페스트 값 아님)' : '계산 불가 (보안 컨텍스트 필요)';
            if (state.hashCmp) {
              state.hashCmp.textContent = !h ? '비교 불가 (해시 계산 불가)'
                : h === String(state.current.sha256).toLowerCase() ? '일치'
                : '불일치 — 원본이 바뀌었거나 매니페스트가 낡았습니다';
            }
          }
        });
        if (token !== state.loadToken) return;
        if (state.syncDd) {
          var res = compareDialogue(state.current.dialogue, text);
          var msg = res.ok
            ? '일치: ' + res.total + '줄의 순서·화자·스테이지·본문이 ' + safe + ' 원문과 같음'
            : '불일치 — ' + res.reason + ' (매니페스트 갱신 필요)';
          state.syncDd.textContent = msg;
          var sp = document.getElementById('dlg-sync');
          if (sp) {
            sp.textContent = (res.ok ? '원문 대조 통과: ' : '경고: 원문과 다릅니다. 아래 대사는 낡았을 수 있습니다. ') + (res.ok ? msg : res.reason);
            sp.setAttribute('data-sync', res.ok ? 'ok' : 'bad');
          }
        }
        text = text.replace(SECRET_RE, '$1$2[가려짐]$2');
        var cut = text.length > SOURCE_LIMIT;
        el.source.textContent = cut
          ? text.slice(0, SOURCE_LIMIT) + '\n\n… (' + SOURCE_LIMIT + '자에서 잘림. 전체는 소스 링크로 확인)'
          : text;
      })
      .catch(function (err) {
        if (token !== state.loadToken) return;
        el.source.textContent = '소스를 불러오지 못했습니다: ' + (err && err.message ? err.message : err);
      });
  }

  function emptyNote(text) {
    var d = make('div', 'library-preview-empty', text);
    clear(el.preview);
    el.preview.appendChild(d);
  }

  function renderPreview(entry, safe) {
    if (entry.kind === 'image') {
      if (!entry.path || !safe) {
        el.previewLabel.textContent = '이미지: 없음';
        emptyNote('없음 — 실제 이미지 파일이 확인되지 않았습니다. 만들어낸 이미지는 표시하지 않습니다.');
        return;
      }
      el.previewLabel.textContent = '실제 이미지 파일: ' + safe;
      var img = document.createElement('img');
      img.alt = entry.title || entry.id;
      img.addEventListener('error', function () {
        el.previewLabel.textContent = '이미지: 없음 (불러오기 실패)';
        emptyNote('없음 — 이미지를 불러오지 못했습니다: ' + safe);
      });
      img.src = encodePath(safe);
      el.preview.appendChild(img);
      return;
    }
    if (entry.kind === 'vfx') {
      renderVfx(entry);
      return;
    }
    var lines = dialogueLines(entry);
    if (lines) {
      renderDialogue(entry, lines);
      return;
    }
    if (entry.kind === 'dialogue') {
      el.previewLabel.textContent = '구조화된 대사 데이터가 매니페스트에 없습니다';
      emptyNote('대사 순서 리더는 매니페스트에 구조화된 대사가 있을 때만 표시됩니다. 왼쪽 소스 텍스트를 확인하세요.');
      return;
    }
    el.previewLabel.textContent = '시각 미리보기 없음';
    emptyNote(entry.path ? '이 항목은 소스 텍스트로만 확인합니다.' : '없음 — 실제 파일이 없어 미리볼 내용이 없습니다.');
  }

  /* ---------- 대사 리더 (매니페스트에 구조화 대사가 있을 때만) ---------- */
  function dialogueLines(entry) {
    var d = entry.dialogue;
    if (!Array.isArray(d) || !d.length) return null;
    var out = [];
    d.forEach(function (x) {
      if (x && typeof x.text === 'string') {
        out.push({ speaker: typeof x.speaker === 'string' ? x.speaker : '', text: x.text, group: typeof x.group === 'string' ? x.group : '' });
      }
    });
    return out.length ? out : null;
  }

  function renderDialogue(entry, lines) {
    state.dlg = { i: 0, lines: lines };
    el.previewLabel.textContent = '대사 순서 리더 (매니페스트의 구조화 대사)';
    clear(el.preview);
    var sync = make('p', 'library-preview-label', '원문 대조 전 (소스를 불러오면 갱신)');
    sync.id = 'dlg-sync';
    el.preview.appendChild(sync);
    var view = make('div');
    view.id = 'dlg-view';
    view.setAttribute('aria-live', 'polite');
    var pos = make('p', 'library-preview-label');
    pos.id = 'dlg-pos';
    var nav = make('div', 'library-actions');
    var prev = make('button', 'library-btn', '이전');
    prev.type = 'button'; prev.id = 'dlg-prev';
    var next = make('button', 'library-btn', '다음');
    next.type = 'button'; next.id = 'dlg-next';
    nav.appendChild(prev); nav.appendChild(next);
    el.preview.appendChild(pos);
    el.preview.appendChild(view);
    el.preview.appendChild(nav);
    function show() {
      var l = state.dlg.lines[state.dlg.i];
      clear(view);
      var p = make('p', 'library-dialogue-line');
      if (l.speaker) p.appendChild(make('span', 'library-dialogue-speaker', l.speaker));
      p.appendChild(document.createTextNode(l.text));
      view.appendChild(p);
      pos.textContent = (l.group ? l.group + ' · ' : '') + (state.dlg.i + 1) + ' / ' + state.dlg.lines.length;
      prev.disabled = state.dlg.i <= 0;
      next.disabled = state.dlg.i >= state.dlg.lines.length - 1;
    }
    prev.addEventListener('click', function () { if (state.dlg.i > 0) { state.dlg.i--; show(); } });
    next.addEventListener('click', function () { if (state.dlg.i < state.dlg.lines.length - 1) { state.dlg.i++; show(); } });
    show();
  }

  /* ---------- VFX 시뮬레이션 데모 (library.css의 격리된 데모) ---------- */
  function renderVfx(entry) {
    el.previewLabel.textContent = '시뮬레이션 데모이며 실제 게임 효과가 아님';
    el.vfxControls.hidden = false;
    clear(el.vfxTarget);
    VFX_TARGETS.forEach(function (t, i) {
      var o = make('option', null, t.label);
      o.value = String(i);
      el.vfxTarget.appendChild(o);
    });
    state.targetIdx = 0;
    el.vfxTarget.value = '0';
    buildStage(entry);
  }

  function buildStage(entry) {
    clear(el.preview);
    var wrap = make('div');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', '시뮬레이션 데모 (실제 게임 효과 아님)');
    var stage = make('div', 'library-vfx-stage');
    stage.setAttribute('data-playing', 'false');
    var fx = entry && typeof entry.previewRef === 'string' ? entry.previewRef.replace(/^vfx\./, '') : '';
    if (VFX_KINDS.indexOf(fx) !== -1) stage.setAttribute('data-fx', fx);
    stage.style.setProperty('--library-speed', String(state.speed));
    var target = make('div', 'library-vfx-target-el');
    target.style.background = VFX_TARGETS[state.targetIdx].bg;
    var aura = make('div', 'library-vfx-fx');
    stage.appendChild(target);
    stage.appendChild(aura);
    wrap.appendChild(stage);
    el.preview.appendChild(wrap);
    if (entry && entry.demoNote) {
      el.preview.appendChild(make('p', 'library-preview-label', entry.demoNote));
    }
    el.preview.appendChild(make('p', 'library-preview-label',
      '이 데모는 style.css keyframes 값을 library.css에 옮겨 재작성한 시뮬레이션입니다. 게임의 원본 코드를 실행하거나 적용한 것이 아니며 실제 게임 효과와 동일하다고 보증하지 않습니다.'));
    if (!stage.getAttribute('data-fx')) {
      el.preview.appendChild(make('p', 'library-preview-label', '이 항목에는 추출된 모션 정의가 없어 움직이지 않습니다.'));
    }
    state.stage = stage;
  }

  function setPlaying(on) {
    if (state.stage) state.stage.setAttribute('data-playing', on ? 'true' : 'false');
  }
  function stopVfx() { setPlaying(false); }

  function setSpeed(n) {
    state.speed = n;
    if (state.stage) state.stage.style.setProperty('--library-speed', String(n));
    var btns = el.vfxControls.querySelectorAll('[data-speed]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(Number(btns[i].getAttribute('data-speed')) === n));
    }
  }

  function replayVfx() {
    var playing = true;
    buildStage(state.current);
    setPlaying(playing);
  }

  /* ---------- 수정 메모 (shinheun-review: 네임스페이스) ---------- */
  function noteKey(id) { return NOTE_PREFIX + id; }

  function loadNote(entry) {
    el.note.value = '';
    el.noteStatus.textContent = '';
    if (!storageOk()) { el.noteStatus.textContent = '이 브라우저에서는 임시 저장을 쓸 수 없습니다 (내보내기는 가능).'; return; }
    try {
      var raw = localStorage.getItem(noteKey(entry.id));
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o.note === 'string') el.note.value = o.note;
      }
    } catch (e) { el.noteStatus.textContent = '저장된 메모를 읽지 못했습니다.'; }
  }

  function saveNote() {
    var entry = state.current;
    if (!entry || !storageOk()) return;
    try {
      var text = el.note.value;
      if (text.trim()) {
        localStorage.setItem(noteKey(entry.id), JSON.stringify({
          id: entry.id, path: entry.path || null, note: text, updatedAt: new Date().toISOString()
        }));
        el.noteStatus.textContent = '임시 저장됨 (shinheun-review, 이 브라우저)';
      } else {
        localStorage.removeItem(noteKey(entry.id));
        el.noteStatus.textContent = '메모 없음';
      }
    } catch (e) { el.noteStatus.textContent = '저장 실패: ' + e.message; }
  }

  function collectNotes() {
    var out = [];
    if (storageOk()) {
      var keys = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(NOTE_PREFIX) === 0) keys.push(k);
        }
      } catch (err) { keys = []; }
      keys.forEach(function (k) {
        try { /* 손상된 항목 하나가 나머지를 막지 않도록 항목별로 처리 */
          var o = JSON.parse(localStorage.getItem(k));
          if (!o || typeof o.id !== 'string' || typeof o.note !== 'string' || !o.note.trim()) return;
          var e = findEntry(o.id);
          out.push({
            id: o.id,
            path: e ? (e.path || null) : (o.path || null),
            sha256: e ? (e.sha256 || null) : null,
            sha256Observed: e && e.path && observed[e.path] ? observed[e.path] : null,
            note: o.note
          });
        } catch (err) { /* 건너뜀 */ }
      });
    }
    /* 현재 입력 중인 메모(저장 불가 환경 포함) 반영 */
    var cur = state.current;
    if (cur && el.note.value.trim()) {
      var found = false;
      out.forEach(function (x) { if (x.id === cur.id) { x.note = el.note.value; found = true; } });
      if (!found) out.push({ id: cur.id, path: cur.path || null, sha256: cur.sha256 || null, sha256Observed: cur.path && observed[cur.path] || null, note: el.note.value });
    }
    out.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return out;
  }

  function download(name, mime, text) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

  function exportNotes(kind) {
    saveNote();
    var items = collectNotes();
    if (!items.length) { el.noteStatus.textContent = '내보낼 메모가 없습니다.'; return; }
    var created = new Date().toISOString();
    if (kind === 'json') {
      var data = {
        type: 'shinheun-review-patch-request',
        createdAt: created,
        manifestGeneratedAt: state.manifest ? state.manifest.generatedAt || null : null,
        items: items
      };
      download('shinheun-review-' + stamp() + '.json', 'application/json', JSON.stringify(data, null, 2) + '\n');
    } else {
      var md = ['# 신흥 리부트 수정 요청서', '', '- 작성: ' + created,
        '- 매니페스트 생성: ' + (state.manifest && state.manifest.generatedAt || '미확인'),
        '- 이 파일은 검수 라이브러리에서 내보낸 요청서이며 저장소에 자동 반영되지 않습니다.', ''];
      items.forEach(function (x) {
        md.push('## ' + x.id, '', '- 경로: ' + (x.path || '없음'), '- sha256(매니페스트): ' + (x.sha256 || '없음'), '- sha256(관측): ' + (x.sha256Observed || '미계산'), '','수정 메모:', '');
        x.note.split('\n').forEach(function (line) { md.push('> ' + line); });
        md.push('');
      });
      download('shinheun-review-' + stamp() + '.md', 'text/markdown', md.join('\n'));
    }
    el.noteStatus.textContent = items.length + '개 메모를 내보냈습니다.';
  }

  /* ---------- 키보드 (포커스 가두기, Esc) ---------- */
  function focusables() {
    var list = el.panel.querySelectorAll('a[href], button, input, textarea, select, [tabindex]');
    return Array.prototype.filter.call(list, function (n) {
      return n.tabIndex >= 0 && !n.matches(':disabled') && !n.closest('[hidden], [inert]') &&
        n.getClientRects().length > 0 && window.getComputedStyle(n).visibility === 'visible';
    });
  }

  document.addEventListener('keydown', function (ev) {
    if (el.detail.hidden) return;
    if (ev.key === 'Escape') { ev.preventDefault(); closeDetail(); return; }
    if (ev.key === 'Tab') {
      var f = focusables();
      if (!f.length) { ev.preventDefault(); el.panel.focus(); return; }
      var first = f[0], last = f[f.length - 1], act = document.activeElement;
      if (f.indexOf(act) === -1) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); }
      else if (ev.shiftKey && act === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && act === last) { ev.preventDefault(); first.focus(); }
      return;
    }
    if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && state.dlg && state.dlg.lines && el.preview.contains(document.activeElement)) {
      var b = $(ev.key === 'ArrowLeft' ? 'dlg-prev' : 'dlg-next');
      if (b && !b.disabled) { ev.preventDefault(); b.click(); }
    }
  });

  /* ---------- 이벤트 연결 ---------- */
  var timer = null;
  if (COMPACT_MQ) {
    var onMq = function () { if (state.entries.length) { state.page = 1; render(); } };
    if (COMPACT_MQ.addEventListener) COMPACT_MQ.addEventListener('change', onMq);
    else if (COMPACT_MQ.addListener) COMPACT_MQ.addListener(onMq);
  }
  el.search.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(applyFilters, 150);
  });
  el.category.addEventListener('change', applyFilters);
  el.status.addEventListener('change', applyFilters);

  el.grid.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('.library-card') : null;
    if (!btn) return;
    var entry = findEntry(btn.getAttribute('data-id'));
    if (entry) openDetail(entry, btn);
  });

  el.pager.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('button[data-page]') : null;
    if (!btn || btn.disabled) return;
    state.page = Number(btn.getAttribute('data-page'));
    render();
    var cur = el.pager.querySelector('[aria-current="page"]');
    if (cur) cur.focus();
  });

  el.close.addEventListener('click', closeDetail);
  el.detail.addEventListener('mousedown', function (ev) { if (ev.target === el.detail) closeDetail(); });

  el.vfxPlay.addEventListener('click', function () { setPlaying(true); });
  el.vfxPause.addEventListener('click', function () { setPlaying(false); });
  el.vfxReplay.addEventListener('click', replayVfx);
  el.vfxControls.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-speed]') : null;
    if (b) setSpeed(Number(b.getAttribute('data-speed')));
  });
  el.vfxTarget.addEventListener('change', function () {
    state.targetIdx = Number(el.vfxTarget.value) || 0;
    if (state.stage) {
      var t = state.stage.querySelector('.library-vfx-target-el');
      if (t) t.style.background = VFX_TARGETS[state.targetIdx].bg;
    }
  });

  el.note.addEventListener('input', saveNote);
  el.exportJson.addEventListener('click', function () { exportNotes('json'); });
  el.exportMd.addEventListener('click', function () { exportNotes('md'); });

  loadManifest();
})();

// 신흔 개발실 현황판
(function () {
  'use strict';

  var STATUS_URL = 'devroom-status.json';
  var REFRESH_MS = 15000;
  var NONE = '정보 없음';
  var STATUS_LABEL = {
    idle: '대기', working: '작업 중', reviewing: '검토 중',
    blocked: '막힘', verified: '검증됨', published: '게시됨'
  };

  var grid = document.getElementById('devroom-grid');
  var meta = document.getElementById('devroom-meta');
  if (!grid || !meta) return;

  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function present(v) { return v !== null && v !== undefined && v !== ''; }
  function show(v) { return present(v) ? String(v) : NONE; }

  function toMs(v) {
    if (!present(v)) return null;
    var t = Date.parse(v);
    return isNaN(t) ? null : t;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function fmtTime(v) {
    var t = toMs(v);
    if (t === null) return NONE;
    var d = new Date(t);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function fmtElapsed(startMs) {
    var s = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return pad(h) + ':' + pad(m) + ':' + pad(s % 60);
  }

  function clampProgress(v) {
    var n = Number(v);
    if (!present(v) || isNaN(n)) return null;
    return Math.min(100, Math.max(0, n));
  }

  function statusBadge(status) {
    var b = make('span', 'devroom-badge', STATUS_LABEL[status] || show(status));
    b.setAttribute('data-status', present(status) ? String(status) : 'unknown');
    return b;
  }

  function addRow(dl, label, value) {
    dl.appendChild(make('dt', null, label));
    var dd = make('dd', null, value);
    dl.appendChild(dd);
    return dd;
  }

  function usageValue(v) { return present(v) ? String(v) : NONE; }

  function renderUsage(sub) {
    var box = make('div', 'devroom-usage');
    var head = make('div', 'devroom-badges');
    head.appendChild(make('h4', 'devroom-usage-title', show(sub.name)));
    head.appendChild(statusBadge(sub.status));
    box.appendChild(head);

    var u = sub.usage;
    var dl = make('dl', 'devroom-usage-info');
    if (u && typeof u === 'object') {
      addRow(dl, '남은 사용량', usageValue(u.remaining));
      addRow(dl, '사용량', usageValue(u.used));
      addRow(dl, '초기화', present(u.reset_at) ? fmtTime(u.reset_at) : NONE);
      addRow(dl, '스냅샷', present(u.snapshot_at) ? fmtTime(u.snapshot_at) : NONE);
      addRow(dl, '최신 여부', u.stale === true ? '오래됨(stale)' : (u.stale === false ? '최신' : NONE));
    } else {
      addRow(dl, '사용량', NONE);
    }
    box.appendChild(dl);
    return box;
  }

  function renderCard(s) {
    var li = make('li');
    var card = make('article', 'devroom-card');
    card.setAttribute('data-id', show(s.id));

    var head = make('div', 'devroom-card-head');
    head.appendChild(make('h3', 'devroom-card-title', show(s.name)));
    var badges = make('div', 'devroom-badges');
    badges.appendChild(statusBadge(s.status));
    var stale = make('span', 'devroom-badge devroom-stale', '정지 의심');
    stale.hidden = true;
    var upMs = toMs(s.updated_at);
    var limit = Number(s.stale_after_sec);
    var trackStale = s.status === 'working' || s.status === 'reviewing';
    if (trackStale && upMs !== null && present(s.stale_after_sec) && !isNaN(limit)) {
      stale.setAttribute('data-updated', String(upMs));
      stale.setAttribute('data-stale-after', String(limit));
    }
    badges.appendChild(stale);
    head.appendChild(badges);
    card.appendChild(head);

    card.appendChild(make('p', 'devroom-role', show(s.role)));
    card.appendChild(make('p', 'devroom-task', show(s.task)));

    var pct = clampProgress(s.progress);
    var row = make('div', 'devroom-progress-row');
    row.appendChild(make('span', null, '진행도'));
    row.appendChild(make('span', null, pct === null ? NONE : pct + '%'));
    card.appendChild(row);
    var bar = document.createElement('progress');
    bar.max = 100;
    if (pct !== null) bar.value = pct;
    card.appendChild(bar);

    var times = make('dl', 'devroom-times');
    var activeTiming = s.status === 'working' || s.status === 'reviewing';
    var startMs = activeTiming ? toMs(s.started_at) : null;
    addRow(times, '시작', activeTiming ? fmtTime(s.started_at) : NONE);
    var elapsed = addRow(times, '경과', startMs === null ? NONE : fmtElapsed(startMs));
    if (startMs !== null) elapsed.setAttribute('data-started', String(startMs));
    addRow(times, '최근 업데이트', fmtTime(s.updated_at));
    card.appendChild(times);

    if (Array.isArray(s.sub)) {
      s.sub.forEach(function (sub) { card.appendChild(renderUsage(sub || {})); });
    }

    if (s.chat_load && typeof s.chat_load === 'object') {
      var c = s.chat_load;
      card.appendChild(make('p', 'devroom-chat-load',
        '채팅 부하: 메시지 ' + show(c.messages) + '개 · 수준 ' + show(c.level) + ' · ' + show(c.label)));
    }

    li.appendChild(card);
    return li;
  }

  function render(data) {
    var staff = Array.isArray(data.staff) ? data.staff : [];
    var frag = document.createDocumentFragment();
    staff.forEach(function (s) { frag.appendChild(renderCard(s || {})); });
    grid.textContent = '';
    grid.appendChild(frag);
    meta.removeAttribute('data-error');
    meta.textContent = '출처: ' + show(data.source) + ' · 생성: ' + fmtTime(data.generated_at);
    tick();
  }

  function tick() {
    var now = Date.now();
    Array.prototype.forEach.call(grid.querySelectorAll('[data-started]'), function (n) {
      n.textContent = fmtElapsed(Number(n.getAttribute('data-started')));
    });
    Array.prototype.forEach.call(grid.querySelectorAll('.devroom-stale'), function (n) {
      var up = n.getAttribute('data-updated');
      var lim = n.getAttribute('data-stale-after');
      n.hidden = !(up !== null && lim !== null && (now - Number(up)) / 1000 > Number(lim));
      n.setAttribute('data-stale', n.hidden ? 'false' : 'true');
    });
  }

  function load() {
    fetch(STATUS_URL, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(render)
      .catch(function (err) {
        meta.setAttribute('data-error', 'true');
        meta.textContent = '현황 데이터를 불러오지 못했습니다: ' + (err && err.message ? err.message : err);
      });
  }

  load();
  setInterval(load, REFRESH_MS);
  setInterval(tick, 1000);
})();
