(() => {
  'use strict';

  const STORAGE_KEY = 'guitar-score-app-v1';
  const MAX_HISTORY = 100;
  const LONG_PRESS = 600;
  const DRAG_THRESHOLD = 5;
  const DUPLICATE_OFFSET = 20;

  const DEFAULTS = {
    lyricFontSize: 13,
    chordFontSize: 13,
    lyricFontFamily: 'sans-serif',
    chordFontFamily: 'monospace'
  };

  const $ = selector => document.querySelector(selector);
  const clone = value => JSON.parse(JSON.stringify(value));

  const clamp = (value, min, max, fallback) => {
    const number = Number(value);

    return Number.isFinite(number)
      ? Math.min(max, Math.max(min, number))
      : fallback;
  };

  const uid = prefix =>
    `${prefix}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const els = {
    home: $('#homeScreen'),
    editor: $('#editorScreen'),
    songList: $('#songList'),
    songCount: $('#songCount'),
    empty: $('#emptyMessage'),
    newSong: $('#newSongBtn'),
    homeBtn: $('#homeBtn'),

    title: $('#titleInput'),
    artist: $('#artistInput'),
    key: $('#keyInput'),
    capo: $('#capoInput'),

    lyrics: $('#lyricsInput'),
    score: $('#scoreEditor'),
    preview: $('#preview'),
    previewSheet: $('#previewSheet'),
    lyricsEditor: $('#lyricsEditor'),
    chordsEditor: $('#chordsEditor'),

    chordTools: $('#chordTools'),
    palette: $('#chordPalette'),
    paletteTabs: [...document.querySelectorAll('.palette-tab')],
    clearPalette: $('#clearPaletteBtn'),
    closePalette: $('#closePaletteBtn'),
    paletteBackdrop: $('#paletteBackdrop'),

    mobile: $('#mobileControls'),
    addChord: $('#addChordBtn'),
    selectedName: $('#selectedChordName'),
    delete: $('#deleteChordBtn'),
    duplicate: $('#duplicateChordBtn'),
    left: $('#nudgeLeftBtn'),
    right: $('#nudgeRightBtn'),
    copy: $('#copyChordBtn'),
    paste: $('#pasteChordBtn'),

    transposeDown: $('#transposeDownBtn'),
    transposeUp: $('#transposeUpBtn'),
    transposeValue: $('#transposeValue'),
    resetTranspose: $('#resetTransposeBtn'),

    undo: $('#undoBtn'),
    redo: $('#redoBtn'),
    print: $('#printBtn'),
    status: $('#status'),

    lyricSize: $('#lyricFontSizeInput'),
    chordSize: $('#chordFontSizeInput'),
    lyricSizeValue: $('#lyricFontSizeValue'),
    chordSizeValue: $('#chordFontSizeValue'),
    lyricFamily: $('#lyricFontFamilyInput'),
    chordFamily: $('#chordFontFamilyInput'),
    resetSize: $('#resetFontSizeBtn'),

    modes: {
      lyrics: $('#lyricsMode'),
      chords: $('#chordsMode'),
      preview: $('#previewMode')
    }
  };

  const palettes = {
    basic: [
      'C', 'D', 'E', 'F', 'G', 'A', 'B'
    ],
    minor: [
      'Am', 'Bm', 'Cm', 'Dm', 'Em', 'Fm', 'Gm'
    ],
    seventh: [
      'C7', 'D7', 'E7', 'F7', 'G7', 'A7', 'B7'
    ],
    other: [
      'Cmaj7', 'Dmaj7', 'Fmaj7', 'Gmaj7',
      'Am7', 'Dm7', 'Em7',
      'Asus4', 'Dsus4', 'Esus4',
      'Cadd9', 'Dadd9', 'Gadd9'
    ]
  };

  let store = loadStore();
  let song = null;
  let mode = 'lyrics';
  let selectedChordId = null;
  let selectedPaletteChord = null;
  let inlineInput = null;
  let dragState = null;
  let history = [];
  let historyIndex = -1;
  let saveTimer = null;
  let lyricsBeforeEdit = '';
  let longPressTimer = null;
  let longPressTriggered = false;
  let suppressChordActivation = false;

  function normalizeSong(target) {
    if (!target || typeof target !== 'object') {
      return null;
    }

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
    target.transpose = clamp(target.transpose, -12, 12, 0);
    target.updatedAt = Number(target.updatedAt) || Date.now();

    const oldLines = Array.isArray(target.lines)
      ? target.lines
      : [];

    target.lines = target.lyrics.split('\n').map((text, index) => ({
      id: oldLines[index]?.id || uid('line'),
      text
    }));

    if (!target.lines.length) {
      target.lines.push({
        id: uid('line'),
        text: ''
      });
    }

    const validLineIds = new Set(
      target.lines.map(line => line.id)
    );

    target.chords = Array.isArray(target.chords)
      ? target.chords
          .map(chord => ({
            id: chord.id || uid('chord'),
            name: String(chord.name || ''),
            lineId: validLineIds.has(chord.lineId)
              ? chord.lineId
              : target.lines[0].id,
            charIndex: Math.max(
              0,
              Number(chord.charIndex) || 0
            ),
            offset: Number(chord.offset) || 0
          }))
          .filter(chord => chord.name)
      : [];

    target.lyricFontSize = clamp(
      target.lyricFontSize,
      12,
      32,
      DEFAULTS.lyricFontSize
    );

    target.chordFontSize = clamp(
      target.chordFontSize,
      12,
      32,
      DEFAULTS.chordFontSize
    );

    target.lyricFontFamily =
      typeof target.lyricFontFamily === 'string' &&
      target.lyricFontFamily.trim()
        ? target.lyricFontFamily.trim()
        : DEFAULTS.lyricFontFamily;

    target.chordFontFamily =
      typeof target.chordFontFamily === 'string' &&
      target.chordFontFamily.trim()
        ? target.chordFontFamily.trim()
        : DEFAULTS.chordFontFamily;

    return target;
  }

  function loadStore() {
    const emptyStore = {
      version: 2,
      songs: [],
      currentSongId: null
    };

    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return emptyStore;
      }

      const saved = JSON.parse(raw);

      if (Array.isArray(saved.songs)) {
        return {
          version: 2,
          songs: saved.songs
            .map(normalizeSong)
            .filter(Boolean),
          currentSongId: saved.currentSongId || null
        };
      }

      const migratedSong = normalizeSong(saved);

      return {
        version: 2,
        songs: migratedSong ? [migratedSong] : [],
        currentSongId: migratedSong?.id || null
      };
    } catch {
      return emptyStore;
    }
  }

  function persist() {
    if (song) {
      store.currentSongId = song.id;
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(store)
    );
  }

  function save() {
    clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
      if (!song) {
        return;
      }

      song.updatedAt = Date.now();

      const index = store.songs.findIndex(
        item => item.id === song.id
      );

      if (index >= 0) {
        store.songs[index] = clone(song);
      }

      persist();
    }, 150);
  }

  function commit(label) {
    if (!song) {
      return;
    }

    song.updatedAt = Date.now();

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
    save();
  }

  function resetHistory() {
    history = [
      {
        song: clone(song),
        label: '初期状態'
      }
    ];

    historyIndex = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    els.undo.disabled = historyIndex <= 0;
    els.redo.disabled =
      historyIndex >= history.length - 1;
  }

  function replaceCurrentSong() {
    if (!song) {
      return;
    }

    const index = store.songs.findIndex(
      item => item.id === song.id
    );

    if (index >= 0) {
      store.songs[index] = clone(song);
    }

    persist();
  }

  function getChord(id = selectedChordId) {
    return song?.chords.find(
      chord => chord.id === id
    );
  }

  function getSelectedChord() {
    return getChord(selectedChordId);
  }

  function renderChars(text) {
    const fragment =
      document.createDocumentFragment();

    [...text].forEach((character, index) => {
      const span = document.createElement('span');

      span.className = 'lyric-char';
      span.dataset.index = index;
      span.textContent =
        character === ' '
          ? '\u00a0'
          : character;

      fragment.appendChild(span);
    });

    return fragment;
  }

  function getCharX(row, index) {
    const chars = row.querySelectorAll(
      '.lyric-char'
    );

    if (!chars.length) {
      return 0;
    }

    const rowRect = row.getBoundingClientRect();

    if (index >= chars.length) {
      return (
        chars[chars.length - 1]
          .getBoundingClientRect()
          .right - rowRect.left
      );
    }

    return (
      chars[index].getBoundingClientRect().left -
      rowRect.left
    );
  }

  function getCharIndexAtX(row, clientX) {
    const rowRect = row.getBoundingClientRect();
    const chars = [
      ...row.querySelectorAll('.lyric-char')
    ];

    if (!chars.length) {
      return 0;
    }

    const index = chars.findIndex(character => {
      const rect =
        character.getBoundingClientRect();

      return clientX <
        rect.left + rect.width / 2;
    });

    return index < 0 ? chars.length : index;
  }

  function createRow(line, editable) {
    const row = document.createElement('div');

    row.className = editable
      ? 'score-line'
      : 'preview-line';

    row.dataset.lineId = line.id;

    const lyric = document.createElement('span');
    lyric.className = 'lyric-text';
    lyric.appendChild(renderChars(line.text));

    row.appendChild(lyric);

    if (editable) {
      row.addEventListener('pointerup', event => {
        if (
          dragState ||
          event.target.closest(
            '.chord, .inline-chord-input'
          )
        ) {
          return;
        }

        const rowRect =
          row.getBoundingClientRect();

        const clickX =
          event.clientX - rowRect.left;

        const charIndex =
          getCharIndexAtX(row, event.clientX);

        if (selectedPaletteChord) {
          addChord(
            line.id,
            charIndex,
            clickX,
            selectedPaletteChord
          );

          selectedPaletteChord = null;
          renderPalette();
          closeMobilePalette();
          return;
        }

        clearSelectedChord();

        showInlineInput(
          row,
          line.id,
          charIndex,
          clickX
        );
      });
    }

    return row;
  }

  function addChord(
    lineId,
    charIndex,
    clickX,
    name
  ) {
    const row = [
      ...els.score.querySelectorAll('.score-line')
    ].find(
      item => item.dataset.lineId === lineId
    );

    if (!row) {
      return;
    }

    const baseX = getCharX(row, charIndex);

    const chord = {
      id: uid('chord'),
      name: String(name).trim(),
      lineId,
      charIndex,
      offset: clickX - baseX
    };

    if (!chord.name) {
      return;
    }

    song.chords.push(chord);
    selectedChordId = chord.id;

    commit('コード追加');
    renderAll();
  }

  function renderChordsOnRow(
    row,
    lineId,
    editable
  ) {
    song.chords
      .filter(chord => chord.lineId === lineId)
      .forEach(chord => {
        const button =
          document.createElement('button');

        button.type = 'button';
        button.className =
          'chord' +
          (
            chord.id === selectedChordId
              ? ' selected'
              : ''
          );

        button.textContent = chord.name;
        button.dataset.chordId = chord.id;

        const baseX = getCharX(
          row,
          chord.charIndex
        );

        button.style.left =
          `${baseX + chord.offset}px`;

        if (!editable) {
          button.disabled = true;
          button.style.pointerEvents = 'none';
          row.appendChild(button);
          return;
        }

        button.addEventListener(
          'pointerdown',
          event => {
            if (event.pointerType === 'touch') {
              event.preventDefault();
            }

            startLongPress(event);
            startDrag(event);
          },
          { passive: false }
        );

        button.addEventListener(
          'pointermove',
          event => {
            if (
              dragState &&
              event.pointerId === dragState.pointerId
            ) {
              cancelLongPress();
            }
          },
          { passive: false }
        );

        button.addEventListener(
          'pointerup',
          event => {
            cancelLongPress();

            if (longPressTriggered) {
              event.preventDefault();
              event.stopPropagation();
              longPressTriggered = false;
            }
          }
        );

        button.addEventListener(
          'pointercancel',
          () => {
            cancelLongPress();
          }
        );

        button.addEventListener(
          'click',
          event => {
            event.preventDefault();
            event.stopPropagation();

            if (longPressTriggered) {
              longPressTriggered = false;
              return;
            }

            if (suppressChordActivation) {
              suppressChordActivation = false;
              return;
            }

            selectChord(chord.id);
          }
        );

        button.addEventListener(
          'dblclick',
          event => {
            event.preventDefault();
            event.stopPropagation();

            showExistingChordInput(
              row,
              button,
              chord
            );
          }
        );

        row.appendChild(button);
      });
  }

  function renderEditor() {
    els.score.replaceChildren();

    song.lines.forEach(line => {
      const row = createRow(line, true);

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
      song.key ? `Key: ${song.key}` : 'Key: 未設定',
      `Capo: ${song.capo}`
    ]
      .filter(Boolean)
      .join(' / ');

    const score = document.createElement('div');
    score.className = 'score';

    els.previewSheet.append(title, artist, score);

    song.lines.forEach(line => {
      const row = createRow(line, false);

      score.appendChild(row);
      renderChordsOnRow(row, line.id, false);
    });
  }

  function renderFonts() {
    const root = document.documentElement;

    root.style.setProperty(
      '--lyric-font-size',
      `${song.lyricFontSize}px`
    );

    root.style.setProperty(
      '--chord-font-size',
      `${song.chordFontSize}px`
    );

    root.style.setProperty(
      '--lyric-font-family',
      song.lyricFontFamily
    );

    root.style.setProperty(
      '--chord-font-family',
      song.chordFontFamily
    );

    els.lyricSize.value = song.lyricFontSize;
    els.chordSize.value = song.chordFontSize;
    els.lyricSizeValue.textContent = song.lyricFontSize;
    els.chordSizeValue.textContent = song.chordFontSize;
    els.lyricFamily.value = song.lyricFontFamily;
    els.chordFamily.value = song.chordFontFamily;
  }

  function renderTransposeValue() {
    const value = Number(song?.transpose) || 0;

    els.transposeValue.textContent =
      value > 0
        ? `+${value}`
        : String(value);
  }

  function renderAll() {
    if (!song) {
      return;
    }

    normalizeSong(song);

    els.title.value = song.title;
    els.artist.value = song.artist;
    els.key.value = song.key;
    els.capo.value = song.capo;

    if (els.lyrics.value !== song.lyrics) {
      els.lyrics.value = song.lyrics;
    }

    renderFonts();
    renderEditor();
    renderPreview();
    renderPalette();
    renderTransposeValue();
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

    updateMobileControls();
  }

  function switchMode(nextMode) {
    closeInlineInput();
    mode = nextMode;

    if (mode !== 'chords') {
      closeMobilePalette();
    }

    updateMode();

    if (mode === 'chords') {
      renderEditor();
      updateMobileControls();
    }

    if (mode === 'preview') {
      renderPreview();
    }
  }

  function closeInlineInput() {
    inlineInput?.remove();
    inlineInput = null;
  }

  function showInlineInput(
    row,
    lineId,
    charIndex,
    clickX
  ) {
    closeInlineInput();

    const input = document.createElement('input');

    inlineInput = input;
    input.className = 'inline-chord-input';
    input.type = 'text';
    input.placeholder = 'コード';
    input.autocomplete = 'off';
    input.style.left = `${clickX}px`;

    row.appendChild(input);
    input.focus();

    let finished = false;
    let cancelled = false;

    const finish = () => {
      if (finished || cancelled) {
        return;
      }

      finished = true;

      const name = input.value.trim();

      if (name) {
        const baseX = getCharX(row, charIndex);

        const chord = {
          id: uid('chord'),
          name,
          lineId,
          charIndex,
          offset: clickX - baseX
        };

        song.chords.push(chord);
        selectedChordId = chord.id;

        commit('コード追加');
      }

      closeInlineInput();
      renderAll();
    };

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish();
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        cancelled = true;
        finished = true;
        closeInlineInput();
      }
    });

    input.addEventListener('blur', () => {
      if (!cancelled) {
        finish();
      }
    });
  }

  function showExistingChordInput(
    row,
    chordElement,
    chord
  ) {
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
    const chordRect =
      chordElement.getBoundingClientRect();

    input.style.left =
      `${chordRect.left +
        chordRect.width / 2 -
        rowRect.left}px`;

    row.appendChild(input);
    input.focus();
    input.select();

    let finished = false;
    let cancelled = false;

    const finish = () => {
      if (finished || cancelled) {
        return;
      }

      finished = true;

      const name = input.value.trim();

      if (name && name !== chord.name) {
        chord.name = name;
        commit('コード名変更');
      }

      closeInlineInput();
      selectedChordId = chord.id;
      renderAll();
    };

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish();
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        cancelled = true;
        finished = true;
        closeInlineInput();
      }
    });

    input.addEventListener('blur', () => {
      if (!cancelled) {
        finish();
      }
    });
  }

  function startLongPress(event) {
    if (
      event.pointerType === 'mouse' ||
      dragState
    ) {
      return;
    }

    const element = event.currentTarget;
    const chord = getChord(
      element.dataset.chordId
    );

    if (!chord) {
      return;
    }

    cancelLongPress();
    longPressTriggered = false;

    longPressTimer = setTimeout(async () => {
      longPressTriggered = true;
      selectedChordId = chord.id;
      updateMobileControls();

      try {
        await navigator.clipboard.writeText(
          chord.name
        );

        els.status.textContent =
          `コード「${chord.name}」をコピーしました`;
      } catch {
        els.status.textContent =
          'コピーできませんでした';
      }
    }, LONG_PRESS);
  }

  function cancelLongPress() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function selectChord(id) {
    closeInlineInput();
    selectedChordId = id;

    els.score
      .querySelectorAll('.chord.selected')
      .forEach(element => {
        element.classList.remove('selected');
      });

    const selected = [
      ...els.score.querySelectorAll('.chord')
    ].find(
      element =>
        element.dataset.chordId === id
    );

    selected?.classList.add('selected');
    updateMobileControls();
  }

  function clearSelectedChord() {
    selectedChordId = null;

    els.score
      .querySelectorAll('.chord.selected')
      .forEach(element => {
        element.classList.remove('selected');
      });

    updateMobileControls();
  }

  function updateMobileControls() {
    const chord = getSelectedChord();
    const visible = mode === 'chords';

    els.mobile.classList.toggle(
      'hidden',
      !visible
    );

    els.delete.disabled = !chord;
    els.duplicate.disabled = !chord;
    els.left.disabled = !chord;
    els.right.disabled = !chord;
    els.copy.disabled = !chord;
    els.paste.disabled = !chord;
    els.selectedName.disabled = !chord;

    if (chord) {
      els.selectedName.value = chord.name;
    } else {
      els.selectedName.value = '';
    }
  }

  function openMobilePalette() {
    if (mode !== 'chords') {
      switchMode('chords');
    }

    els.chordTools.classList.add(
      'mobile-palette-open'
    );

    els.paletteBackdrop.classList.remove(
      'hidden'
    );

    els.status.textContent =
      'パレットからコードを選択してください';
  }

  function closeMobilePalette() {
    els.chordTools.classList.remove(
      'mobile-palette-open'
    );

    els.paletteBackdrop.classList.add(
      'hidden'
    );
  }

  async function copySelectedChord() {
    const chord = getSelectedChord();

    if (!chord) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        chord.name
      );

      els.status.textContent =
        `コード「${chord.name}」をコピーしました`;
    } catch {
      els.status.textContent =
        'コピーできませんでした';
    }
  }

  async function pasteChord() {
    if (!song) {
      return;
    }

    let name = '';

    try {
      name = (
        await navigator.clipboard.readText()
      ).trim();
    } catch {
      els.status.textContent =
        '貼り付けできませんでした';
      return;
    }

    if (!name) {
      return;
    }

    const baseChord = getSelectedChord();

    if (!baseChord) {
      els.status.textContent =
        '貼り付ける位置のコードを先に選択してください';
      return;
    }

    const pastedChord = {
      id: uid('chord'),
      name,
      lineId: baseChord.lineId,
      charIndex: baseChord.charIndex,
      offset:
        Number(baseChord.offset || 0) +
        DUPLICATE_OFFSET
    };

    song.chords.push(pastedChord);
    selectedChordId = pastedChord.id;

    commit('コード貼り付け');
    renderAll();
  }

  function duplicateSelectedChord() {
    const source = getSelectedChord();

    if (!source) {
      return;
    }

    const copied = clone(source);

    copied.id = uid('chord');
    copied.offset =
      Number(copied.offset || 0) +
      DUPLICATE_OFFSET;

    while (
      song.chords.some(chord =>
        chord.id !== copied.id &&
        chord.lineId === copied.lineId &&
        chord.charIndex === copied.charIndex &&
        Math.abs(
          Number(chord.offset || 0) -
          Number(copied.offset || 0)
        ) < 1
      )
    ) {
      copied.offset += DUPLICATE_OFFSET;
    }

    song.chords.push(copied);
    selectedChordId = copied.id;

    commit('コード複製');
    renderAll();
  }

  function deleteSelectedChord() {
    const chord = getSelectedChord();

    if (!chord) {
      return;
    }

    song.chords = song.chords.filter(
      item => item.id !== chord.id
    );

    selectedChordId = null;

    commit('コード削除');
    renderAll();
  }

  function nudge(amount) {
    const chord = getSelectedChord();

    if (!chord) {
      return;
    }

    chord.offset =
      Number(chord.offset || 0) + amount;

    commit('コード位置調整');
    renderAll();
  }

  function getTargetRow(clientY) {
    const rows = [
      ...els.score.querySelectorAll('.score-line')
    ];

    if (!rows.length) {
      return null;
    }

    return rows.reduce((nearest, row) => {
      const rect = row.getBoundingClientRect();
      const nearestRect =
        nearest.getBoundingClientRect();

      const distance =
        Math.abs(
          clientY -
          (rect.top + rect.height / 2)
        );

      const nearestDistance =
        Math.abs(
          clientY -
          (nearestRect.top +
            nearestRect.height / 2)
        );

      return distance < nearestDistance
        ? row
        : nearest;
    });
  }

  function startDrag(event) {
    if (mode !== 'chords') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const element = event.currentTarget;
    const chord = getChord(
      element.dataset.chordId
    );
    const row =
      element.closest('.score-line');

    if (!chord || !row) {
      return;
    }

    const rect =
      element.getBoundingClientRect();

    selectedChordId = chord.id;

    dragState = {
      id: chord.id,
      pointerId: event.pointerId,
      element,
      currentRow: row,
      grabDelta:
        event.clientX -
        (rect.left + rect.width / 2),
      originalLineId: chord.lineId,
      originalCharIndex: chord.charIndex,
      originalOffset:
        Number(chord.offset || 0),
      moved: false
    };

    cancelLongPress();

    element.setPointerCapture?.(
      event.pointerId
    );

    document.addEventListener(
      'pointermove',
      moveDrag,
      { passive: false }
    );

    document.addEventListener(
      'pointerup',
      endDrag
    );

    document.addEventListener(
      'pointercancel',
      endDrag
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
    cancelLongPress();

    const chord =
      getChord(dragState.id);

    const targetRow =
      getTargetRow(event.clientY);

    if (!chord || !targetRow) {
      return;
    }

    const rowRect =
      targetRow.getBoundingClientRect();

    const charIndex =
      getCharIndexAtX(
        targetRow,
        event.clientX
      );

    const baseX =
      getCharX(
        targetRow,
        charIndex
      );

    const centerX =
      event.clientX -
      rowRect.left -
      dragState.grabDelta;

    const offset =
      centerX - baseX;

    const lineId =
      targetRow.dataset.lineId;

    if (
      chord.lineId !== lineId ||
      chord.charIndex !== charIndex ||
      Math.abs(
        offset -
        dragState.originalOffset
      ) >= DRAG_THRESHOLD
    ) {
      dragState.moved = true;
    }

    chord.lineId = lineId;
    chord.charIndex = charIndex;
    chord.offset = offset;

    if (
      dragState.currentRow !== targetRow
    ) {
      targetRow.appendChild(
        dragState.element
      );

      dragState.currentRow = targetRow;
    }

    dragState.element.style.left =
      `${baseX + offset}px`;
  }

  function endDrag(event) {
    if (
      !dragState ||
      (
        event &&
        event.pointerId !==
          dragState.pointerId
      )
    ) {
      return;
    }

    const finished = dragState;

    cancelLongPress();

    document.removeEventListener(
      'pointermove',
      moveDrag
    );

    document.removeEventListener(
      'pointerup',
      endDrag
    );

    document.removeEventListener(
      'pointercancel',
      endDrag
    );

    dragState = null;
    selectedChordId = finished.id;

    if (finished.moved) {
      suppressChordActivation = true;

      commit('コード移動');
      renderAll();

      setTimeout(() => {
        suppressChordActivation = false;
      }, 0);
    } else {
      updateMobileControls();
    }
  }

  function applyLyrics(text) {
    const previousLines =
      song.lines || [];

    song.lyrics = String(text);

    song.lines =
      song.lyrics.split('\n').map(
        (lineText, index) => ({
          id:
            previousLines[index]?.id ||
            uid('line'),
          text: lineText
        })
      );

    const validLineIds =
      new Set(
        song.lines.map(line => line.id)
      );

    song.chords =
      song.chords.filter(chord =>
        validLineIds.has(chord.lineId)
      );
  }

  function updateMeta() {
    const before =
      JSON.stringify({
        title: song.title,
        artist: song.artist,
        key: song.key,
        capo: song.capo
      });

    song.title = els.title.value;
    song.artist = els.artist.value;
    song.key = els.key.value;
    song.capo = clamp(
      els.capo.value,
      0,
      12,
      0
    );

    const after =
      JSON.stringify({
        title: song.title,
        artist: song.artist,
        key: song.key,
        capo: song.capo
      });

    if (before === after) {
      return;
    }

    commit('曲情報を編集');
    renderHome();
  }

  function updateFontSize(type, value) {
    const fallback =
      type === 'lyricFontSize'
        ? DEFAULTS.lyricFontSize
        : DEFAULTS.chordFontSize;

    const size = clamp(
      value,
      12,
      32,
      fallback
    );

    if (song[type] === size) {
      return;
    }

    song[type] = size;

    commit(
      type === 'lyricFontSize'
        ? '歌詞サイズ変更'
        : 'コードサイズ変更'
    );

    renderAll();
  }

  function updateFontFamily(type, value) {
    const fallback =
      type === 'lyricFontFamily'
        ? DEFAULTS.lyricFontFamily
        : DEFAULTS.chordFontFamily;

    const family =
      typeof value === 'string' &&
      value.trim()
        ? value.trim()
        : fallback;

    if (song[type] === family) {
      return;
    }

    song[type] = family;

    commit(
      type === 'lyricFontFamily'
        ? '歌詞フォント変更'
        : 'コードフォント変更'
    );

    renderAll();
  }

  function resetFontSizes() {
    if (
      song.lyricFontSize ===
        DEFAULTS.lyricFontSize &&
      song.chordFontSize ===
        DEFAULTS.chordFontSize
    ) {
      return;
    }

    song.lyricFontSize =
      DEFAULTS.lyricFontSize;

    song.chordFontSize =
      DEFAULTS.chordFontSize;

    commit('文字サイズを標準に戻す');
    renderAll();
  }

  function parseChordName(name) {
   const match = String(name)
    .trim()
    .match(
      /^([A-Ga-g])([#♯b♭]?)([^/]*?)(?:\/([A-Ga-g])([#♯b♭]?))?$/
    );

  if (!match) {
    return null;
  }

  const normalizeAccidental = value =>
    String(value || '')
      .replace('♯', '#')
      .replace('♭', 'b');

  const root =
    match[1].toUpperCase() +
    normalizeAccidental(match[2]);

  const bass = match[4]
    ? match[4].toUpperCase() +
      normalizeAccidental(match[5])
    : null;

  if (getNoteIndex(root) === null) {
    return null;
  }

  if (bass && getNoteIndex(bass) === null) {
    return null;
  }

  return {
    root,
    suffix: match[3] || '',
    bass
  };
}

  const SHARP_NOTES = [
    'C', 'C#', 'D', 'D#', 'E', 'F',
    'F#', 'G', 'G#', 'A', 'A#', 'B'
  ];

  const FLAT_NOTES = {
    'C#': 'Db',
    'D#': 'Eb',
    'F#': 'Gb',
    'G#': 'Ab',
    'A#': 'Bb'
  };

  function getNoteIndex(note) {
  const normalized = String(note)
    .replace(/b/g, '#');

  const index =
    SHARP_NOTES.indexOf(normalized);

  return index >= 0 ? index : null;
  }

  function transposeNote(note, amount) {
    const index = getNoteIndex(note);

    if (index === null) {
      return note;
    }

    const result =
      SHARP_NOTES[
        (index + amount + 120) % 12
      ];

    return note.includes('b')
      ? FLAT_NOTES[result] || result
      : result;
  }

  function transposeChordName(name, amount) {
    const parsed =
      parseChordName(name);

    if (!parsed) {
      return name;
    }

    const root =
      transposeNote(
        parsed.root,
        amount
      );

    const bass = parsed.bass
      ? `/${transposeNote(
          parsed.bass,
          amount
        )}`
      : '';

    return `${root}${parsed.suffix}${bass}`;
  }

  function transposeAll(amount) {
    if (!song || amount === 0) {
      return;
    }

    const current =
      Number(song.transpose) || 0;

    const next =
      Math.max(
        -12,
        Math.min(12, current + amount)
      );

    const delta = next - current;

    if (delta === 0) {
      return;
    }

    song.chords.forEach(chord => {
      chord.name =
        transposeChordName(
          chord.name,
          delta
        );
    });

    song.transpose = next;

    commit(
      `一括移調 ${
        delta > 0 ? '+' : ''
      }${delta}`
    );

    renderAll();
  }

  function resetTranspose() {
    const current =
      Number(song?.transpose) || 0;

    if (!song || current === 0) {
      return;
    }

    transposeAll(-current);
  }

  function renderPalette() {
    const activeTab =
      els.paletteTabs.find(button =>
        button.classList.contains('active')
      );

    const category =
      activeTab?.dataset.palette ||
      'basic';

    els.palette.replaceChildren();

    (palettes[category] || []).forEach(name => {
      const button =
        document.createElement('button');

      button.type = 'button';
      button.textContent = name;
      button.className =
        selectedPaletteChord === name
          ? 'selected'
          : '';

      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        selectedPaletteChord = name;
        renderPalette();

        els.status.textContent =
          `「${name}」を選択中。歌詞上の位置をクリックしてください`;
      });

      els.palette.appendChild(button);
    });
  }

  function renderHome() {
    els.songList.replaceChildren();

    els.songCount.textContent =
      `${store.songs.length}曲`;

    els.empty.classList.toggle(
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

        const openButton =
          document.createElement('button');
        const duplicateButton =
          document.createElement('button');
        const deleteButton =
          document.createElement('button');

        card.className = 'song-card';

        title.textContent =
          item.title || '無題';

        artist.textContent =
          item.artist || 'アーティスト未設定';

        meta.textContent = [
          item.key ? `Key: ${item.key}` : '',
          Number(item.capo)
            ? `Capo: ${item.capo}`
            : ''
        ]
          .filter(Boolean)
          .join(' / ') || '曲情報未設定';

        updated.textContent =
          `更新: ${new Date(
            item.updatedAt
          ).toLocaleString('ja-JP')}`;

        actions.className =
          'song-card-actions';

        openButton.type = 'button';
        duplicateButton.type = 'button';
        deleteButton.type = 'button';

        openButton.textContent = '開く';
        duplicateButton.textContent = '複製';
        deleteButton.textContent = '削除';
        deleteButton.className = 'delete-song';

        openButton.addEventListener(
          'click',
          () => openEditor(item.id)
        );

        duplicateButton.addEventListener(
          'click',
          () => duplicateSong(item.id)
        );

        deleteButton.addEventListener(
          'click',
          () => deleteSong(item.id)
        );

        actions.append(
          openButton,
          duplicateButton,
          deleteButton
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

  function createSong() {
    return normalizeSong({
      id: uid('song'),
      title: '',
      artist: '',
      key: '',
      capo: 0,
      transpose: 0,
      lyrics: '',
      lines: [
        {
          id: uid('line'),
          text: ''
        }
      ],
      chords: [],
      ...DEFAULTS,
      updatedAt: Date.now()
    });
  }

  function openEditor(id) {
    const target =
      store.songs.find(item => item.id === id);

    if (!target) {
      return;
    }

    song = normalizeSong(target);
    store.currentSongId = song.id;
    persist();

    selectedChordId = null;
    selectedPaletteChord = null;
    mode = 'lyrics';

    closeMobilePalette();
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

    closeMobilePalette();
    persist();

    els.editor.classList.add('hidden');
    els.home.classList.remove('hidden');

    renderHome();
  }

  function duplicateSong(id) {
    const source =
      store.songs.find(item => item.id === id);

    if (!source) {
      return;
    }

    const copied = clone(source);
    const lineIdMap = new Map();

    copied.id = uid('song');
    copied.title =
      `${source.title || '無題'} のコピー`;
    copied.updatedAt = Date.now();

    copied.lines.forEach(line => {
      const oldId = line.id;

      line.id = uid('line');
      lineIdMap.set(oldId, line.id);
    });

    copied.chords.forEach(chord => {
      chord.id = uid('chord');
      chord.lineId =
        lineIdMap.get(chord.lineId);
    });

    store.songs.push(
      normalizeSong(copied)
    );

    persist();
    renderHome();
  }

  function deleteSong(id) {
    const target =
      store.songs.find(item => item.id === id);

    if (!target) {
      return;
    }

    const confirmed = window.confirm(
      `「${target.title || '無題'}」を削除しますか？`
    );

    if (!confirmed) {
      return;
    }

    store.songs =
      store.songs.filter(item => item.id !== id);

    if (store.currentSongId === id) {
      store.currentSongId = null;
    }

    if (song?.id === id) {
      song = null;
      els.editor.classList.add('hidden');
      els.home.classList.remove('hidden');
    }

    persist();
    renderHome();
  }

  els.newSong.addEventListener('click', () => {
    const fresh = createSong();

    store.songs.push(fresh);
    song = fresh;
    store.currentSongId = fresh.id;

    persist();
    openEditor(fresh.id);
  });

  els.homeBtn.addEventListener(
    'click',
    showHome
  );

  els.lyrics.addEventListener('focus', () => {
    lyricsBeforeEdit = song?.lyrics || '';
  });

  els.lyrics.addEventListener('input', () => {
    if (!song) {
      return;
    }

    applyLyrics(els.lyrics.value);
    renderEditor();
    save();
  });

  els.lyrics.addEventListener('blur', () => {
    if (
      song &&
      lyricsBeforeEdit !== song.lyrics
    ) {
      commit('歌詞を編集');
    }
  });

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

  els.lyricSize.addEventListener(
    'input',
    event => updateFontSize(
      'lyricFontSize',
      event.target.value
    )
  );

  els.chordSize.addEventListener(
    'input',
    event => updateFontSize(
      'chordFontSize',
      event.target.value
    )
  );

  els.lyricFamily.addEventListener(
    'change',
    event => updateFontFamily(
      'lyricFontFamily',
      event.target.value
    )
  );

  els.chordFamily.addEventListener(
    'change',
    event => updateFontFamily(
      'chordFontFamily',
      event.target.value
    )
  );

  els.resetSize.addEventListener(
    'click',
    resetFontSizes
  );

  els.copy.addEventListener(
    'click',
    copySelectedChord
  );

  els.paste.addEventListener(
    'click',
    pasteChord
  );

  els.delete.addEventListener(
    'click',
    deleteSelectedChord
  );

  els.duplicate.addEventListener(
    'click',
    duplicateSelectedChord
  );

  els.left.addEventListener(
    'click',
    () => nudge(-1)
  );

  els.right.addEventListener(
    'click',
    () => nudge(1)
  );

  els.selectedName.addEventListener(
    'change',
    () => {
      const chord = getSelectedChord();
      const name =
        els.selectedName.value.trim();

      if (
        !chord ||
        !name ||
        name === chord.name
      ) {
        return;
      }

      chord.name = name;
      commit('コード名変更');
      renderAll();
    }
  );

  els.addChord.addEventListener(
    'click',
    event => {
      event.preventDefault();
      event.stopPropagation();
      openMobilePalette();
    }
  );

  els.closePalette?.addEventListener(
    'click',
    closeMobilePalette
  );

  els.paletteBackdrop?.addEventListener(
    'click',
    closeMobilePalette
  );

  els.paletteTabs.forEach(button => {
    button.addEventListener(
      'click',
      () => {
        els.paletteTabs.forEach(tab => {
          tab.classList.remove('active');
          tab.setAttribute(
            'aria-selected',
            'false'
          );
        });

        button.classList.add('active');
        button.setAttribute(
          'aria-selected',
          'true'
        );

        renderPalette();
      }
    );
  });

  els.clearPalette.addEventListener(
    'click',
    () => {
      selectedPaletteChord = null;
      renderPalette();
      closeMobilePalette();
    }
  );

  els.transposeDown.addEventListener(
    'click',
    () => transposeAll(-1)
  );

  els.transposeUp.addEventListener(
    'click',
    () => transposeAll(1)
  );

  els.resetTranspose.addEventListener(
    'click',
    resetTranspose
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

  els.undo.addEventListener('click', () => {
    if (historyIndex <= 0) {
      return;
    }

    song = clone(
      history[--historyIndex].song
    );

    normalizeSong(song);
    selectedChordId =
      getChord(selectedChordId)
        ? selectedChordId
        : null;

    replaceCurrentSong();
    renderAll();
    updateHistoryButtons();
  });

  els.redo.addEventListener('click', () => {
    if (
      historyIndex >= history.length - 1
    ) {
      return;
    }

    song = clone(
      history[++historyIndex].song
    );

    normalizeSong(song);
    selectedChordId =
      getChord(selectedChordId)
        ? selectedChordId
        : null;

    replaceCurrentSong();
    renderAll();
    updateHistoryButtons();
  });

  els.print.addEventListener('click', () => {
    closeInlineInput();
    closeMobilePalette();
    renderPreview();

    requestAnimationFrame(() => {
      window.print();
    });
  });

  document.addEventListener('keydown', event => {
    if (
      inlineInput ||
      mode !== 'chords'
    ) {
      return;
    }

    if (
      event.target.matches(
        'input, textarea, select'
      )
    ) {
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'c'
    ) {
      if (!getSelectedChord()) {
        return;
      }

      event.preventDefault();
      copySelectedChord();
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'v'
    ) {
      if (!getSelectedChord()) {
        return;
      }

      event.preventDefault();
      pasteChord();
      return;
    }

    if (!getSelectedChord()) {
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
      deleteSelectedChord();
    }

    if (event.key === 'Escape') {
      clearSelectedChord();
    }
  });

  document.addEventListener(
    'pointerdown',
    event => {
      const chord =
        event.target.closest('.chord');

      const controls =
        event.target.closest(
          '.mobile-controls'
        );

      const tools =
        event.target.closest(
          '#chordTools'
        );

      const input =
        event.target.closest(
          '.inline-chord-input'
        );

      const backdrop =
        event.target.closest(
          '#paletteBackdrop'
        );

      if (inlineInput && !input) {
        setTimeout(
          () => inlineInput?.blur(),
          0
        );
      }

      if (
        els.chordTools.classList.contains(
          'mobile-palette-open'
        ) &&
        !tools &&
        !controls &&
        !backdrop
      ) {
        closeMobilePalette();
      }

      if (
        selectedChordId &&
        !chord &&
        !controls &&
        !input &&
        !tools
      ) {
        clearSelectedChord();
      }
    },
    true
  );

  song = null;
selectedChordId = null;
selectedPaletteChord = null;
mode = 'lyrics';

els.editor.classList.add('hidden');
els.home.classList.remove('hidden');

renderPalette();
renderHome();
})();
