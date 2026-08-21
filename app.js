(() => {
  'use strict';

  const STORAGE_KEY = 'guitar-score-app-v1';
  const MAX_HISTORY = 100;
  const DEFAULT_LYRIC_FONT_SIZE = 16;
  const DEFAULT_CHORD_FONT_SIZE = 16;
  const DEFAULT_LYRIC_FONT_FAMILY = 'sans-serif';
  const DEFAULT_CHORD_FONT_FAMILY = 'monospace';
  const MIN_FONT_SIZE = 12;
  const MAX_FONT_SIZE = 32;

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
    status: $('#status'),
    undo: $('#undoBtn'),
    redo: $('#redoBtn'),
    print: $('#printBtn'),
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
  let lyricsTimer = null;

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clampFontSize(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, number))
      : fallback;
  }

  function normalizeFontFamily(value, fallback) {
    return typeof value === 'string' && value.trim() ? value : fallback;
  }

  function normalizeFontSizes(target) {
    target.lyricFontSize = clampFontSize(
      target.lyricFontSize,
      DEFAULT_LYRIC_FONT_SIZE
    );
    target.chordFontSize = clampFontSize(
      target.chordFontSize,
      DEFAULT_CHORD_FONT_SIZE
    );
    return target;
  }

  function normalizeSong(target) {
    if (!target || typeof target !== 'object') return null;

    target.id = target.id || uid('song');
    target.title = String(target.title || '');
    target.artist = String(target.artist || '');
    target.lyrics = String(target.lyrics || '');
    target.key = String(target.key || '');
    target.capo = Math.max(0, Number(target.capo) || 0);
    target.updatedAt = Number(target.updatedAt) || Date.now();
    target.chords = Array.isArray(target.chords) ? target.chords : [];
    target.sections = Array.isArray(target.sections) ? target.sections : [];
    target.lines = Array.isArray(target.lines) && target.lines.length
      ? target.lines
      : [{ id: uid('line'), text: '' }];

    target.lines.forEach(line => {
      line.id = line.id || uid('line');
      line.text = String(line.text || '');
    });

    target.chords.forEach(chord => {
      chord.id = chord.id || uid('chord');
      chord.lineId = chord.lineId || target.lines[0].id;
      chord.charIndex = Math.max(0, Number(chord.charIndex) || 0);
      chord.offset = Number(chord.offset) || 0;
      chord.name = String(chord.name || '');
    });

    target.lyricFontFamily = normalizeFontFamily(
      target.lyricFontFamily,
      DEFAULT_LYRIC_FONT_FAMILY
    );
    target.chordFontFamily = normalizeFontFamily(
      target.chordFontFamily,
      DEFAULT_CHORD_FONT_FAMILY
    );

    normalizeFontSizes(target);
    return target;
  }

  function createSong() {
    return {
      id: uid('song'),
      title: '',
      artist: '',
      lyrics: '',
      lines: [{ id: uid('line'), text: '' }],
      chords: [],
      sections: [],
      key: '',
      capo: 0,
      lyricFontSize: DEFAULT_LYRIC_FONT_SIZE,
      chordFontSize: DEFAULT_CHORD_FONT_SIZE,
      lyricFontFamily: DEFAULT_LYRIC_FONT_FAMILY,
      chordFontFamily: DEFAULT_CHORD_FONT_FAMILY,
      updatedAt: Date.now()
    };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 2, songs: [], currentSongId: null };

      const saved = JSON.parse(raw);

      if (saved && Array.isArray(saved.songs)) {
        saved.songs = saved.songs.map(normalizeSong).filter(Boolean);
        saved.version = 2;
        saved.currentSongId = saved.currentSongId || null;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        return saved;
      }

      if (saved && typeof saved === 'object') {
        const migratedSong = normalizeSong(saved);
        const migrated = {
          version: 2,
          songs: migratedSong ? [migratedSong] : [],
          currentSongId: migratedSong ? migratedSong.id : null
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (error) {
      console.warn('保存データの読み込みに失敗しました', error);
    }

    return { version: 2, songs: [], currentSongId: null };
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
      touchSong();
      persistStore();
      if (els.status) {
        els.status.textContent = '自動保存しました';
        setTimeout(() => {
          if (els.status) els.status.textContent = '';
        }, 1500);
      }
    }, 100);
  }

  function commit(label = '変更') {
    if (!song) return;

    touchSong();
    history = history.slice(0, historyIndex + 1);
    history.push({ song: clone(song), label });

    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
    saveSong();
  }

  function resetHistory() {
    history = [{ song: clone(song), label: '初期状態' }];
    historyIndex = 0;
  }

  function replaceCurrentSong() {
    if (!song) return;
    const index = store.songs.findIndex(item => item.id === song.id);
    if (index >= 0) store.songs[index] = song;
    saveSong();
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
      window.scrollTo({ left: state.pageX, top: state.pageY, behavior: 'auto' });
      if (els.score) {
        els.score.scrollLeft = state.scoreLeft;
        els.score.scrollTop = state.scoreTop;
      }
    };

    restore();
    requestAnimationFrame(() => {
      restore();
      setTimeout(restore, 80);
    });
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
    replaceCurrentSong();
    selectedChordId = null;
    renderAll();
    restoreScrollState(state);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;

    const state = getScrollState();
    closeInlineInput();
    song = clone(history[++historyIndex].song);
    replaceCurrentSong();
    selectedChordId = null;
    renderAll();
    restoreScrollState(state);
  }

  function normalizeLines(text) {
    const previous = song.lines || [];
    return String(text).split('\n').map((lineText, index) => ({
      id: previous[index]?.id || uid('line'),
      text: lineText
    }));
  }

  function syncLyrics(text, shouldCommit = true) {
    const before = JSON.stringify(song);

    song.lyrics = String(text);
    song.lines = normalizeLines(song.lyrics);

    const validIds = new Set(song.lines.map(line => line.id));
    song.chords = song.chords.filter(chord => validIds.has(chord.lineId));

    if (shouldCommit && before !== JSON.stringify(song)) {
      commit('歌詞を編集');
    }

    renderAll();
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
      return chars[chars.length - 1].getBoundingClientRect().right - rowRect.left;
    }

    return chars[index].getBoundingClientRect().left - rowRect.left;
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
        if (
          dragState ||
          event.target.closest('.chord, .inline-chord-input')
        ) return;

        const rect = row.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const chars = [...row.querySelectorAll('.lyric-char')];

        let index = chars.findIndex(char => (
          x < char.getBoundingClientRect().left -
            rect.left +
            char.getBoundingClientRect().width / 2
        ));

        if (index < 0) index = chars.length;

        clearSelectedChord();
        showInlineInput(row, line.id, index, x);
      });
    }

    return row;
  }

  function renderChordsOnRow(row, lineId, editable = true) {
  song.chords
    .filter(chord => chord.lineId === lineId)
    .forEach(chord => {
      const element = document.createElement('button');

      element.type = 'button';
      element.className = `chord${
        chord.id === selectedChordId ? ' selected' : ''
      }`;
      element.textContent = chord.name;
      element.dataset.chordId = chord.id;

      const base = getCharX(row, chord.charIndex);
      element.style.left = `${
        base + (Number(chord.offset) || 0)
      }px`;

      if (!editable) {
        element.disabled = true;
        element.style.pointerEvents = 'none';
        row.appendChild(element);
        return;
      }

      element.addEventListener(
        'pointerdown',
        event => {
          startDrag(event);
        },
        { passive: false }
      );

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
          now - lastTap.time < 450;

        lastTap = {
          id: chord.id,
          time: now
        };

        if (isSecondTap) {
          showExistingChordInput(row, element, chord);
        } else {
          selectChord(chord.id);
        }
      });

      element.addEventListener('dblclick', event => {
        event.preventDefault();
        event.stopPropagation();

        showExistingChordInput(row, element, chord);
        lastTap = { id: null, time: 0 };
      });

      row.appendChild(element);
    });
}

  function renderEditor() {
    els.score.replaceChildren();

    song.lines.forEach(line => {
      const row = renderLine(line, true);
      els.score.appendChild(row);
      renderChordsOnRow(row, line.id);
    });
  }

  function renderPreview() {
    closeInlineInput();
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
      renderChordsOnRow(row, line.id);
    });
  }

  function fontCss(value) {
    return value.includes(' ') || /[ぁ-んァ-ン一-龯]/.test(value)
      ? `"${value}"`
      : value;
  }

  function renderFontSettings() {
    const lyricSize = clampFontSize(song.lyricFontSize, DEFAULT_LYRIC_FONT_SIZE);
    const chordSize = clampFontSize(song.chordFontSize, DEFAULT_CHORD_FONT_SIZE);

    song.lyricFontSize = lyricSize;
    song.chordFontSize = chordSize;

    els.lyricFontSize.value = lyricSize;
    els.chordFontSize.value = chordSize;
    els.lyricFontSizeValue.textContent = lyricSize;
    els.chordFontSizeValue.textContent = chordSize;
    els.lyricFontFamily.value = song.lyricFontFamily;
    els.chordFontFamily.value = song.chordFontFamily;

    document.documentElement.style.setProperty('--lyric-font-size', `${lyricSize}px`);
    document.documentElement.style.setProperty('--chord-font-size', `${chordSize}px`);
    document.documentElement.style.setProperty('--lyric-font-family', fontCss(song.lyricFontFamily));
    document.documentElement.style.setProperty('--chord-font-family', fontCss(song.chordFontFamily));
  }

  function renderAll() {
    if (!song) return;

    normalizeSong(song);
    els.title.value = song.title;
    els.artist.value = song.artist;
    els.key.value = song.key;
    els.capo.value = song.capo;

    if (els.lyrics.value !== song.lyrics) els.lyrics.value = song.lyrics;

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

  function switchMode(next) {
    closeInlineInput();
    mode = next;
    updateMode();

    if (mode === 'chords') requestAnimationFrame(renderEditor);
    if (mode === 'preview') requestAnimationFrame(renderPreview);
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
    input.select();

    let closed = false;
    let cancelled = false;

    const finish = () => {
      if (closed || cancelled) return;
      closed = true;

      const name = input.value.trim();
      if (name && input.isConnected) {
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
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelled = true;
        closed = true;
        closeInlineInput();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!cancelled && input.isConnected) finish();
      }, 80);
    });
  }

  function showExistingChordInput(row, chordElement, chord) {
    const scrollState = getScrollState();
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
    const x = chordRect.left + chordRect.width / 2 - rowRect.left;

    input.style.left = `${x}px`;
    row.appendChild(input);
    input.focus();
    input.select();

    let closed = false;
    let cancelled = false;

    const cancel = () => {
      if (closed) return;
      closed = true;
      cancelled = true;
      closeInlineInput();
      restoreScrollState(scrollState);
    };

    const finish = () => {
      if (closed || cancelled) return;
      closed = true;

      const name = input.value.trim();

      if (name && name !== chord.name) {
        chord.name = name;
        commit('コード名変更');
      }

      closeInlineInput();
      selectedChordId = chord.id;
      renderAllPreservingScroll();
      restoreScrollState(scrollState);
    };

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!cancelled && input.isConnected) finish();
      }, 80);
    });
  }

  function closeInlineInput() {
    if (inlineInput) {
      inlineInput.remove();
      inlineInput = null;
    }
  }

  function selectChord(id) {
    const state = getScrollState();
    closeInlineInput();
    selectedChordId = id;
    updateMobileControls();
    renderEditor();
    restoreScrollState(state);
  }

  function clearSelectedChord() {
    selectedChordId = null;
    updateMobileControls();
    document.querySelectorAll('.chord.selected').forEach(element => {
      element.classList.remove('selected');
    });
  }

  function updateMobileControls() {
    const chord = getSelectedChord();
    els.mobileControls.classList.toggle(
      'hidden',
      mode !== 'chords' || !chord
    );
    if (chord) els.selectedChordName.value = chord.name;
  }

  function deleteSelected() {
    const chord = getSelectedChord();
    if (!chord) return;

    closeInlineInput();
    song.chords = song.chords.filter(item => item.id !== chord.id);
    selectedChordId = null;
    commit('コード削除');
    renderAllPreservingScroll();
  }

  function nudge(amount) {
    const chord = getSelectedChord();
    if (!chord) return;

    chord.offset = Number(chord.offset || 0) + amount;
    const id = chord.id;
    commit('コード微調整');
    renderAllPreservingScroll();
    selectedChordId = id;
    updateMobileControls();
  }

  function startDrag(event) {
    if (mode !== 'chords') return;

    event.preventDefault();
    event.stopPropagation();

    const element = event.currentTarget;
    const chord = getChordById(element.dataset.chordId);
    if (!chord) return;

    const rect = element.getBoundingClientRect();
    selectedChordId = chord.id;
    updateMobileControls();

    dragState = {
      id: chord.id,
      pointerId: event.pointerId,
      chordElement: element,
      grabDelta: event.clientX - (rect.left + rect.width / 2),
      originalOffset: Number(chord.offset || 0),
      moved: false
    };

    element.setPointerCapture?.(event.pointerId);
    document.addEventListener('pointermove', moveDrag, { passive: false });
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    event.preventDefault();

    const chord = getChordById(dragState.id);
    const row = dragState.chordElement.closest('.score-line');
    if (!chord || !row) return;

    const rect = row.getBoundingClientRect();
    const base = getCharX(row, chord.charIndex);
    const center = event.clientX - rect.left - dragState.grabDelta;

    chord.offset = center - base;

    if (Math.abs(chord.offset - dragState.originalOffset) > 2) {
      dragState.moved = true;
    }

    dragState.chordElement.style.left = `${base + chord.offset}px`;
  }

  function endDrag(event) {
    if (
      !dragState ||
      (event && event.pointerId !== dragState.pointerId)
    ) return;

    const finished = dragState;

    document.removeEventListener('pointermove', moveDrag);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);

    dragState = null;
    suppressChordActivation = finished.moved;

    if (finished.moved) commit('コード移動');

    selectedChordId = finished.id;
    renderAllPreservingScroll();
  }

  function updateMeta() {
    song.title = els.title.value;
    song.artist = els.artist.value;
    song.key = els.key.value;
    song.capo = Math.max(0, Number(els.capo.value) || 0);
    commit('曲情報を編集');
    renderHome();
  }

  function updateFontSize(type, value) {
    const fallback = type === 'lyricFontSize'
      ? DEFAULT_LYRIC_FONT_SIZE
      : DEFAULT_CHORD_FONT_SIZE;

    const size = clampFontSize(value, fallback);
    if (song[type] === size) return;

    song[type] = size;
    commit(type === 'lyricFontSize' ? '歌詞サイズ変更' : 'コードサイズ変更');
    renderAll();
  }

  function updateFontFamily(type, value) {
    const fallback = type === 'lyricFontFamily'
      ? DEFAULT_LYRIC_FONT_FAMILY
      : DEFAULT_CHORD_FONT_FAMILY;

    const family = normalizeFontFamily(value, fallback);
    if (song[type] === family) return;

    song[type] = family;
    commit(type === 'lyricFontFamily' ? '歌詞フォント変更' : 'コードフォント変更');
    renderAll();
  }

  function resetFontSizes() {
    if (
      song.lyricFontSize === DEFAULT_LYRIC_FONT_SIZE &&
      song.chordFontSize === DEFAULT_CHORD_FONT_SIZE
    ) return;

    song.lyricFontSize = DEFAULT_LYRIC_FONT_SIZE;
    song.chordFontSize = DEFAULT_CHORD_FONT_SIZE;
    commit('文字サイズを標準に戻す');
    renderAll();
  }

  function openEditor(id) {
    const target = store.songs.find(item => item.id === id);
    if (!target) return;

    closeInlineInput();
    song = target;
    normalizeSong(song);
    store.currentSongId = song.id;
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

    const idMap = new Map();
    copied.lines.forEach(line => {
      const oldId = line.id;
      line.id = uid('line');
      idMap.set(oldId, line.id);
    });

    copied.chords.forEach(chord => {
      chord.id = uid('chord');
      chord.lineId = idMap.get(chord.lineId) || chord.lineId;
    });

    store.songs.push(copied);
    persistStore();
    renderHome();
  }

  function deleteSong(id) {
    const target = store.songs.find(item => item.id === id);

    if (
      !target ||
      !window.confirm(`「${target.title || '無題'}」を削除しますか？`)
    ) return;

    store.songs = store.songs.filter(item => item.id !== id);

    if (store.currentSongId === id) store.currentSongId = null;
    if (song?.id === id) song = null;

    persistStore();
    renderHome();
  }

  function renderHome() {
    els.songList.replaceChildren();
    els.songCount.textContent = `${store.songs.length}曲`;
    els.emptyMessage.classList.toggle('hidden', store.songs.length !== 0);

    [...store.songs]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
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

        updated.textContent = `更新: ${new Date(
          item.updatedAt || Date.now()
        ).toLocaleString('ja-JP')}`;

        actions.className = 'song-card-actions';
        open.textContent = '開く';
        duplicate.textContent = '複製';
        remove.className = 'delete-song';
        remove.textContent = '削除';

        open.onclick = () => openEditor(item.id);
        duplicate.onclick = () => duplicateSong(item.id);
        remove.onclick = () => deleteSong(item.id);

        actions.append(open, duplicate, remove);
        card.append(title, artist, meta, updated, actions);
        els.songList.appendChild(card);
      });
  }

  els.newSong.onclick = () => {
    const fresh = createSong();
    store.songs.push(fresh);
    persistStore();
    openEditor(fresh.id);
  };

  els.homeBtn.onclick = showHome;

  els.lyrics.oninput = () => {
    clearTimeout(lyricsTimer);
    lyricsTimer = setTimeout(() => syncLyrics(els.lyrics.value), 250);
  };

  [els.title, els.artist, els.key, els.capo]
    .forEach(input => input.addEventListener('change', updateMeta));

  els.lyricFontSize.oninput = event => {
    updateFontSize('lyricFontSize', event.target.value);
  };

  els.chordFontSize.oninput = event => {
    updateFontSize('chordFontSize', event.target.value);
  };

  els.lyricFontFamily.onchange = event => {
    updateFontFamily('lyricFontFamily', event.target.value);
  };

  els.chordFontFamily.onchange = event => {
    updateFontFamily('chordFontFamily', event.target.value);
  };

  els.resetFontSize.onclick = resetFontSizes;
  els.modes.lyrics.onclick = () => switchMode('lyrics');
  els.modes.chords.onclick = () => switchMode('chords');
  els.modes.preview.onclick = () => switchMode('preview');
  els.undo.onclick = undo;
  els.redo.onclick = redo;

  els.print.onclick = () => {
    closeInlineInput();
    renderPreview();
    requestAnimationFrame(() => window.print());
  };

  window.onbeforeprint = () => {
    closeInlineInput();
    renderPreview();
    els.preview.classList.remove('hidden');
  };

  document.addEventListener('pointerdown', event => {
    const clickedChord = event.target.closest('.chord');
    const clickedControls = event.target.closest('.mobile-controls');
    const clickedInput = event.target.closest('.inline-chord-input');

    if (inlineInput && !clickedInput) {
      const active = inlineInput;
      setTimeout(() => {
        if (active.isConnected) active.blur();
      }, 0);
    }

    if (
      selectedChordId &&
      !clickedChord &&
      !clickedControls &&
      !clickedInput
    ) {
      clearSelectedChord();
    }
  }, true);

  els.mobileControls?.addEventListener('pointerdown', event => {
    event.stopPropagation();
  });

  $('#deleteChordBtn')?.addEventListener('pointerup', event => {
    event.preventDefault();
    event.stopPropagation();
    deleteSelected();
  });

  $('#nudgeLeftBtn')?.addEventListener('pointerup', event => {
    event.preventDefault();
    event.stopPropagation();
    nudge(-1);
  });

  $('#nudgeRightBtn')?.addEventListener('pointerup', event => {
    event.preventDefault();
    event.stopPropagation();
    nudge(1);
  });

  els.selectedChordName?.addEventListener('change', () => {
    const chord = getSelectedChord();
    const name = els.selectedChordName.value.trim();

    if (!chord || !name || name === chord.name) return;

    chord.name = name;
    commit('コード名変更');
    renderAllPreservingScroll();
    selectedChordId = chord.id;
    updateMobileControls();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && inlineInput) {
      event.preventDefault();
      inlineInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return;
    }

    if (
      mode !== 'chords' ||
      !getSelectedChord() ||
      event.target.matches('input, textarea')
    ) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      nudge(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      nudge(1);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === 'Escape') {
      clearSelectedChord();
      renderEditor();
    }
  });

  if (store.songs.length) {
    song = store.songs.find(item => item.id === store.currentSongId) ||
      store.songs[0];
    normalizeSong(song);
    resetHistory();
  }

  renderHome();
})();(() => {
  'use strict';

  const STORAGE_KEY = 'guitar-score-app-v1';
  const MAX_HISTORY = 100;
  const DEFAULT_LYRIC_FONT_SIZE = 16;
  const DEFAULT_CHORD_FONT_SIZE = 16;
  const DEFAULT_LYRIC_FONT_FAMILY = 'sans-serif';
  const DEFAULT_CHORD_FONT_FAMILY = 'monospace';
  const MIN_FONT_SIZE = 12;
  const MAX_FONT_SIZE = 32;

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
    status: $('#status'),
    undo: $('#undoBtn'),
    redo: $('#redoBtn'),
    print: $('#printBtn'),
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
  let lyricsTimer = null;

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clampFontSize(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, number))
      : fallback;
  }

  function normalizeFontFamily(value, fallback) {
    return typeof value === 'string' && value.trim() ? value : fallback;
  }

  function normalizeFontSizes(target) {
    target.lyricFontSize = clampFontSize(
      target.lyricFontSize,
      DEFAULT_LYRIC_FONT_SIZE
    );
    target.chordFontSize = clampFontSize(
      target.chordFontSize,
      DEFAULT_CHORD_FONT_SIZE
    );
    return target;
  }

  function normalizeSong(target) {
    if (!target || typeof target !== 'object') return null;

    target.id = target.id || uid('song');
    target.title = String(target.title || '');
    target.artist = String(target.artist || '');
    target.lyrics = String(target.lyrics || '');
    target.key = String(target.key || '');
    target.capo = Math.max(0, Number(target.capo) || 0);
    target.updatedAt = Number(target.updatedAt) || Date.now();
    target.chords = Array.isArray(target.chords) ? target.chords : [];
    target.sections = Array.isArray(target.sections) ? target.sections : [];
    target.lines = Array.isArray(target.lines) && target.lines.length
      ? target.lines
      : [{ id: uid('line'), text: '' }];

    target.lines.forEach(line => {
      line.id = line.id || uid('line');
      line.text = String(line.text || '');
    });

    target.chords.forEach(chord => {
      chord.id = chord.id || uid('chord');
      chord.lineId = chord.lineId || target.lines[0].id;
      chord.charIndex = Math.max(0, Number(chord.charIndex) || 0);
      chord.offset = Number(chord.offset) || 0;
      chord.name = String(chord.name || '');
    });

    target.lyricFontFamily = normalizeFontFamily(
      target.lyricFontFamily,
      DEFAULT_LYRIC_FONT_FAMILY
    );
    target.chordFontFamily = normalizeFontFamily(
      target.chordFontFamily,
      DEFAULT_CHORD_FONT_FAMILY
    );

    normalizeFontSizes(target);
    return target;
  }

  function createSong() {
    return {
      id: uid('song'),
      title: '',
      artist: '',
      lyrics: '',
      lines: [{ id: uid('line'), text: '' }],
      chords: [],
      sections: [],
      key: '',
      capo: 0,
      lyricFontSize: DEFAULT_LYRIC_FONT_SIZE,
      chordFontSize: DEFAULT_CHORD_FONT_SIZE,
      lyricFontFamily: DEFAULT_LYRIC_FONT_FAMILY,
      chordFontFamily: DEFAULT_CHORD_FONT_FAMILY,
      updatedAt: Date.now()
    };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 2, songs: [], currentSongId: null };

      const saved = JSON.parse(raw);

      if (saved && Array.isArray(saved.songs)) {
        saved.songs = saved.songs.map(normalizeSong).filter(Boolean);
        saved.version = 2;
        saved.currentSongId = saved.currentSongId || null;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        return saved;
      }

      if (saved && typeof saved === 'object') {
        const migratedSong = normalizeSong(saved);
        const migrated = {
          version: 2,
          songs: migratedSong ? [migratedSong] : [],
          currentSongId: migratedSong ? migratedSong.id : null
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (error) {
      console.warn('保存データの読み込みに失敗しました', error);
    }

    return { version: 2, songs: [], currentSongId: null };
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
      touchSong();
      persistStore();
      if (els.status) {
        els.status.textContent = '自動保存しました';
        setTimeout(() => {
          if (els.status) els.status.textContent = '';
        }, 1500);
      }
    }, 100);
  }

  function commit(label = '変更') {
    if (!song) return;

    touchSong();
    history = history.slice(0, historyIndex + 1);
    history.push({ song: clone(song), label });

    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
    saveSong();
  }

  function resetHistory() {
    history = [{ song: clone(song), label: '初期状態' }];
    historyIndex = 0;
  }

  function replaceCurrentSong() {
    if (!song) return;
    const index = store.songs.findIndex(item => item.id === song.id);
    if (index >= 0) store.songs[index] = song;
    saveSong();
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
      window.scrollTo({ left: state.pageX, top: state.pageY, behavior: 'auto' });
      if (els.score) {
        els.score.scrollLeft = state.scoreLeft;
        els.score.scrollTop = state.scoreTop;
      }
    };

    restore();
    requestAnimationFrame(() => {
      restore();
      setTimeout(restore, 80);
    });
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
    replaceCurrentSong();
    selectedChordId = null;
    renderAll();
    restoreScrollState(state);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;

    const state = getScrollState();
    closeInlineInput();
    song = clone(history[++historyIndex].song);
    replaceCurrentSong();
    selectedChordId = null;
    renderAll();
    restoreScrollState(state);
  }

  function normalizeLines(text) {
    const previous = song.lines || [];
    return String(text).split('\n').map((lineText, index) => ({
      id: previous[index]?.id || uid('line'),
      text: lineText
    }));
  }

  function syncLyrics(text, shouldCommit = true) {
    const before = JSON.stringify(song);

    song.lyrics = String(text);
    song.lines = normalizeLines(song.lyrics);

    const validIds = new Set(song.lines.map(line => line.id));
    song.chords = song.chords.filter(chord => validIds.has(chord.lineId));

    if (shouldCommit && before !== JSON.stringify(song)) {
      commit('歌詞を編集');
    }

    renderAll();
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
      return chars[chars.length - 1].getBoundingClientRect().right - rowRect.left;
    }

    return chars[index].getBoundingClientRect().left - rowRect.left;
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
        if (
          dragState ||
          event.target.closest('.chord, .inline-chord-input')
        ) return;

        const rect = row.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const chars = [...row.querySelectorAll('.lyric-char')];

        let index = chars.findIndex(char => (
          x < char.getBoundingClientRect().left -
            rect.left +
            char.getBoundingClientRect().width / 2
        ));

        if (index < 0) index = chars.length;

        clearSelectedChord();
        showInlineInput(row, line.id, index, x);
      });
    }

    return row;
  }

  function renderChordsOnRow(row, lineId) {
    song.chords
      .filter(chord => chord.lineId === lineId)
      .forEach(chord => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = `chord${chord.id === selectedChordId ? ' selected' : ''}`;
        element.textContent = chord.name;
        element.dataset.chordId = chord.id;

        const base = getCharX(row, chord.charIndex);
        element.style.left = `${base + (Number(chord.offset) || 0)}px`;

        element.addEventListener('pointerdown', event => {
          startDrag(event);
        }, { passive: false });

        
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
            now - lastTap.time < 450;

          lastTap = { id: chord.id, time: now };

          if (isSecondTap) {
            showExistingChordInput(row, element, chord);
          } else {
            selectChord(chord.id);
          }
        });

        element.addEventListener('dblclick', event => {
          event.preventDefault();
          event.stopPropagation();
          showExistingChordInput(row, element, chord);
          lastTap = { id: null, time: 0 };
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
    closeInlineInput();
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
    return value.includes(' ') || /[ぁ-んァ-ン一-龯]/.test(value)
      ? `"${value}"`
      : value;
  }

  function renderFontSettings() {
    const lyricSize = clampFontSize(song.lyricFontSize, DEFAULT_LYRIC_FONT_SIZE);
    const chordSize = clampFontSize(song.chordFontSize, DEFAULT_CHORD_FONT_SIZE);

    song.lyricFontSize = lyricSize;
    song.chordFontSize = chordSize;

    els.lyricFontSize.value = lyricSize;
    els.chordFontSize.value = chordSize;
    els.lyricFontSizeValue.textContent = lyricSize;
    els.chordFontSizeValue.textContent = chordSize;
    els.lyricFontFamily.value = song.lyricFontFamily;
    els.chordFontFamily.value = song.chordFontFamily;

    document.documentElement.style.setProperty('--lyric-font-size', `${lyricSize}px`);
    document.documentElement.style.setProperty('--chord-font-size', `${chordSize}px`);
    document.documentElement.style.setProperty('--lyric-font-family', fontCss(song.lyricFontFamily));
    document.documentElement.style.setProperty('--chord-font-family', fontCss(song.chordFontFamily));
  }

  function renderAll() {
    if (!song) return;

    normalizeSong(song);
    els.title.value = song.title;
    els.artist.value = song.artist;
    els.key.value = song.key;
    els.capo.value = song.capo;

    if (els.lyrics.value !== song.lyrics) els.lyrics.value = song.lyrics;

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

  function switchMode(next) {
    closeInlineInput();
    mode = next;
    updateMode();

    if (mode === 'chords') requestAnimationFrame(renderEditor);
    if (mode === 'preview') requestAnimationFrame(renderPreview);
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
    input.select();

    let closed = false;
    let cancelled = false;

    const finish = () => {
      if (closed || cancelled) return;
      closed = true;

      const name = input.value.trim();
      if (name && input.isConnected) {
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
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelled = true;
        closed = true;
        closeInlineInput();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!cancelled && input.isConnected) finish();
      }, 80);
    });
  }

  function showExistingChordInput(row, chordElement, chord) {
    const scrollState = getScrollState();
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
    const x = chordRect.left + chordRect.width / 2 - rowRect.left;

    input.style.left = `${x}px`;
    row.appendChild(input);
    input.focus();
    input.select();

    let closed = false;
    let cancelled = false;

    const cancel = () => {
      if (closed) return;
      closed = true;
      cancelled = true;
      closeInlineInput();
      restoreScrollState(scrollState);
    };

    const finish = () => {
      if (closed || cancelled) return;
      closed = true;

      const name = input.value.trim();

      if (name && name !== chord.name) {
        chord.name = name;
        commit('コード名変更');
      }

      closeInlineInput();
      selectedChordId = chord.id;
      renderAllPreservingScroll();
      restoreScrollState(scrollState);
    };

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!cancelled && input.isConnected) finish();
      }, 80);
    });
  }

  function closeInlineInput() {
    if (inlineInput) {
      inlineInput.remove();
      inlineInput = null;
    }
  }

  function selectChord(id) {
    const state = getScrollState();
    closeInlineInput();
    selectedChordId = id;
    updateMobileControls();
    renderEditor();
    restoreScrollState(state);
  }

  function clearSelectedChord() {
    selectedChordId = null;
    updateMobileControls();
    document.querySelectorAll('.chord.selected').forEach(element => {
      element.classList.remove('selected');
    });
  }

  function updateMobileControls() {
    const chord = getSelectedChord();
    els.mobileControls.classList.toggle(
      'hidden',
      mode !== 'chords' || !chord
    );
    if (chord) els.selectedChordName.value = chord.name;
  }

  function deleteSelected() {
    const chord = getSelectedChord();
    if (!chord) return;

    closeInlineInput();
    song.chords = song.chords.filter(item => item.id !== chord.id);
    selectedChordId = null;
    commit('コード削除');
    renderAllPreservingScroll();
  }

  function nudge(amount) {
    const chord = getSelectedChord();
    if (!chord) return;

    chord.offset = Number(chord.offset || 0) + amount;
    const id = chord.id;
    commit('コード微調整');
    renderAllPreservingScroll();
    selectedChordId = id;
    updateMobileControls();
  }

  function startDrag(event) {
    if (mode !== 'chords') return;

    event.preventDefault();
    event.stopPropagation();

    const element = event.currentTarget;
    const chord = getChordById(element.dataset.chordId);
    if (!chord) return;

    const rect = element.getBoundingClientRect();
    selectedChordId = chord.id;
    updateMobileControls();

    dragState = {
      id: chord.id,
      pointerId: event.pointerId,
      chordElement: element,
      grabDelta: event.clientX - (rect.left + rect.width / 2),
      originalOffset: Number(chord.offset || 0),
      moved: false
    };

    element.setPointerCapture?.(event.pointerId);
    document.addEventListener('pointermove', moveDrag, { passive: false });
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    event.preventDefault();

    const chord = getChordById(dragState.id);
    const row = dragState.chordElement.closest('.score-line');
    if (!chord || !row) return;

    const rect = row.getBoundingClientRect();
    const base = getCharX(row, chord.charIndex);
    const center = event.clientX - rect.left - dragState.grabDelta;

    chord.offset = center - base;

    if (Math.abs(chord.offset - dragState.originalOffset) > 2) {
      dragState.moved = true;
    }

    dragState.chordElement.style.left = `${base + chord.offset}px`;
  }

  function endDrag(event) {
    if (
      !dragState ||
      (event && event.pointerId !== dragState.pointerId)
    ) return;

    const finished = dragState;

    document.removeEventListener('pointermove', moveDrag);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);

    dragState = null;
    suppressChordActivation = finished.moved;

    if (finished.moved) commit('コード移動');

    selectedChordId = finished.id;
    renderAllPreservingScroll();
  }

  function updateMeta() {
    song.title = els.title.value;
    song.artist = els.artist.value;
    song.key = els.key.value;
    song.capo = Math.max(0, Number(els.capo.value) || 0);
    commit('曲情報を編集');
    renderHome();
  }

  function updateFontSize(type, value) {
    const fallback = type === 'lyricFontSize'
      ? DEFAULT_LYRIC_FONT_SIZE
      : DEFAULT_CHORD_FONT_SIZE;

    const size = clampFontSize(value, fallback);
    if (song[type] === size) return;

    song[type] = size;
    commit(type === 'lyricFontSize' ? '歌詞サイズ変更' : 'コードサイズ変更');
    renderAll();
  }

  function updateFontFamily(type, value) {
    const fallback = type === 'lyricFontFamily'
      ? DEFAULT_LYRIC_FONT_FAMILY
      : DEFAULT_CHORD_FONT_FAMILY;

    const family = normalizeFontFamily(value, fallback);
    if (song[type] === family) return;

    song[type] = family;
    commit(type === 'lyricFontFamily' ? '歌詞フォント変更' : 'コードフォント変更');
    renderAll();
  }

  function resetFontSizes() {
    if (
      song.lyricFontSize === DEFAULT_LYRIC_FONT_SIZE &&
      song.chordFontSize === DEFAULT_CHORD_FONT_SIZE
    ) return;

    song.lyricFontSize = DEFAULT_LYRIC_FONT_SIZE;
    song.chordFontSize = DEFAULT_CHORD_FONT_SIZE;
    commit('文字サイズを標準に戻す');
    renderAll();
  }

  function openEditor(id) {
    const target = store.songs.find(item => item.id === id);
    if (!target) return;

    closeInlineInput();
    song = target;
    normalizeSong(song);
    store.currentSongId = song.id;
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

    const idMap = new Map();
    copied.lines.forEach(line => {
      const oldId = line.id;
      line.id = uid('line');
      idMap.set(oldId, line.id);
    });

    copied.chords.forEach(chord => {
      chord.id = uid('chord');
      chord.lineId = idMap.get(chord.lineId) || chord.lineId;
    });

    store.songs.push(copied);
    persistStore();
    renderHome();
  }

  function deleteSong(id) {
    const target = store.songs.find(item => item.id === id);

    if (
      !target ||
      !window.confirm(`「${target.title || '無題'}」を削除しますか？`)
    ) return;

    store.songs = store.songs.filter(item => item.id !== id);

    if (store.currentSongId === id) store.currentSongId = null;
    if (song?.id === id) song = null;

    persistStore();
    renderHome();
  }

  function renderHome() {
    els.songList.replaceChildren();
    els.songCount.textContent = `${store.songs.length}曲`;
    els.emptyMessage.classList.toggle('hidden', store.songs.length !== 0);

    [...store.songs]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
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

        updated.textContent = `更新: ${new Date(
          item.updatedAt || Date.now()
        ).toLocaleString('ja-JP')}`;

        actions.className = 'song-card-actions';
        open.textContent = '開く';
        duplicate.textContent = '複製';
        remove.className = 'delete-song';
        remove.textContent = '削除';

        open.onclick = () => openEditor(item.id);
        duplicate.onclick = () => duplicateSong(item.id);
        remove.onclick = () => deleteSong(item.id);

        actions.append(open, duplicate, remove);
        card.append(title, artist, meta, updated, actions);
        els.songList.appendChild(card);
      });
  }

  els.newSong.onclick = () => {
    const fresh = createSong();
    store.songs.push(fresh);
    persistStore();
    openEditor(fresh.id);
  };

  els.homeBtn.onclick = showHome;

  els.lyrics.oninput = () => {
    clearTimeout(lyricsTimer);
    lyricsTimer = setTimeout(() => syncLyrics(els.lyrics.value), 250);
  };

  [els.title, els.artist, els.key, els.capo]
    .forEach(input => input.addEventListener('change', updateMeta));

  els.lyricFontSize.oninput = event => {
    updateFontSize('lyricFontSize', event.target.value);
  };

  els.chordFontSize.oninput = event => {
    updateFontSize('chordFontSize', event.target.value);
  };

  els.lyricFontFamily.onchange = event => {
    updateFontFamily('lyricFontFamily', event.target.value);
  };

  els.chordFontFamily.onchange = event => {
    updateFontFamily('chordFontFamily', event.target.value);
  };

  els.resetFontSize.onclick = resetFontSizes;
  els.modes.lyrics.onclick = () => switchMode('lyrics');
  els.modes.chords.onclick = () => switchMode('chords');
  els.modes.preview.onclick = () => switchMode('preview');
  els.undo.onclick = undo;
  els.redo.onclick = redo;

  els.print.onclick = () => {
    closeInlineInput();
    renderPreview();
    requestAnimationFrame(() => window.print());
  };

  window.onbeforeprint = () => {
    closeInlineInput();
    renderPreview();
    els.preview.classList.remove('hidden');
  };

  document.addEventListener('pointerdown', event => {
    const clickedChord = event.target.closest('.chord');
    const clickedControls = event.target.closest('.mobile-controls');
    const clickedInput = event.target.closest('.inline-chord-input');

    if (inlineInput && !clickedInput) {
      const active = inlineInput;
      setTimeout(() => {
        if (active.isConnected) active.blur();
      }, 0);
    }

    if (
      selectedChordId &&
      !clickedChord &&
      !clickedControls &&
      !clickedInput
    ) {
      clearSelectedChord();
    }
  }, true);

  els.mobileControls?.addEventListener('pointerdown', event => {
    event.stopPropagation();
  });

  $('#deleteChordBtn')?.addEventListener('pointerup', event => {
    event.preventDefault();
    event.stopPropagation();
    deleteSelected();
  });

  $('#nudgeLeftBtn')?.addEventListener('pointerup', event => {
    event.preventDefault();
    event.stopPropagation();
    nudge(-1);
  });

  $('#nudgeRightBtn')?.addEventListener('pointerup', event => {
    event.preventDefault();
    event.stopPropagation();
    nudge(1);
  });

  els.selectedChordName?.addEventListener('change', () => {
    const chord = getSelectedChord();
    const name = els.selectedChordName.value.trim();

    if (!chord || !name || name === chord.name) return;

    chord.name = name;
    commit('コード名変更');
    renderAllPreservingScroll();
    selectedChordId = chord.id;
    updateMobileControls();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && inlineInput) {
      event.preventDefault();
      inlineInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return;
    }

    if (
      mode !== 'chords' ||
      !getSelectedChord() ||
      event.target.matches('input, textarea')
    ) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      nudge(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      nudge(1);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === 'Escape') {
      clearSelectedChord();
      renderEditor();
    }
  });

  if (store.songs.length) {
    song = store.songs.find(item => item.id === store.currentSongId) ||
      store.songs[0];
    normalizeSong(song);
    resetHistory();
  }

  renderHome();
})();(() => {
  'use strict';

  const STORAGE_KEY = 'guitar-score-app-v1';
  const MAX_HISTORY = 100;
  const DEFAULT_LYRIC_FONT_SIZE = 16;
  const DEFAULT_CHORD_FONT_SIZE = 16;
  const DEFAULT_LYRIC_FONT_FAMILY = 'sans-serif';
  const DEFAULT_CHORD_FONT_FAMILY = 'monospace';
  const MIN_FONT_SIZE = 12;
  const MAX_FONT_SIZE = 32;

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
    status: $('#status'),
    undo: $('#undoBtn'),
    redo: $('#redoBtn'),
    print: $('#printBtn'),
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
  let lyricsTimer = null;

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clampFontSize(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, number))
      : fallback;
  }

  function normalizeFontFamily(value, fallback) {
    return typeof value === 'string' && value.trim() ? value : fallback;
  }

  function normalizeFontSizes(target) {
    target.lyricFontSize = clampFontSize(
      target.lyricFontSize,
      DEFAULT_LYRIC_FONT_SIZE
    );
    target.chordFontSize = clampFontSize(
      target.chordFontSize,
      DEFAULT_CHORD_FONT_SIZE
    );
    return target;
  }

  function normalizeSong(target) {
    if (!target || typeof target !== 'object') return null;

    target.id = target.id || uid('song');
    target.title = String(target.title || '');
    target.artist = String(target.artist || '');
    target.lyrics = String(target.lyrics || '');
    target.key = String(target.key || '');
    target.capo = Math.max(0, Number(target.capo) || 0);
    target.updatedAt = Number(target.updatedAt) || Date.now();
    target.chords = Array.isArray(target.chords) ? target.chords : [];
    target.sections = Array.isArray(target.sections) ? target.sections : [];
    target.lines = Array.isArray(target.lines) && target.lines.length
      ? target.lines
      : [{ id: uid('line'), text: '' }];

    target.lines.forEach(line => {
      line.id = line.id || uid('line');
      line.text = String(line.text || '');
    });

    target.chords.forEach(chord => {
      chord.id = chord.id || uid('chord');
      chord.lineId = chord.lineId || target.lines[0].id;
      chord.charIndex = Math.max(0, Number(chord.charIndex) || 0);
      chord.offset = Number(chord.offset) || 0;
      chord.name = String(chord.name || '');
    });

    target.lyricFontFamily = normalizeFontFamily(
      target.lyricFontFamily,
      DEFAULT_LYRIC_FONT_FAMILY
    );
    target.chordFontFamily = normalizeFontFamily(
      target.chordFontFamily,
      DEFAULT_CHORD_FONT_FAMILY
    );

    normalizeFontSizes(target);
    return target;
  }

  function createSong() {
    return {
      id: uid('song'),
      title: '',
      artist: '',
      lyrics: '',
      lines: [{ id: uid('line'), text: '' }],
      chords: [],
      sections: [],
      key: '',
      capo: 0,
      lyricFontSize: DEFAULT_LYRIC_FONT_SIZE,
      chordFontSize: DEFAULT_CHORD_FONT_SIZE,
      lyricFontFamily: DEFAULT_LYRIC_FONT_FAMILY,
      chordFontFamily: DEFAULT_CHORD_FONT_FAMILY,
      updatedAt: Date.now()
    };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 2, songs: [], currentSongId: null };

      const saved = JSON.parse(raw);

      if (saved && Array.isArray(saved.songs)) {
        saved.songs = saved.songs.map(normalizeSong).filter(Boolean);
        saved.version = 2;
        saved.currentSongId = saved.currentSongId || null;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        return saved;
      }

      if (saved && typeof saved === 'object') {
        const migratedSong = normalizeSong(saved);
        const migrated = {
          version: 2,
          songs: migratedSong ? [migratedSong] : [],
          currentSongId: migratedSong ? migratedSong.id : null
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (error) {
      console.warn('保存データの読み込みに失敗しました', error);
    }

    return { version: 2, songs: [], currentSongId: null };
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
      touchSong();
      persistStore();
      if (els.status) {
        els.status.textContent = '自動保存しました';
        setTimeout(() => {
          if (els.status) els.status.textContent = '';
        }, 1500);
      }
    }, 100);
  }

  function commit(label = '変更') {
    if (!song) return;

    touchSong();
    history = history.slice(0, historyIndex + 1);
    history.push({ song: clone(song), label });

    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
    saveSong();
  }

  function resetHistory() {
    history = [{ song: clone(song), label: '初期状態' }];
    historyIndex = 0;
  }

  function replaceCurrentSong() {
    if (!song) return;
    const index = store.songs.findIndex(item => item.id === song.id);
    if (index >= 0) store.songs[index] = song;
    saveSong();
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
      window.scrollTo({ left: state.pageX, top: state.pageY, behavior: 'auto' });
      if (els.score) {
        els.score.scrollLeft = state.scoreLeft;
        els.score.scrollTop = state.scoreTop;
      }
    };

    restore();
    requestAnimationFrame(() => {
      restore();
      setTimeout(restore, 80);
    });
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
    replaceCurrentSong();
    selectedChordId = null;
    renderAll();
    restoreScrollState(state);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;

    const state = getScrollState();
    closeInlineInput();
    song = clone(history[++historyIndex].song);
    replaceCurrentSong();
    selectedChordId = null;
    renderAll();
    restoreScrollState(state);
  }

  function normalizeLines(text) {
    const previous = song.lines || [];
    return String(text).split('\n').map((lineText, index) => ({
      id: previous[index]?.id || uid('line'),
      text: lineText
    }));
  }

  function syncLyrics(text, shouldCommit = true) {
    const before = JSON.stringify(song);

    song.lyrics = String(text);
    song.lines = normalizeLines(song.lyrics);

    const validIds = new Set(song.lines.map(line => line.id));
    song.chords = song.chords.filter(chord => validIds.has(chord.lineId));

    if (shouldCommit && before !== JSON.stringify(song)) {
      commit('歌詞を編集');
    }

    renderAll();
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
      return chars[chars.length - 1].getBoundingClientRect().right - rowRect.left;
    }

    return chars[index].getBoundingClientRect().left - rowRect.left;
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
        if (
          dragState ||
          event.target.closest('.chord, .inline-chord-input')
        ) return;

        const rect = row.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const chars = [...row.querySelectorAll('.lyric-char')];

        let index = chars.findIndex(char => (
          x < char.getBoundingClientRect().left -
            rect.left +
            char.getBoundingClientRect().width / 2
        ));

        if (index < 0) index = chars.length;

        clearSelectedChord();
        showInlineInput(row, line.id, index, x);
      });
    }

    return row;
  }

  function renderChordsOnRow(row, lineId) {
    song.chords
      .filter(chord => chord.lineId === lineId)
      .forEach(chord => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = `chord${chord.id === selectedChordId ? ' selected' : ''}`;
        element.textContent = chord.name;
        element.dataset.chordId = chord.id;

        const base = getCharX(row, chord.charIndex);
        element.style.left = `${base + (Number(chord.offset) || 0)}px`;

        element.addEventListener('pointerdown', event => {
          startDrag(event);
        }, { passive: false });

        element.addEventListener('pointerup', event => {
          if (dragState?.pointerId === event.pointerId) {
            endDrag(event);
          }
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
            now - lastTap.time < 450;

          lastTap = { id: chord.id, time: now };

          if (isSecondTap) {
            showExistingChordInput(row, element, chord);
          } else {
            selectChord(chord.id);
          }
        });

        element.addEventListener('dblclick', event => {
          event.preventDefault();
          event.stopPropagation();
          showExistingChordInput(row, element, chord);
          lastTap = { id: null, time: 0 };
        });

        row.appendChild(element);
      });
  }

  function renderEditor() {
    els.score.replaceChildren();

    song.lines.forEach(line => {
      const row = renderLine(line, true);
      els.score.appendChild(row);
      renderChordsOnRow(row, line.id);
    });
  }

  function renderPreview() {
    closeInlineInput();
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
      renderChordsOnRow(row, line.id);
    });
  }

  function fontCss(value) {
    return value.includes(' ') || /[ぁ-んァ-ン一-龯]/.test(value)
      ? `"${value}"`
      : value;
  }

  function renderFontSettings() {
    const lyricSize = clampFontSize(song.lyricFontSize, DEFAULT_LYRIC_FONT_SIZE);
    const chordSize = clampFontSize(song.chordFontSize, DEFAULT_CHORD_FONT_SIZE);

    song.lyricFontSize = lyricSize;
    song.chordFontSize = chordSize;

    els.lyricFontSize.value = lyricSize;
    els.chordFontSize.value = chordSize;
    els.lyricFontSizeValue.textContent = lyricSize;
    els.chordFontSizeValue.textContent = chordSize;
    els.lyricFontFamily.value = song.lyricFontFamily;
    els.chordFontFamily.value = song.chordFontFamily;

    document.documentElement.style.setProperty('--lyric-font-size', `${lyricSize}px`);
    document.documentElement.style.setProperty('--chord-font-size', `${chordSize}px`);
    document.documentElement.style.setProperty('--lyric-font-family', fontCss(song.lyricFontFamily));
    document.documentElement.style.setProperty('--chord-font-family', fontCss(song.chordFontFamily));
  }

  function renderAll() {
    if (!song) return;

    normalizeSong(song);
    els.title.value = song.title;
    els.artist.value = song.artist;
    els.key.value = song.key;
    els.capo.value = song.capo;

    if (els.lyrics.value !== song.lyrics) els.lyrics.value = song.lyrics;

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

  function switchMode(next) {
    closeInlineInput();
    mode = next;
    updateMode();

    if (mode === 'chords') requestAnimationFrame(renderEditor);
    if (mode === 'preview') requestAnimationFrame(renderPreview);
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
    input.select();

    let closed = false;
    let cancelled = false;

    const finish = () => {
      if (closed || cancelled) return;
      closed = true;

      const name = input.value.trim();
      if (name && input.isConnected) {
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
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelled = true;
        closed = true;
        closeInlineInput();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!cancelled && input.isConnected) finish();
      }, 80);
    });
  }

  function showExistingChordInput(row, chordElement, chord) {
    const scrollState = getScrollState();
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
    const x = chordRect.left + chordRect.width / 2 - rowRect.left;

    input.style.left = `${x}px`;
    row.appendChild(input);
    input.focus();
    input.select();

    let closed = false;
    let cancelled = false;

    const cancel = () => {
      if (closed) return;
      closed = true;
      cancelled = true;
      closeInlineInput();
      restoreScrollState(scrollState);
    };

    const finish = () => {
      if (closed || cancelled) return;
      closed = true;

      const name = input.value.trim();

      if (name && name !== chord.name) {
        chord.name = name;
        commit('コード名変更');
      }

      closeInlineInput();
      selectedChordId = chord.id;
      renderAllPreservingScroll();
      restoreScrollState(scrollState);
    };

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!cancelled && input.isConnected) finish();
      }, 80);
    });
  }

  function closeInlineInput() {
    if (inlineInput) {
      inlineInput.remove();
      inlineInput = null;
    }
  }

  function selectChord(id) {
    const state = getScrollState();
    closeInlineInput();
    selectedChordId = id;
    updateMobileControls();
    renderEditor();
    restoreScrollState(state);
  }

  function clearSelectedChord() {
    selectedChordId = null;
    updateMobileControls();
    document.querySelectorAll('.chord.selected').forEach(element => {
      element.classList.remove('selected');
    });
  }

  function updateMobileControls() {
    const chord = getSelectedChord();
    els.mobileControls.classList.toggle(
      'hidden',
      mode !== 'chords' || !chord
    );
    if (chord) els.selectedChordName.value = chord.name;
  }

  function deleteSelected() {
    const chord = getSelectedChord();
    if (!chord) return;

    closeInlineInput();
    song.chords = song.chords.filter(item => item.id !== chord.id);
    selectedChordId = null;
    commit('コード削除');
    renderAllPreservingScroll();
  }

  function nudge(amount) {
    const chord = getSelectedChord();
    if (!chord) return;

    chord.offset = Number(chord.offset || 0) + amount;
    const id = chord.id;
    commit('コード微調整');
    renderAllPreservingScroll();
    selectedChordId = id;
    updateMobileControls();
  }

  function startDrag(event) {
    if (mode !== 'chords') return;

    event.preventDefault();
    event.stopPropagation();

    const element = event.currentTarget;
    const chord = getChordById(element.dataset.chordId);
    if (!chord) return;

    const rect = element.getBoundingClientRect();
    selectedChordId = chord.id;
    updateMobileControls();

    dragState = {
      id: chord.id,
      pointerId: event.pointerId,
      chordElement: element,
      grabDelta: event.clientX - (rect.left + rect.width / 2),
      originalOffset: Number(chord.offset || 0),
      moved: false
    };

    element.setPointerCapture?.(event.pointerId);
    document.addEventListener('pointermove', moveDrag, { passive: false });
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    event.preventDefault();

    const chord = getChordById(dragState.id);
    const row = dragState.chordElement.closest('.score-line');
    if (!chord || !row) return;

    const rect = row.getBoundingClientRect();
    const base = getCharX(row, chord.charIndex);
    const center = event.clientX - rect.left - dragState.grabDelta;

    chord.offset = center - base;

    if (Math.abs(chord.offset - dragState.originalOffset) > 2) {
      dragState.moved = true;
    }

    dragState.chordElement.style.left = `${base + chord.offset}px`;
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
  suppressChordActivation = finished.moved;

  selectedChordId = finished.id;

  if (finished.moved) {
    commit('コード移動');
    renderAllPreservingScroll();
  } else {
    updateMobileControls();
  }
}

  function updateMeta() {
    song.title = els.title.value;
    song.artist = els.artist.value;
    song.key = els.key.value;
    song.capo = Math.max(0, Number(els.capo.value) || 0);
    commit('曲情報を編集');
    renderHome();
  }

  function updateFontSize(type, value) {
    const fallback = type === 'lyricFontSize'
      ? DEFAULT_LYRIC_FONT_SIZE
      : DEFAULT_CHORD_FONT_SIZE;

    const size = clampFontSize(value, fallback);
    if (song[type] === size) return;

    song[type] = size;
    commit(type === 'lyricFontSize' ? '歌詞サイズ変更' : 'コードサイズ変更');
    renderAll();
  }

  function updateFontFamily(type, value) {
    const fallback = type === 'lyricFontFamily'
      ? DEFAULT_LYRIC_FONT_FAMILY
      : DEFAULT_CHORD_FONT_FAMILY;

    const family = normalizeFontFamily(value, fallback);
    if (song[type] === family) return;

    song[type] = family;
    commit(type === 'lyricFontFamily' ? '歌詞フォント変更' : 'コードフォント変更');
    renderAll();
  }

  function resetFontSizes() {
    if (
      song.lyricFontSize === DEFAULT_LYRIC_FONT_SIZE &&
      song.chordFontSize === DEFAULT_CHORD_FONT_SIZE
    ) return;

    song.lyricFontSize = DEFAULT_LYRIC_FONT_SIZE;
    song.chordFontSize = DEFAULT_CHORD_FONT_SIZE;
    commit('文字サイズを標準に戻す');
    renderAll();
  }

  function openEditor(id) {
    const target = store.songs.find(item => item.id === id);
    if (!target) return;

    closeInlineInput();
    song = target;
    normalizeSong(song);
    store.currentSongId = song.id;
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

    const idMap = new Map();
    copied.lines.forEach(line => {
      const oldId = line.id;
      line.id = uid('line');
      idMap.set(oldId, line.id);
    });

    copied.chords.forEach(chord => {
      chord.id = uid('chord');
      chord.lineId = idMap.get(chord.lineId) || chord.lineId;
    });

    store.songs.push(copied);
    persistStore();
    renderHome();
  }

  function deleteSong(id) {
    const target = store.songs.find(item => item.id === id);

    if (
      !target ||
      !window.confirm(`「${target.title || '無題'}」を削除しますか？`)
    ) return;

    store.songs = store.songs.filter(item => item.id !== id);

    if (store.currentSongId === id) store.currentSongId = null;
    if (song?.id === id) song = null;

    persistStore();
    renderHome();
  }

  function renderHome() {
    els.songList.replaceChildren();
    els.songCount.textContent = `${store.songs.length}曲`;
    els.emptyMessage.classList.toggle('hidden', store.songs.length !== 0);

    [...store.songs]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
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

        updated.textContent = `更新: ${new Date(
          item.updatedAt || Date.now()
        ).toLocaleString('ja-JP')}`;

        actions.className = 'song-card-actions';
        open.textContent = '開く';
        duplicate.textContent = '複製';
        remove.className = 'delete-song';
        remove.textContent = '削除';

        open.onclick = () => openEditor(item.id);
        duplicate.onclick = () => duplicateSong(item.id);
        remove.onclick = () => deleteSong(item.id);

        actions.append(open, duplicate, remove);
        card.append(title, artist, meta, updated, actions);
        els.songList.appendChild(card);
      });
  }

  els.newSong.onclick = () => {
    const fresh = createSong();
    store.songs.push(fresh);
    persistStore();
    openEditor(fresh.id);
  };

  els.homeBtn.onclick = showHome;

  els.lyrics.oninput = () => {
    clearTimeout(lyricsTimer);
    lyricsTimer = setTimeout(() => syncLyrics(els.lyrics.value), 250);
  };

  [els.title, els.artist, els.key, els.capo]
    .forEach(input => input.addEventListener('change', updateMeta));

  els.lyricFontSize.oninput = event => {
    updateFontSize('lyricFontSize', event.target.value);
  };

  els.chordFontSize.oninput = event => {
    updateFontSize('chordFontSize', event.target.value);
  };

  els.lyricFontFamily.onchange = event => {
    updateFontFamily('lyricFontFamily', event.target.value);
  };

  els.chordFontFamily.onchange = event => {
    updateFontFamily('chordFontFamily', event.target.value);
  };

  els.resetFontSize.onclick = resetFontSizes;
  els.modes.lyrics.onclick = () => switchMode('lyrics');
  els.modes.chords.onclick = () => switchMode('chords');
  els.modes.preview.onclick = () => switchMode('preview');
  els.undo.onclick = undo;
  els.redo.onclick = redo;

  els.print.onclick = () => {
    closeInlineInput();
    renderPreview();
    requestAnimationFrame(() => window.print());
  };

  window.onbeforeprint = () => {
    closeInlineInput();
    renderPreview();
    els.preview.classList.remove('hidden');
  };

  document.addEventListener('pointerdown', event => {
    const clickedChord = event.target.closest('.chord');
    const clickedControls = event.target.closest('.mobile-controls');
    const clickedInput = event.target.closest('.inline-chord-input');

    if (inlineInput && !clickedInput) {
      const active = inlineInput;
      setTimeout(() => {
        if (active.isConnected) active.blur();
      }, 0);
    }

    if (
      selectedChordId &&
      !clickedChord &&
      !clickedControls &&
      !clickedInput
    ) {
      clearSelectedChord();
    }
  }, true);

  els.mobileControls?.addEventListener('pointerdown', event => {
    event.stopPropagation();
  });

  $('#deleteChordBtn')?.addEventListener('pointerup', event => {
    event.preventDefault();
    event.stopPropagation();
    deleteSelected();
  });

  $('#nudgeLeftBtn')?.addEventListener('pointerup', event => {
    event.preventDefault();
    event.stopPropagation();
    nudge(-1);
  });

  $('#nudgeRightBtn')?.addEventListener('pointerup', event => {
    event.preventDefault();
    event.stopPropagation();
    nudge(1);
  });

  els.selectedChordName?.addEventListener('change', () => {
    const chord = getSelectedChord();
    const name = els.selectedChordName.value.trim();

    if (!chord || !name || name === chord.name) return;

    chord.name = name;
    commit('コード名変更');
    renderAllPreservingScroll();
    selectedChordId = chord.id;
    updateMobileControls();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && inlineInput) {
      event.preventDefault();
      inlineInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return;
    }

    if (
      mode !== 'chords' ||
      !getSelectedChord() ||
      event.target.matches('input, textarea')
    ) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      nudge(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      nudge(1);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === 'Escape') {
      clearSelectedChord();
      renderEditor();
    }
  });

  if (store.songs.length) {
    song = store.songs.find(item => item.id === store.currentSongId) ||
      store.songs[0];
    normalizeSong(song);
    resetHistory();
  }

  renderHome();
})();
