(() => {
  'use strict';

  const STORAGE_KEY = 'guitar-score-app-v1';
  const MAX_HISTORY = 100;
  const DEFAULT_LYRIC_FONT_SIZE = 16;
  const DEFAULT_CHORD_FONT_SIZE = 16;
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
  let history = [];
  let historyIndex = -1;
  let saveTimer = null;
  let lyricsTimer = null;

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clampFontSize(value, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    return Math.min(
      MAX_FONT_SIZE,
      Math.max(MIN_FONT_SIZE, numericValue)
    );
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
    if (!target || typeof target !== 'object') {
      return null;
    }

    target.id = target.id || uid('song');
    target.title = String(target.title || '');
    target.artist = String(target.artist || '');
    target.lyrics = String(target.lyrics || '');
    target.key = String(target.key || '');
    target.capo = Math.max(0, Number(target.capo) || 0);
    target.updatedAt = Number(target.updatedAt) || Date.now();

    target.chords = Array.isArray(target.chords)
      ? target.chords
      : [];

    target.sections = Array.isArray(target.sections)
      ? target.sections
      : [];

    target.lines = Array.isArray(target.lines) &&
      target.lines.length
      ? target.lines
      : [
          {
            id: uid('line'),
            text: ''
          }
        ];

    normalizeFontSizes(target);

    return target;
  }

  function createSong() {
    return {
      id: uid('song'),
      title: '',
      artist: '',
      lyrics: '',
      lines: [
        {
          id: uid('line'),
          text: ''
        }
      ],
      chords: [],
      sections: [],
      key: '',
      capo: 0,
      lyricFontSize: DEFAULT_LYRIC_FONT_SIZE,
      chordFontSize: DEFAULT_CHORD_FONT_SIZE,
      updatedAt: Date.now()
    };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return {
          version: 2,
          songs: [],
          currentSongId: null
        };
      }

      const saved = JSON.parse(raw);

      if (saved && Array.isArray(saved.songs)) {
        saved.songs = saved.songs
          .map(normalizeSong)
          .filter(Boolean);

        saved.version = 2;
        saved.currentSongId =
          saved.currentSongId || null;

        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(saved)
        );

        return saved;
      }

      if (saved && typeof saved === 'object') {
        const migratedSong = normalizeSong(saved);

        const migrated = {
          version: 2,
          songs: migratedSong ? [migratedSong] : [],
          currentSongId: migratedSong
            ? migratedSong.id
            : null
        };

        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(migrated)
        );

        return migrated;
      }
    } catch (error) {
      console.warn(
        '保存データの読み込みに失敗しました',
        error
      );
    }

    return {
      version: 2,
      songs: [],
      currentSongId: null
    };
  }

  function persistStore() {
    store.currentSongId =
      song?.id || store.currentSongId || null;

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(store)
    );
  }

  function touchSong() {
    if (song) {
      song.updatedAt = Date.now();
    }
  }

  function saveSong() {
    clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
      touchSong();
      persistStore();

      if (els.status) {
        els.status.textContent = '自動保存しました';

        setTimeout(() => {
          els.status.textContent = '';
        }, 1500);
      }
    }, 100);
  }

  function commit(label = '変更') {
    if (!song) return;

    touchSong();

    history = history.slice(
      0,
      historyIndex + 1
    );

    history.push({
      song: clone(song),
      label
    });

    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    historyIndex = history.length - 1;
    saveSong();
  }

  function resetHistory() {
    history = [
      {
        song: clone(song),
        label: '初期状態'
      }
    ];

    historyIndex = 0;
  }

  function replaceCurrentSong() {
    if (!song) return;

    const index = store.songs.findIndex(
      item => item.id === song.id
    );

    if (index >= 0) {
      store.songs[index] = song;
    }

    saveSong();
  }

  function undo() {
    if (historyIndex <= 0) return;

    historyIndex--;
    song = clone(
      history[historyIndex].song
    );

    replaceCurrentSong();
    selectedChordId = null;
    renderAll();
  }

  function redo() {
    if (historyIndex >= history.length - 1) {
      return;
    }

    historyIndex++;
    song = clone(
      history[historyIndex].song
    );

    replaceCurrentSong();
    selectedChordId = null;
    renderAll();
  }

  function normalizeLines(text) {
    const previousLines = song.lines || [];

    return String(text)
      .split('\n')
      .map((lineText, index) => ({
        id:
          previousLines[index]?.id ||
          uid('line'),
        text: lineText
      }));
  }

  function syncLyrics(text, shouldCommit = true) {
    const before = JSON.stringify(song);

    song.lyrics = String(text);
    song.lines = normalizeLines(song.lyrics);

    const validLineIds = new Set(
      song.lines.map(line => line.id)
    );

    song.chords = song.chords.filter(
      chord => validLineIds.has(chord.lineId)
    );

    if (
      shouldCommit &&
      before !== JSON.stringify(song)
    ) {
      commit('歌詞を編集');
    }

    renderAll();
  }

  function renderLyricWithChars(text) {
    const fragment =
      document.createDocumentFragment();

    [...text].forEach((char, index) => {
      const span =
        document.createElement('span');

      span.className = 'lyric-char';
      span.dataset.index = index;
      span.textContent =
        char === ' ' ? '\u00a0' : char;

      fragment.appendChild(span);
    });

    return fragment;
  }

  function getCharX(row, index) {
    const chars =
      row.querySelectorAll('.lyric-char');

    if (!chars.length) {
      return 0;
    }

    const rowRect =
      row.getBoundingClientRect();

    if (index >= chars.length) {
      const rect =
        chars[chars.length - 1]
          .getBoundingClientRect();

      return rect.right - rowRect.left;
    }

    return chars[index]
      .getBoundingClientRect()
      .left - rowRect.left;
  }

  function getChordById(id) {
    return song?.chords.find(
      chord => chord.id === id
    );
  }

  function getSelectedChord() {
    return getChordById(selectedChordId);
  }

  function renderLine(line, editable) {
    const row =
      document.createElement('div');

    row.className = editable
      ? 'score-line'
      : 'preview-line';

    row.dataset.lineId = line.id;

    const lyricText =
      document.createElement('span');

    lyricText.className = 'lyric-text';
    lyricText.appendChild(
      renderLyricWithChars(line.text)
    );

    row.appendChild(lyricText);

    if (editable) {
      row.addEventListener(
        'pointerup',
        event => {
          if (
            dragState ||
            event.target.closest('.chord')
          ) {
            return;
          }

          const rowRect =
            row.getBoundingClientRect();

          const x =
            event.clientX - rowRect.left;

          const chars = [
            ...row.querySelectorAll(
              '.lyric-char'
            )
          ];

          let charIndex = chars.findIndex(
            char => {
              const rect =
                char.getBoundingClientRect();

              const center =
                rect.left -
                rowRect.left +
                rect.width / 2;

              return x < center;
            }
          );

          if (charIndex < 0) {
            charIndex = chars.length;
          }

          selectedChordId = null;
          updateMobileControls();

          showInlineInput(
            row,
            line.id,
            charIndex,
            x
          );
        }
      );
    }

    return row;
  }

  function renderChordsOnRow(row, lineId) {
    song.chords
      .filter(chord => chord.lineId === lineId)
      .forEach(chord => {
        const chordElement =
          document.createElement('button');

        chordElement.type = 'button';
        chordElement.className =
          `chord${
            chord.id === selectedChordId
              ? ' selected'
              : ''
          }`;

        chordElement.textContent = chord.name;
        chordElement.dataset.chordId =
          chord.id;

        const baseX = getCharX(
          row,
          chord.charIndex
        );

        chordElement.style.left =
          `${baseX + (Number(chord.offset) || 0)}px`;

        chordElement.addEventListener(
          'click',
          event => {
            event.preventDefault();
            event.stopPropagation();

            if (!dragState?.moved) {
              selectChord(chord.id);
            }
          }
        );

        chordElement.addEventListener(
          'pointerdown',
          startDrag,
          { passive: false }
        );

        row.appendChild(chordElement);
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
    els.previewSheet.replaceChildren();

    const title =
      document.createElement('h2');

    title.textContent =
      song.title || '無題';

    const artist =
      document.createElement('p');

    artist.className = 'artist';
    artist.textContent = [
      song.artist,
      song.key ? `Key: ${song.key}` : '',
      Number(song.capo)
        ? `Capo: ${song.capo}`
        : ''
    ]
      .filter(Boolean)
      .join(' / ');

    const score =
      document.createElement('div');

    score.className = 'score';

    els.previewSheet.append(
      title,
      artist,
      score
    );

    song.lines.forEach(line => {
      const row = renderLine(line, false);

      score.appendChild(row);
      renderChordsOnRow(row, line.id);
    });
  }

  function renderFontSizeSettings() {
    if (!song) return;

    const lyricSize =
      clampFontSize(
        song.lyricFontSize,
        DEFAULT_LYRIC_FONT_SIZE
      );

    const chordSize =
      clampFontSize(
        song.chordFontSize,
        DEFAULT_CHORD_FONT_SIZE
      );

    song.lyricFontSize = lyricSize;
    song.chordFontSize = chordSize;

    els.lyricFontSize.value = lyricSize;
    els.chordFontSize.value = chordSize;

    els.lyricFontSizeValue.textContent =
      lyricSize;

    els.chordFontSizeValue.textContent =
      chordSize;

    document.documentElement.style.setProperty(
      '--lyric-font-size',
      `${lyricSize}px`
    );

    document.documentElement.style.setProperty(
      '--chord-font-size',
      `${chordSize}px`
    );
  }

  function renderAll() {
    if (!song) return;

    normalizeFontSizes(song);

    els.title.value = song.title || '';
    els.artist.value = song.artist || '';
    els.key.value = song.key || '';
    els.capo.value = song.capo || 0;

    if (els.lyrics.value !== song.lyrics) {
      els.lyrics.value = song.lyrics;
    }

    renderFontSizeSettings();
    renderEditor();
    renderPreview();
    updateMode();
    updateMobileControls();
  }

  function updateMode() {
    els.lyricsEditor.classList.toggle(
      'hidden',
      mode !== 'lyrics'
    );

    els.chordsEditor.classList.toggle(
      'hidden',
      mode !== 'chords'
    );

    els.preview.classList.toggle(
      'hidden',
      mode !== 'preview'
    );

    Object.entries(els.modes).forEach(
      ([name, button]) => {
        button.classList.toggle(
          'active',
          name === mode
        );
      }
    );
  }

  function switchMode(nextMode) {
    closeInlineInput();
    mode = nextMode;
    updateMode();

    if (mode === 'chords') {
      requestAnimationFrame(renderEditor);
    }

    if (mode === 'preview') {
      requestAnimationFrame(renderPreview);
    }
  }

  function showInlineInput(
    row,
    lineId,
    charIndex,
    x
  ) {
    closeInlineInput();

    inlineInput =
      document.createElement('input');

    inlineInput.className =
      'inline-chord-input';

    inlineInput.type = 'text';
    inlineInput.placeholder = 'コード';
    inlineInput.autocomplete = 'off';
    inlineInput.style.left = `${x}px`;

    row.appendChild(inlineInput);
    inlineInput.focus();

    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;

      const name =
        inlineInput?.value.trim() || '';

      if (name) {
        const baseX = getCharX(
          row,
          charIndex
        );

        song.chords.push({
          id: uid('chord'),
          name,
          lineId,
          charIndex,
          offset: x - baseX
        });

        commit('コード追加');
      }

      closeInlineInput();
      selectedChordId = null;
      renderAll();
    }

    inlineInput.addEventListener(
      'keydown',
      event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish();
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          finished = true;
          closeInlineInput();
        }
      }
    );

    inlineInput.addEventListener(
      'blur',
      () => setTimeout(finish, 80)
    );
  }

  function closeInlineInput() {
    if (inlineInput) {
      inlineInput.remove();
      inlineInput = null;
    }
  }

  function selectChord(id) {
    selectedChordId = id;
    updateMobileControls();
    renderEditor();
  }

  function updateMobileControls() {
    const chord = getSelectedChord();

    els.mobileControls.classList.toggle(
      'hidden',
      mode !== 'chords' || !chord
    );

    if (chord) {
      els.selectedChordName.value =
        chord.name;
    }
  }

  function deleteSelected() {
    const chord = getSelectedChord();

    if (!chord) return;

    song.chords = song.chords.filter(
      item => item.id !== chord.id
    );

    selectedChordId = null;
    commit('コード削除');
    renderAll();
  }

  function nudge(amount) {
    const chord = getSelectedChord();

    if (!chord) return;

    chord.offset =
      Number(chord.offset || 0) + amount;

    commit('コード微調整');
    renderAll();
    selectChord(chord.id);
  }

  function startDrag(event) {
    if (mode !== 'chords') return;

    event.preventDefault();
    event.stopPropagation();

    const chordElement =
      event.currentTarget;

    const chord =
      getChordById(
        chordElement.dataset.chordId
      );

    if (!chord) return;

    const rect =
      chordElement.getBoundingClientRect();

    selectedChordId = chord.id;
    updateMobileControls();

    dragState = {
      id: chord.id,
      pointerId: event.pointerId,
      chordElement,
      grabDelta:
        event.clientX -
        (rect.left + rect.width / 2),
      originalOffset:
        Number(chord.offset || 0),
      moved: false
    };

    chordElement.setPointerCapture?.(
      event.pointerId
    );

    document.addEventListener(
      'pointermove',
      moveDrag,
      { passive: false }
    );

    document.addEventListener(
      'pointerup',
      endDrag,
      { once: true }
    );

    document.addEventListener(
      'pointercancel',
      endDrag,
      { once: true }
    );
  }

  function moveDrag(event) {
    if (
      !dragState ||
      event.pointerId !== dragState.pointerId
    ) {
      return;
    }

    event.preventDefault();

    const chord =
      getChordById(dragState.id);

    const row =
      dragState.chordElement
        .closest('.score-line');

    if (!chord || !row) return;

    const rowRect =
      row.getBoundingClientRect();

    const baseX =
      getCharX(row, chord.charIndex);

    const pointerCenterX =
      event.clientX -
      rowRect.left -
      dragState.grabDelta;

    const nextOffset =
      pointerCenterX - baseX;

    chord.offset = nextOffset;

    if (
      Math.abs(
        nextOffset -
        dragState.originalOffset
      ) > 2
    ) {
      dragState.moved = true;
    }

    dragState.chordElement.style.left =
      `${baseX + chord.offset}px`;
  }

  function endDrag(event) {
    if (!dragState) return;

    if (
      event &&
      event.pointerId !== dragState.pointerId
    ) {
      return;
    }

    const finished = dragState;

    document.removeEventListener(
      'pointermove',
      moveDrag
    );

    document.removeEventListener(
      'pointercancel',
      endDrag
    );

    dragState = null;

    if (finished.moved) {
      commit('コード移動');
    }

    selectedChordId = finished.id;
    renderAll();
  }

  function updateMeta() {
    song.title = els.title.value;
    song.artist = els.artist.value;
    song.key = els.key.value;
    song.capo =
      Math.max(0, Number(els.capo.value) || 0);

    commit('曲情報を編集');
    renderHome();
  }

  function updateFontSize(type, value) {
    if (!song) return;

    const size = clampFontSize(
      value,
      type === 'lyricFontSize'
        ? DEFAULT_LYRIC_FONT_SIZE
        : DEFAULT_CHORD_FONT_SIZE
    );

    if (song[type] === size) return;

    song[type] = size;

    commit(
      type === 'lyricFontSize'
        ? '歌詞サイズ変更'
        : 'コードサイズ変更'
    );

    renderAll();
  }

  function resetFontSizes() {
    if (!song) return;

    if (
      song.lyricFontSize === DEFAULT_LYRIC_FONT_SIZE &&
      song.chordFontSize === DEFAULT_CHORD_FONT_SIZE
    ) {
      return;
    }

    song.lyricFontSize =
      DEFAULT_LYRIC_FONT_SIZE;

    song.chordFontSize =
      DEFAULT_CHORD_FONT_SIZE;

    commit('文字サイズを標準に戻す');
    renderAll();
  }

  function openEditor(id) {
    const target =
      store.songs.find(
        item => item.id === id
      );

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

    if (dragState) {
      endDrag();
    }

    persistStore();

    els.editor.classList.add('hidden');
    els.home.classList.remove('hidden');

    renderHome();
  }

  function duplicateSong(id) {
    const source =
      store.songs.find(
        item => item.id === id
      );

    if (!source) return;

    const copied = clone(source);

    copied.id = uid('song');
    copied.title =
      `${source.title || '無題'} のコピー`;
    copied.updatedAt = Date.now();

    const lineIds = new Map();

    copied.lines.forEach(line => {
      const oldId = line.id;
      line.id = uid('line');
      lineIds.set(oldId, line.id);
    });

    copied.chords.forEach(chord => {
      chord.id = uid('chord');
      chord.lineId =
        lineIds.get(chord.lineId) ||
        chord.lineId;
    });

    store.songs.push(copied);
    persistStore();
    renderHome();
  }

  function deleteSong(id) {
    const target =
      store.songs.find(
        item => item.id === id
      );

    if (!target) return;

    if (
      !window.confirm(
        `「${target.title || '無題'}」を削除しますか？`
      )
    ) {
      return;
    }

    store.songs =
      store.songs.filter(
        item => item.id !== id
      );

    if (store.currentSongId === id) {
      store.currentSongId = null;
    }

    if (song?.id === id) {
      song = null;
    }

    persistStore();
    renderHome();
  }

  function renderHome() {
    els.songList.replaceChildren();

    els.songCount.textContent =
      `${store.songs.length}曲`;

    els.emptyMessage.classList.toggle(
      'hidden',
      store.songs.length !== 0
    );

    [...store.songs]
      .sort(
        (a, b) =>
          (b.updatedAt || 0) -
          (a.updatedAt || 0)
      )
      .forEach(item => {
        const card =
          document.createElement('article');

        card.className = 'song-card';

        const title =
          document.createElement('h3');

        title.textContent =
          item.title || '無題';

        const artist =
          document.createElement('p');

        artist.textContent =
          item.artist || 'アーティスト未設定';

        const meta =
          document.createElement('p');

        meta.textContent = [
          item.key ? `Key: ${item.key}` : '',
          Number(item.capo)
            ? `Capo: ${item.capo}`
            : ''
        ]
          .filter(Boolean)
          .join(' / ') ||
          '曲情報未設定';

        const updated =
          document.createElement('p');

        updated.textContent =
          `更新: ${
            new Date(
              item.updatedAt || Date.now()
            ).toLocaleString('ja-JP')
          }`;

        const actions =
          document.createElement('div');

        actions.className =
          'song-card-actions';

        const open =
          document.createElement('button');

        open.textContent = '開く';
        open.addEventListener(
          'click',
          () => openEditor(item.id)
        );

        const duplicate =
          document.createElement('button');

        duplicate.textContent = '複製';
        duplicate.addEventListener(
          'click',
          () => duplicateSong(item.id)
        );

        const remove =
          document.createElement('button');

        remove.className = 'delete-song';
        remove.textContent = '削除';
        remove.addEventListener(
          'click',
          () => deleteSong(item.id)
        );

        actions.append(
          open,
          duplicate,
          remove
        );

        card.append(
          title,
          artist,
          meta,
          updated,
          actions
        );

        els.songList.appendChild(card);
      });
  }

  els.newSong.addEventListener(
    'click',
    () => {
      const fresh = createSong();

      store.songs.push(fresh);
      persistStore();
      openEditor(fresh.id);
    }
  );

  els.homeBtn.addEventListener(
    'click',
    showHome
  );

  els.lyrics.addEventListener(
    'input',
    () => {
      clearTimeout(lyricsTimer);

      lyricsTimer = setTimeout(
        () => syncLyrics(els.lyrics.value),
        250
      );
    }
  );

  [
    els.title,
    els.artist,
    els.key,
    els.capo
  ].forEach(input => {
    input.addEventListener(
      'change',
      updateMeta
    );
  });

  els.lyricFontSize.addEventListener(
    'input',
    event => {
      updateFontSize(
        'lyricFontSize',
        event.target.value
      );
    }
  );

  els.chordFontSize.addEventListener(
    'input',
    event => {
      updateFontSize(
        'chordFontSize',
        event.target.value
      );
    }
  );

  els.resetFontSize.addEventListener(
    'click',
    resetFontSizes
  );

  els.modes.lyrics.addEventListener(
    'click',
    () => switchMode('lyrics')
  );

  els.modes.chords.addEventListener(
    'click',
    () => switchMode('chords')
  );

  els.modes.preview.addEventListener(
    'click',
    () => switchMode('preview')
  );

  els.undo.addEventListener(
    'click',
    undo
  );

  els.redo.addEventListener(
    'click',
    redo
  );

  els.print.addEventListener(
    'click',
    () => {
      renderPreview();

      requestAnimationFrame(
        () => window.print()
      );
    }
  );

  window.addEventListener(
    'beforeprint',
    () => {
      renderPreview();
      els.preview.classList.remove('hidden');
    }
  );

  $('#deleteChordBtn')?.addEventListener(
    'click',
    deleteSelected
  );

  $('#nudgeLeftBtn')?.addEventListener(
    'click',
    () => nudge(-1)
  );

  $('#nudgeRightBtn')?.addEventListener(
    'click',
    () => nudge(1)
  );

  els.selectedChordName?.addEventListener(
    'change',
    () => {
      const chord = getSelectedChord();

      if (!chord) return;

      const name =
        els.selectedChordName.value.trim();

      if (!name) return;

      chord.name = name;

      commit('コード名変更');
      renderAll();
      selectChord(chord.id);
    }
  );

  document.addEventListener(
    'keydown',
    event => {
      if (
        mode !== 'chords' ||
        !getSelectedChord()
      ) {
        return;
      }

      if (
        event.target.matches(
          'input, textarea'
        )
      ) {
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

      if (
        event.key === 'Delete' ||
        event.key === 'Backspace'
      ) {
        event.preventDefault();
        deleteSelected();
      }

      if (event.key === 'Escape') {
        selectedChordId = null;
        updateMobileControls();
        renderEditor();
      }
    }
  );

  if (store.songs.length) {
    const initial =
      store.songs.find(
        item => item.id === store.currentSongId
      ) || store.songs[0];

    song = initial;
    normalizeSong(song);
    resetHistory();
  }

  renderHome();
})();
