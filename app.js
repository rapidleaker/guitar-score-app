(() => {
  'use strict';

  const STORAGE_KEY = 'guitar-score-app-v1';
  const MAX_HISTORY = 100;
  const $ = (selector) => document.querySelector(selector);

  const els = {
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

  let song = loadSong();
  let mode = 'lyrics';
  let selectedChordId = null;
  let inlineInput = null;
  let dragState = null;
  let history = [];
  let historyIndex = -1;
  let saveTimer;
  let lyricsTimer;

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function createSong() {
    return {
      id: uid('song'), title: '', artist: '', lyrics: '', lines: [{ id: uid('line'), text: '' }],
      chords: [], sections: [], key: '', capo: 0
    };
  }

  function loadSong() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === 'object') {
        saved.chords ||= [];
        saved.sections ||= [];
        saved.lines ||= [{ id: uid('line'), text: '' }];
        return saved;
      }
    } catch (_) {}
    return createSong();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeLines(text, previousLines = song.lines) {
    const parts = String(text).split('\n');
    return parts.map((line, index) => ({
      id: previousLines[index]?.id || uid('line'),
      text: line
    }));
  }

  function syncLyrics(text, record = true) {
    const before = JSON.stringify(song);
    song.lyrics = String(text);
    song.lines = normalizeLines(song.lyrics, song.lines);
    const validIds = new Set(song.lines.map(line => line.id));
    song.chords = song.chords.filter(chord => validIds.has(chord.lineId));
    if (record && before !== JSON.stringify(song)) commit('歌詞を編集');
    renderAll();
  }

  function commit(label = '変更') {
    history = history.slice(0, historyIndex + 1);
    history.push({ song: clone(song), label });
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
    saveSong();
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    song = clone(history[historyIndex].song);
    selectedChordId = null;
    renderAll();
    saveSong();
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    song = clone(history[historyIndex].song);
    selectedChordId = null;
    renderAll();
    saveSong();
  }

  function saveSong() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(song));
      els.status.textContent = '自動保存しました';
      setTimeout(() => { els.status.textContent = ''; }, 1600);
    }, 150);
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
    if (index >= chars.length) {
      const last = chars[chars.length - 1];
      return last.offsetLeft + last.offsetWidth;
    }
    return chars[index].offsetLeft;
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
        if (event.target.closest('.chord')) return;
        if (dragState) return;
        selectedChordId = null;
        updateMobileControls();
        const rect = row.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const chars = [...row.querySelectorAll('.lyric-char')];
        let index = chars.findIndex(char => x < char.offsetLeft + char.offsetWidth / 2);
        if (index < 0) index = chars.length;
        showInlineInput(row, line.id, index, x);
      });
    }

    song.chords.filter(chord => chord.lineId === line.id).forEach(chord => {
      const chordEl = document.createElement('button');
      chordEl.type = 'button';
      chordEl.className = `chord${chord.id === selectedChordId ? ' selected' : ''}`;
      chordEl.textContent = chord.name;
      chordEl.dataset.chordId = chord.id;
      const x = getCharX(row, chord.charIndex);
      chordEl.style.left = `${x + (chord.offset || 0)}px`;
      chordEl.style.transform = 'translateX(-50%)';
      chordEl.addEventListener('click', event => {
        event.stopPropagation();
        selectChord(chord.id);
      });
      chordEl.addEventListener('pointerdown', startDrag, { passive: false });
      row.appendChild(chordEl);
    });
    return row;
  }

  function renderEditor() {
    els.score.replaceChildren();
    song.lines.forEach(line => els.score.appendChild(renderLine(line, true)));
  }

  function renderPreview() {
    els.previewSheet.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = song.title || '無題';
    const artist = document.createElement('p');
    artist.className = 'artist';
    artist.textContent = [song.artist, song.key ? `Key: ${song.key}` : '', Number(song.capo) ? `Capo: ${song.capo}` : ''].filter(Boolean).join(' / ');
    els.previewSheet.append(title, artist);
    const score = document.createElement('div');
    score.className = 'score';
    song.lines.forEach(line => score.appendChild(renderLine(line, false)));
    els.previewSheet.appendChild(score);
  }

  function renderAll() {
    els.title.value = song.title;
    els.artist.value = song.artist;
    els.key.value = song.key;
    els.capo.value = song.capo;
    if (els.lyrics.value !== song.lyrics) els.lyrics.value = song.lyrics;
    renderEditor();
    renderPreview();
    updateMode();
    updateMobileControls();
  }

  function switchMode(next) {
    mode = next;
    closeInlineInput();
    updateMode();
    if (next === 'chords') requestAnimationFrame(renderEditor);
    if (next === 'preview') requestAnimationFrame(renderPreview);
  }

  function updateMode() {
    els.lyricsEditor.classList.toggle('hidden', mode !== 'lyrics');
    els.chordsEditor.classList.toggle('hidden', mode !== 'chords');
    els.preview.classList.toggle('hidden', mode !== 'preview');
    Object.entries(els.modes).forEach(([name, button]) => button.classList.toggle('active', name === mode));
  }

  function showInlineInput(row, lineId, charIndex, x) {
    closeInlineInput();
    inlineInput = document.createElement('input');
    inlineInput.className = 'inline-chord-input';
    inlineInput.placeholder = 'コード';
    inlineInput.style.left = `${x}px`;
    row.appendChild(inlineInput);
    inlineInput.focus();
    const finish = () => {
      const name = inlineInput.value.trim();
      if (name) {
        song.chords.push({ id: uid('chord'), name, lineId, charIndex, offset: 0 });
        commit('コード追加');
      }
      closeInlineInput();
      selectedChordId = null;
      renderAll();
    };
    inlineInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') finish();
      if (event.key === 'Escape') closeInlineInput();
    });
    inlineInput.addEventListener('blur', () => setTimeout(finish, 80));
  }

  function closeInlineInput() {
    inlineInput?.remove();
    inlineInput = null;
  }

  function selectChord(id) {
    selectedChordId = id;
    updateMobileControls();
    renderEditor();
  }

  function selectedChord() {
    return song.chords.find(chord => chord.id === selectedChordId);
  }

  function updateMobileControls() {
    const chord = selectedChord();
    els.mobileControls.classList.toggle('hidden', mode !== 'chords' || !chord);
    if (chord) els.selectedChordName.value = chord.name;
  }

  function deleteSelected() {
    if (!selectedChord()) return;
    song.chords = song.chords.filter(chord => chord.id !== selectedChordId);
    selectedChordId = null;
    commit('コード削除');
    renderAll();
  }

  function nudge(amount) {
    const chord = selectedChord();
    if (!chord) return;
    chord.offset = (chord.offset || 0) + amount;
    commit('コード移動');
    renderAll();
    selectChord(chord.id);
  }

  function startDrag(event) {
    if (mode !== 'chords') return;
    event.preventDefault();
    event.stopPropagation();

    const chordEl = event.currentTarget;
    const id = chordEl.dataset.chordId;
    const chord = song.chords.find(item => item.id === id);
    if (!chord) return;

    selectedChordId = id;
    updateMobileControls();
    chordEl.classList.add('selected');
    dragState = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      original: chord.offset || 0,
      moved: false,
      chordEl
    };

    chordEl.setPointerCapture?.(event.pointerId);
    document.addEventListener('pointermove', moveDrag, { passive: false });
    document.addEventListener('pointerup', endDrag, { once: true });
    document.addEventListener('pointercancel', endDrag, { once: true });
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    event.preventDefault();

    const chord = song.chords.find(item => item.id === dragState.id);
    if (!chord) return;

    const delta = event.clientX - dragState.startX;
    if (Math.abs(delta) > 3) dragState.moved = true;
    chord.offset = dragState.original + delta;

    const row = dragState.chordEl.closest('.score-line');
    const x = getCharX(row, chord.charIndex);
    dragState.chordEl.style.left = `${x + chord.offset}px`;
  }

  function endDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const finished = dragState;
    document.removeEventListener('pointermove', moveDrag);
    document.removeEventListener('pointercancel', endDrag);

    if (finished.moved) {
      commit('コード移動');
    }
    dragState = null;
    renderAll();
    selectChord(finished.id);
  }

  function updateMeta() {
    song.title = els.title.value;
    song.artist = els.artist.value;
    song.key = els.key.value;
    song.capo = Math.max(0, Number(els.capo.value) || 0);
    commit('曲情報を編集');
  }

  els.lyrics.addEventListener('input', () => {
    clearTimeout(lyricsTimer);
    lyricsTimer = setTimeout(() => syncLyrics(els.lyrics.value), 250);
  });
  [els.title, els.artist, els.key, els.capo].forEach(input => input.addEventListener('change', updateMeta));
  els.modes.lyrics.addEventListener('click', () => switchMode('lyrics'));
  els.modes.chords.addEventListener('click', () => switchMode('chords'));
  els.modes.preview.addEventListener('click', () => switchMode('preview'));
  els.undo.addEventListener('click', undo);
  els.redo.addEventListener('click', redo);
  els.print.addEventListener('click', () => window.print());
  $('#deleteChordBtn').addEventListener('click', deleteSelected);
  $('#nudgeLeftBtn').addEventListener('click', () => nudge(-1));
  $('#nudgeRightBtn').addEventListener('click', () => nudge(1));
  els.selectedChordName.addEventListener('change', () => {
    const chord = selectedChord();
    if (!chord) return;
    const name = els.selectedChordName.value.trim();
    if (name) { chord.name = name; commit('コード名変更'); renderAll(); selectChord(chord.id); }
  });

  document.addEventListener('keydown', event => {
    if (mode !== 'chords' || !selectedChord() || event.target.matches('input, textarea')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); nudge(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); nudge(1); }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
    if (event.key === 'Escape') { selectedChordId = null; updateMobileControls(); renderEditor(); }
  });

  history.push({ song: clone(song), label: '初期状態' });
  historyIndex = 0;
  renderAll();
})();
