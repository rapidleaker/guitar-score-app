(() => {
  'use strict';

  const STORAGE_KEY = 'guitar-score-app-v1';
  const MAX_HISTORY = 100;
  const DEFAULT_LYRIC_FONT_SIZE = 13;
  const DEFAULT_CHORD_FONT_SIZE = 13;
  const DEFAULT_LYRIC_FONT_FAMILY = 'sans-serif';
  const DEFAULT_CHORD_FONT_FAMILY = 'monospace';
  const MIN_FONT_SIZE = 12;
  const MAX_FONT_SIZE = 32;
  const DOUBLE_TAP_DELAY = 450;
  const DRAG_THRESHOLD = 5;

  const $ = selector => document.querySelector(selector);

  const els = {
    home: $('#homeScreen'),
    editor: $('#editorScreen'),
    songList: $('#songList'),
    songCount: $('#songCount'),
    emptyMessage: $('#emptyMessage'),
    newSong: $('#newSongBtn'),
    homeBtn: $('#homeBtn'),
    title: $('#titleInput'),
    artist: $('#artistInput'),
    key: $('#keyInput'),
    capo: $('#capoInput'),
    lyricFontSize: $('#lyricFontSizeInput'),
    chordFontSize: $('#chordFontSizeInput'),
    lyricFontSizeValue: $('#lyricFontSizeValue'),
    chordFontSizeValue: $('#chordFontSizeValue'),
    resetFontSize: $('#resetFontSizeBtn'),
    lyricFontFamily: $('#lyricFontFamilyInput'),
    chordFontFamily: $('#chordFontFamilyInput'),
    lyrics: $('#lyricsInput'),
    score: $('#scoreEditor'),
    previewSheet: $('#previewSheet'),
    lyricsEditor: $('#lyricsEditor'),
    chordsEditor: $('#chordsEditor'),
    preview: $('#preview'),
    mobileControls: $('#mobileControls'),
    selectedChordName: $('#selectedChordName'),
    deleteChord: $('#deleteChordBtn'),
    nudgeLeft: $('#nudgeLeftBtn'),
    nudgeRight: $('#nudgeRightBtn'),
    status: $('#status'),
    undo: $('#undoBtn'),
    redo: $('#redoBtn'),
    print: $('#printBtn'),
    copyChord: $('#copyChordBtn'),
    pasteChord: $('#pasteChordBtn'),
    modes: {
      lyrics: $('#lyricsMode'),
      chords: $('#chordsMode'),
      preview: $('#previewMode')
    }
  };

  let store = loadStore();
  let song = null;
  let mode = 'lyrics';
  let selectedChordId = null;
  let inlineInput = null;
  let dragState = null;
  let suppressChordActivation = false;
  let lastTap = { id: null, time: 0 };
  let history = [];
  let historyIndex = -1;
  let saveTimer = null;
  let lyricsBeforeEdit = '';

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(max, Math.max(min, number))
      : fallback;
  }

  function normalizeFontFamily(value, fallback) {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : fallback;
  }

  function normalizeSong(target) {
    if (!target || typeof target !== 'object') return null;

    target.id = target.id || uid('song');
    target.title = String(target.title || '');
    target.artist = String(target.artist || '');
    target.key = String(target.key || '');
    target.lyrics = String(
      target.lyrics ??
      (Array.isArray(target.lines)
        ? target.lines.map(line => line.text || '').join('\n')
        : '')
    );

    target.capo = clamp(target.capo, 0, 12, 0);
    target.updatedAt = Number(target.updatedAt) || Date.now();
    target.chords = Array.isArray(target.chords) ? target.chords : [];

    const oldLines = Array.isArray(target.lines)
      ? target.lines
      : [];

    target.lines = target.lyrics.split('\n').map((text, index) => ({
      id: oldLines[index]?.id || uid('line'),
      text
    }));

    if (!target.lines.length) {
      target.lines.push({ id: uid('line'), text: '' });
    }

    const validLineIds = new Set(target.lines.map(line => line.id));

    target.chords = target.chords
      .map(chord => ({
        id: chord.id || uid('chord'),
        name: String(chord.name || ''),
        lineId: validLineIds.has(chord.lineId)
          ? chord.lineId
          : target.lines[0].id,
        charIndex: Math.max(0, Number(chord.charIndex) || 0),
        offset: Number(chord.offset) || 0
      }))
      .filter(chord => chord.name);

    target.lyricFontSize = clamp(
      target.lyricFontSize,
      MIN_FONT_SIZE,
      MAX_FONT_SIZE,
      DEFAULT_LYRIC_FONT_SIZE
    );

    target.chordFontSize = clamp(
      target.chordFontSize,
      MIN_FONT_SIZE,
      MAX_FONT_SIZE,
      DEFAULT_CHORD_FONT_SIZE
    );

    target.lyricFontFamily = normalizeFontFamily(
      target.lyricFontFamily,
      DEFAULT_LYRIC_FONT_FAMILY
    );

    target.chordFontFamily = normalizeFontFamily(
      target.chordFontFamily,
      DEFAULT_CHORD_FONT_FAMILY
    );

    return target;
  }

  function createSong() {
    return normalizeSong({
      id: uid('song'),
      title: '',
      artist: '',
      key: '',
      capo: 0,
      lyrics: '',
      lines: [{ id: uid('line'), text: '' }],
      chords: [],
      lyricFontSize: DEFAULT_LYRIC_FONT_SIZE,
      chordFontSize: DEFAULT_CHORD_FONT_SIZE,
      lyricFontFamily: DEFAULT_LYRIC_FONT_FAMILY,
      chordFontFamily: DEFAULT_CHORD_FONT_FAMILY,
      updatedAt: Date.now()
    });
  }

  function loadStore() {
    const emptyStore = {
      version: 2,
      songs: [],
      currentSongId: null
    };

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyStore;

      const saved = JSON.parse(raw);

      if (Array.isArray(saved.songs)) {
        const result = {
          version: 2,
          songs: saved.songs.map(normalizeSong).filter(Boolean),
          currentSongId: saved.currentSongId || null
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
        return result;
      }

      const migratedSong = normalizeSong(saved);
      const migrated = {
        version: 2,
        songs: migratedSong ? [migratedSong] : [],
        currentSongId: migratedSong?.id || null
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    } catch {
      return emptyStore;
    }
  }

  function persistStore() {
    store.currentSongId = song?.id || store.currentSongId || null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function touchSong() {
    if (song) song.updatedAt = Date.now();
  }

  function saveSong() {
    clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
      if (!song) return;

      touchSong();

      const index = store.songs.findIndex(item => item.id === song.id);

      if (index >= 0) {
        store.songs[index] = song;
      }

      persistStore();

      if (els.status) {
        els.status.textContent = '自動保存しました';

        setTimeout(() => {
          if (els.status) els.status.textContent = '';
        }, 1500);
      }
    }, 150);
  }

  function updateHistoryButtons() {
    els.undo.disabled = historyIndex <= 0;
    els.redo.disabled = historyIndex >= history.length - 1;
  }

  function commit(label) {
    if (!song) return;

    touchSong();

    history = history.slice(0, historyIndex + 1);
    history.push({
      song: clone(song),
      label
    });

    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    historyIndex = history.length - 1;
    updateHistoryButtons();
    saveSong();
  }

  function resetHistory() {
    history = [{
      song: clone(song),
      label: '初期状態'
    }];

    historyIndex = 0;
    updateHistoryButtons();
  }

  function getScrollState() {
    return {
      pageX: window.scrollX,
      pageY: window.scrollY,
      scoreLeft: els.score?.scrollLeft || 0,
      scoreTop: els.score?.scrollTop || 0
    };
  }

  function restoreScrollState(state) {
    if (!state) return;

    const restore = () => {
      window.scrollTo(state.pageX, state.pageY);

      if (els.score) {
        els.score.scrollLeft = state.scoreLeft;
        els.score.scrollTop = state.scoreTop;
      }
    };

    restore();
    requestAnimationFrame(restore);
  }

  function renderAllPreservingScroll() {
    const state = getScrollState();
    renderAll();
    restoreScrollState(state);
  }

  function undo() {
    if (historyIndex <= 0) return;

    const state = getScrollState();

    closeInlineInput();
    song = clone(history[--historyIndex].song);
    selectedChordId = null;
    replaceCurrentSong();
    updateHistoryButtons();
    renderAll();
    restoreScrollState(state);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;

    const state = getScrollState();

    closeInlineInput();
    song = clone(history[++historyIndex].song);
    selectedChordId = null;
    replaceCurrentSong();
    updateHistoryButtons();
    renderAll();
    restoreScrollState(state);
  }

  function replaceCurrentSong() {
    if (!song) return;

    const index = store.songs.findIndex(item => item.id === song.id);

    if (index >= 0) {
      store.songs[index] = song;
    }

    persistStore();
  }

  function normalizeLines(text) {
    const previous = song.lines || [];

    return String(text).split('\n').map((lineText, index) => ({
      id: previous[index]?.id || uid('line'),
      text: lineText
    }));
  }

  function applyLyrics(text) {
    song.lyrics = String(text);
    song.lines = normalizeLines(song.lyrics);

    const validIds = new Set(song.lines.map(line => line.id));

    song.chords = song.chords.filter(chord =>
      validIds.has(chord.lineId)
    );
  }

  function renderLyricWithChars(text) {
    const fragment = document.createDocumentFragment();

    [...text].forEach((char, index) => {
      const span = document.createElement('span');

      span.className = 'lyric-char';
      span.dataset.index = index;
      span.textContent = char === ' ' ? '\u00a0' : char;

      fragment.appendChild(span);
    });

    return fragment;
  }

  function getCharX(row, index) {
    const chars = row.querySelectorAll('.lyric-char');

    if (!chars.length) return 0;

    const rowRect = row.getBoundingClientRect();

    if (index >= chars.length) {
      return chars[chars.length - 1].getBoundingClientRect().right -
        rowRect.left;
    }

    return chars[index].getBoundingClientRect().left - rowRect.left;
  }

  function getCharIndexAtX(row, clientX) {
    const rowRect = row.getBoundingClientRect();
    const chars = [...row.querySelectorAll('.lyric-char')];
    const x = clientX - rowRect.left;

    const index = chars.findIndex(char => {
      const rect = char.getBoundingClientRect();
      return x < rect.left - rowRect.left + rect.width / 2;
    });

    return index < 0 ? chars.length : index;
  }

  function getChordById(id) {
    return song?.chords.find(chord => chord.id === id);
  }

  function getSelectedChord() {
    return getChordById(selectedChordId);
  }

  function renderLine(line, editable) {
    const row = document.createElement('div');

    row.className = editable ? 'score-line' : 'preview-line';
    row.dataset.lineId = line.id;

    const lyric = document.createElement('span');
    lyric.className = 'lyric-text';
    lyric.appendChild(renderLyricWithChars(line.text));
    row.appendChild(lyric);

    if (editable) {
      row.addEventListener('pointerup', event => {
        if (dragState || event.target.closest('.chord, .inline-chord-input')) {
          return;
        }

        const rect = row.getBoundingClientRect();
        const chars = [...row.querySelectorAll('.lyric-char')];
        const x = event.clientX - rect.left;

        let index = chars.findIndex(char => {
          const charRect = char.getBoundingClientRect();
          return x < charRect.left - rect.left + charRect.width / 2;
        });

        if (index < 0) index = chars.length;

        clearSelectedChord();
        showInlineInput(row, line.id, index, x);
      });
    }

    return row;
  }

  function renderChordsOnRow(row, lineId, editable) {
    song.chords
      .filter(chord => chord.lineId === lineId)
      .forEach(chord => {
        const element = document.createElement('button');

        element.type = 'button';
        element.className =
          `chord${chord.id === selectedChordId ? ' selected' : ''}`;
        element.textContent = chord.name;
        element.dataset.chordId = chord.id;

        const base = getCharX(row, chord.charIndex);
        element.style.left = `${base + chord.offset}px`;

        if (!editable) {
          element.disabled = true;
          element.style.pointerEvents = 'none';
          row.appendChild(element);
          return;
        }

        element.addEventListener('pointerdown', startDrag, {
          passive: false
        });

        element.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();

          if (suppressChordActivation) {
            suppressChordActivation = false;
            return;
          }

          const now = Date.now();
          const isSecondTap =
            lastTap.id === chord.id &&
            now - lastTap.time < DOUBLE_TAP_DELAY;

          lastTap = {
            id: chord.id,
            time: now
          };

          if (isSecondTap) {
            lastTap = { id: null, time: 0 };
            showExistingChordInput(row, element, chord);
          } else {
            selectChord(chord.id);
          }
        });

        element.addEventListener('dblclick', event => {
          event.preventDefault();
          event.stopPropagation();

          lastTap = { id: null, time: 0 };
          showExistingChordInput(row, element, chord);
        });

        row.appendChild(element);
      });
  }

  function renderEditor() {
    els.score.replaceChildren();

    song.lines.forEach(line => {
      const row = renderLine(line, true);
      els.score.appendChild(row);
      renderChordsOnRow(row, line.id, true);
    });
  }

  function renderPreview() {
    els.previewSheet.replaceChildren();

    const title = document.createElement('h2');
    title.textContent = song.title || '無題';

    const artist = document.createElement('p');
    artist.className = 'artist';
    artist.textContent = [
      song.artist,
      song.key ? `Key: ${song.key}` : '',
      Number(song.capo) ? `Capo: ${song.capo}` : ''
    ].filter(Boolean).join(' / ');

    const score = document.createElement('div');
    score.className = 'score';

    els.previewSheet.append(title, artist, score);

    song.lines.forEach(line => {
      const row = renderLine(line, false);
      score.appendChild(row);
      renderChordsOnRow(row, line.id, false);
    });
  }

  function fontCss(value) {
    return /[\s"'();{}]/.test(value)
      ? `"${value.replace(/"/g, '')}"`
      : value;
  }

  function renderFontSettings() {
    els.lyricFontSize.value = song.lyricFontSize;
    els.chordFontSize.value = song.chordFontSize;
    els.lyricFontSizeValue.textContent = song.lyricFontSize;
    els.chordFontSizeValue.textContent = song.chordFontSize;
    els.lyricFontFamily.value = song.lyricFontFamily;
    els.chordFontFamily.value = song.chordFontFamily;

    const root = document.documentElement;

    root.style.setProperty('--lyric-font-size', `${song.lyricFontSize}px`);
    root.style.setProperty('--chord-font-size', `${song.chordFontSize}px`);
    root.style.setProperty('--lyric-font-family', fontCss(song.lyricFontFamily));
    root.style.setProperty('--chord-font-family', fontCss(song.chordFontFamily));
  }

  function renderAll() {
    if (!song) return;

    normalizeSong(song);

    els.title.value = song.title;
    els.artist.value = song.artist;
    els.key.value = song.key;
    els.capo.value = song.capo;

    if (els.lyrics.value !== song.lyrics) {
      els.lyrics.value = song.lyrics;
    }

    renderFontSettings();
    renderEditor();
    renderPreview();
    updateMode();
    updateMobileControls();
  }

  function updateMode() {
    els.lyricsEditor.classList.toggle('hidden', mode !== 'lyrics');
    els.chordsEditor.classList.toggle('hidden', mode !== 'chords');
    els.preview.classList.toggle('hidden', mode !== 'preview');

    Object.entries(els.modes).forEach(([name, button]) => {
      button.classList.toggle('active', name === mode);
    });

    updateMobileControls();
  }

  function switchMode(nextMode) {
    closeInlineInput();
    mode = nextMode;
    updateMode();

    if (mode === 'chords') renderEditor();
    if (mode === 'preview') renderPreview();
  }

  function closeInlineInput() {
    inlineInput?.remove();
    inlineInput = null;
  }

  function showInlineInput(row, lineId, charIndex, x) {
    closeInlineInput();

    const input = document.createElement('input');

    inlineInput = input;
    input.className = 'inline-chord-input';
    input.type = 'text';
    input.placeholder = 'コード';
    input.autocomplete = 'off';
    input.style.left = `${x}px`;

    row.appendChild(input);
    input.focus();

    let done = false;
    let cancelled = false;

    const finish = () => {
      if (done || cancelled) return;

      done = true;
      const name = input.value.trim();

      if (name) {
        const base = getCharX(row, charIndex);

        song.chords.push({
          id: uid('chord'),
          name,
          lineId,
          charIndex,
          offset: x - base
        });

        commit('コード追加');
      }

      closeInlineInput();
      selectedChordId = null;
      renderAllPreservingScroll();
    };

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish();
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        cancelled = true;
        done = true;
        closeInlineInput();
      }
    });

    input.addEventListener('blur', () => {
      if (!cancelled) finish();
    });
  }

  function showExistingChordInput(row, chordElement, chord) {
    closeInlineInput();
    selectedChordId = chord.id;
    updateMobileControls();

    const input = document.createElement('input');

    inlineInput = input;
    input.className = 'inline-chord-input';
    input.type = 'text';
    input.value = chord.name;
    input.autocomplete = 'off';

    const rowRect = row.getBoundingClientRect();
    const chordRect = chordElement.getBoundingClientRect();

    input.style.left = `${
      chordRect.left + chordRect.width / 2 - rowRect.left
    }px`;

    row.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    let cancelled = false;

    const finish = () => {
      if (done || cancelled) return;

      done = true;
      const name = input.value.trim();

      if (name && name !== chord.name) {
        chord.name = name;
        commit('コード名変更');
      }

      closeInlineInput();
      selectedChordId = chord.id;
      renderAllPreservingScroll();
    };

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish();
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        cancelled = true;
        done = true;
        closeInlineInput();
      }
    });

        input.addEventListener('blur', () => {
      if (!cancelled) finish();
    });
  }

  function selectChord(id) {
    closeInlineInput();
    selectedChordId = id;

    els.score.querySelectorAll('.chord.selected').forEach(element => {
      element.classList.remove('selected');
    });

    const selected = [...els.score.querySelectorAll('.chord')]
      .find(element => element.dataset.chordId === id);

    selected?.classList.add('selected');
    updateMobileControls();
  }

  function clearSelectedChord() {
    selectedChordId = null;

    els.score.querySelectorAll('.chord.selected').forEach(element => {
      element.classList.remove('selected');
    });

    updateMobileControls();
  }

  function updateMobileControls() {
    const chord = getSelectedChord();
    const visible = mode === 'chords' && Boolean(chord);

    els.mobileControls.classList.toggle('hidden', !visible);

    if (chord) {
      els.selectedChordName.value = chord.name;
    }
  }
  
  async function copySelectedChord() {
    const chord = getSelectedChord();
    if (!chord) return;

    try {
      await navigator.clipboard.writeText(chord.name);

      if (els.status) {
        els.status.textContent = `コード「${chord.name}」をコピーしました`;
      }
    } catch {
      if (els.status) {
        els.status.textContent =
          'コピーできませんでした。HTTPS環境でお試しください';
      }
    }
  }

  async function pasteChord() {
    if (!song) return;

    let name = '';

    try {
      name = (await navigator.clipboard.readText()).trim();
    } catch {
      if (els.status) {
        els.status.textContent =
          '貼り付けできませんでした。ブラウザの許可を確認してください';
      }
      return;
    }

    if (!name) return;

    const baseChord = getSelectedChord();

    if (baseChord) {
      song.chords.push({
        id: uid('chord'),
        name,
        lineId: baseChord.lineId,
        charIndex: baseChord.charIndex,
        offset: baseChord.offset
      });

      commit('コード貼り付け');
      selectedChordId = song.chords[song.chords.length - 1].id;
      renderAllPreservingScroll();
      return;
    }

    if (els.status) {
      els.status.textContent =
        '貼り付ける位置のコードを先に選択してください';
    }
  }

  function deleteSelected() {
    const chord = getSelectedChord();
    if (!chord) return;

    song.chords = song.chords.filter(item => item.id !== chord.id);
    selectedChordId = null;

    commit('コード削除');
    renderAllPreservingScroll();
  }

  function nudge(amount) {
    const chord = getSelectedChord();
    if (!chord) return;

    chord.offset = Number(chord.offset || 0) + amount;
    commit('コード位置調整');
    renderAllPreservingScroll();
  }

  function getTargetRow(clientY) {
    const rows = [...els.score.querySelectorAll('.score-line')];
    if (!rows.length) return null;

    return rows.reduce((nearest, row) => {
      const rect = row.getBoundingClientRect();
      const nearestRect = nearest.getBoundingClientRect();

      return Math.abs(clientY - (rect.top + rect.height / 2)) <
        Math.abs(clientY - (nearestRect.top + nearestRect.height / 2))
        ? row
        : nearest;
    });
  }

  function startDrag(event) {
    if (mode !== 'chords') return;

    event.preventDefault();
    event.stopPropagation();

    const element = event.currentTarget;
    const chord = getChordById(element.dataset.chordId);
    const row = element.closest('.score-line');

    if (!chord || !row) return;

    const rect = element.getBoundingClientRect();

    selectedChordId = chord.id;

    dragState = {
      id: chord.id,
      pointerId: event.pointerId,
      element,
      currentRow: row,
      grabDelta: event.clientX - (rect.left + rect.width / 2),
      originalLineId: chord.lineId,
      originalCharIndex: chord.charIndex,
      originalOffset: Number(chord.offset || 0),
      moved: false
    };

    element.setPointerCapture?.(event.pointerId);

    document.addEventListener('pointermove', moveDrag, {
      passive: false
    });

    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    event.preventDefault();

    const chord = getChordById(dragState.id);
    const targetRow = getTargetRow(event.clientY);

    if (!chord || !targetRow) return;

    const rowRect = targetRow.getBoundingClientRect();
    const charIndex = getCharIndexAtX(targetRow, event.clientX);
    const base = getCharX(targetRow, charIndex);

    const centerX =
      event.clientX - rowRect.left - dragState.grabDelta;

    const offset = centerX - base;
    const lineId = targetRow.dataset.lineId;

    if (
      chord.lineId !== lineId ||
      chord.charIndex !== charIndex ||
      Math.abs(offset - dragState.originalOffset) >= DRAG_THRESHOLD
    ) {
      dragState.moved = true;
    }

    chord.lineId = lineId;
    chord.charIndex = charIndex;
    chord.offset = offset;

    if (dragState.currentRow !== targetRow) {
      targetRow.appendChild(dragState.element);
      dragState.currentRow = targetRow;
    }

    dragState.element.style.left = `${base + offset}px`;
  }

  function endDrag(event) {
    if (
      !dragState ||
      (event && event.pointerId !== dragState.pointerId)
    ) {
      return;
    }

    const finished = dragState;

    document.removeEventListener('pointermove', moveDrag);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);

    dragState = null;
    selectedChordId = finished.id;

    if (finished.moved) {
      suppressChordActivation = true;
      commit('コード移動');
      renderAllPreservingScroll();

      setTimeout(() => {
        suppressChordActivation = false;
      }, 0);
    } else {
      updateMobileControls();
    }
  }

  function updateMeta() {
    const before = JSON.stringify({
      title: song.title,
      artist: song.artist,
      key: song.key,
      capo: song.capo
    });

    song.title = els.title.value;
    song.artist = els.artist.value;
    song.key = els.key.value;
    song.capo = clamp(els.capo.value, 0, 12, 0);

    const after = JSON.stringify({
      title: song.title,
      artist: song.artist,
      key: song.key,
      capo: song.capo
    });

    if (before === after) return;

    commit('曲情報を編集');
    renderHome();
  }

  function updateFontSize(type, value) {
    const fallback = type === 'lyricFontSize'
      ? DEFAULT_LYRIC_FONT_SIZE
      : DEFAULT_CHORD_FONT_SIZE;

    const size = clamp(
      value,
      MIN_FONT_SIZE,
      MAX_FONT_SIZE,
      fallback
    );

    if (song[type] === size) return;

    song[type] = size;
    commit(type === 'lyricFontSize'
      ? '歌詞サイズ変更'
      : 'コードサイズ変更');

    renderAll();
  }

  function updateFontFamily(type, value) {
    const fallback = type === 'lyricFontFamily'
      ? DEFAULT_LYRIC_FONT_FAMILY
      : DEFAULT_CHORD_FONT_FAMILY;

    const family = normalizeFontFamily(value, fallback);

    if (song[type] === family) return;

    song[type] = family;
    commit(type === 'lyricFontFamily'
      ? '歌詞フォント変更'
      : 'コードフォント変更');

    renderAll();
  }

  function resetFontSizes() {
    if (
      song.lyricFontSize === DEFAULT_LYRIC_FONT_SIZE &&
      song.chordFontSize === DEFAULT_CHORD_FONT_SIZE
    ) {
      return;
    }

    song.lyricFontSize = DEFAULT_LYRIC_FONT_SIZE;
    song.chordFontSize = DEFAULT_CHORD_FONT_SIZE;

    commit('文字サイズを標準に戻す');
    renderAll();
  }

  function openEditor(id) {
    const target = store.songs.find(item => item.id === id);
    if (!target) return;

    closeInlineInput();

    song = normalizeSong(target);
    store.currentSongId = song.id;
    persistStore();

    selectedChordId = null;
    mode = 'lyrics';
    resetHistory();

    els.home.classList.add('hidden');
    els.editor.classList.remove('hidden');

    renderAll();
  }

  function showHome() {
    closeInlineInput();

    if (dragState) endDrag();

    persistStore();

    els.editor.classList.add('hidden');
    els.home.classList.remove('hidden');

    renderHome();
  }

  function duplicateSong(id) {
    const source = store.songs.find(item => item.id === id);
    if (!source) return;

    const copied = clone(source);
    copied.id = uid('song');
    copied.title = `${source.title || '無題'} のコピー`;
    copied.updatedAt = Date.now();

    const lineIdMap = new Map();

    copied.lines.forEach(line => {
      const oldId = line.id;
      line.id = uid('line');
      lineIdMap.set(oldId, line.id);
    });

    copied.chords.forEach(chord => {
      chord.id = uid('chord');
      chord.lineId = lineIdMap.get(chord.lineId);
    });

    store.songs.push(normalizeSong(copied));
    persistStore();
    renderHome();
  }

  function deleteSong(id) {
    const target = store.songs.find(item => item.id === id);

    if (
      !target ||
      !window.confirm(`「${target.title || '無題'}」を削除しますか？`)
    ) {
      return;
    }

    store.songs = store.songs.filter(item => item.id !== id);

    if (store.currentSongId === id) {
      store.currentSongId = null;
    }

    if (song?.id === id) {
      song = null;
      els.editor.classList.add('hidden');
      els.home.classList.remove('hidden');
    }

    persistStore();
    renderHome();
  }

  function renderHome() {
    els.songList.replaceChildren();

    els.songCount.textContent = `${store.songs.length}曲`;
    els.emptyMessage.classList.toggle(
      'hidden',
      store.songs.length > 0
    );

    [...store.songs]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach(item => {
        const card = document.createElement('article');
        const title = document.createElement('h3');
        const artist = document.createElement('p');
        const meta = document.createElement('p');
        const updated = document.createElement('p');
        const actions = document.createElement('div');
        const open = document.createElement('button');
        const duplicate = document.createElement('button');
        const remove = document.createElement('button');

        card.className = 'song-card';
        title.textContent = item.title || '無題';
        artist.textContent = item.artist || 'アーティスト未設定';

        meta.textContent = [
          item.key ? `Key: ${item.key}` : '',
          Number(item.capo) ? `Capo: ${item.capo}` : ''
        ].filter(Boolean).join(' / ') || '曲情報未設定';

        updated.textContent =
          `更新: ${new Date(item.updatedAt).toLocaleString('ja-JP')}`;

        actions.className = 'song-card-actions';

        open.textContent = '開く';
        duplicate.textContent = '複製';
        remove.textContent = '削除';
        remove.className = 'delete-song';

        open.addEventListener('click', () => openEditor(item.id));
        duplicate.addEventListener('click', () => duplicateSong(item.id));
        remove.addEventListener('click', () => deleteSong(item.id));

        actions.append(open, duplicate, remove);
        card.append(title, artist, meta, updated, actions);
        els.songList.appendChild(card);
      });
  }

  els.newSong.addEventListener('click', () => {
    const fresh = createSong();

    store.songs.push(fresh);
    song = fresh;
    store.currentSongId = fresh.id;
    persistStore();
    openEditor(fresh.id);
  });

  els.homeBtn.addEventListener('click', showHome);

  els.lyrics.addEventListener('focus', () => {
    lyricsBeforeEdit = song?.lyrics || '';
  });

  els.lyrics.addEventListener('input', () => {
    if (!song) return;

    applyLyrics(els.lyrics.value);
    renderEditor();
    saveSong();
  });

  els.lyrics.addEventListener('blur', () => {
    if (song && lyricsBeforeEdit !== song.lyrics) {
      commit('歌詞を編集');
    }
  });

  [els.title, els.artist, els.key, els.capo].forEach(input => {
    input.addEventListener('change', updateMeta);
  });

  els.lyricFontSize.addEventListener('input', event => {
    updateFontSize('lyricFontSize', event.target.value);
  });

  els.chordFontSize.addEventListener('input', event => {
    updateFontSize('chordFontSize', event.target.value);
  });

  els.lyricFontFamily.addEventListener('change', event => {
    updateFontFamily('lyricFontFamily', event.target.value);
  });

  els.chordFontFamily.addEventListener('change', event => {
    updateFontFamily('chordFontFamily', event.target.value);
  });

  els.resetFontSize.addEventListener('click', resetFontSizes);
  els.copyChord.addEventListener('click', copySelectedChord);
  els.pasteChord.addEventListener('click', pasteChord);
  els.modes.lyrics.addEventListener('click', () => switchMode('lyrics'));
  els.modes.chords.addEventListener('click', () => switchMode('chords'));
  els.modes.preview.addEventListener('click', () => switchMode('preview'));
  els.undo.addEventListener('click', undo);
  els.redo.addEventListener('click', redo);
  els.deleteChord.addEventListener('click', deleteSelected);
  els.nudgeLeft.addEventListener('click', () => nudge(-1));
  els.nudgeRight.addEventListener('click', () => nudge(1));

  els.selectedChordName.addEventListener('change', () => {
    const chord = getSelectedChord();
    const name = els.selectedChordName.value.trim();

    if (!chord || !name || name === chord.name) return;

    chord.name = name;
    commit('コード名変更');
    renderAllPreservingScroll();
  });

  els.print.addEventListener('click', () => {
    closeInlineInput();
    renderPreview();
    requestAnimationFrame(() => window.print());
  });

  document.addEventListener('pointerdown', event => {
    const chord = event.target.closest('.chord');
    const controls = event.target.closest('.mobile-controls');
    const input = event.target.closest('.inline-chord-input');

    if (inlineInput && !input) {
      setTimeout(() => inlineInput?.blur(), 0);
    }

    if (selectedChordId && !chord && !controls && !input) {
      clearSelectedChord();
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (inlineInput) return;
    if (mode !== 'chords' || !getSelectedChord()) return;
    if (event.target.matches('input, textarea, select')) return;
    
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copySelectedChord();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      pasteChord();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      nudge(-1);
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      nudge(1);
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
    }

    if (event.key === 'Escape') {
      clearSelectedChord();
    }
  });

  if (store.songs.length) {
    song =
      store.songs.find(item => item.id === store.currentSongId) ||
      store.songs[0];

    normalizeSong(song);
    resetHistory();
  }

  renderHome();
})();
