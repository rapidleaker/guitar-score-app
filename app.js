(() => {
  'use strict';

  const STORAGE_KEY = 'guitar-score-app-v1';
  const MAX_HISTORY = 100;
  const DRAG_THRESHOLD = 5;
  const DUPLICATE_OFFSET = 20;
  const DOUBLE_TAP_DELAY = 400;
  const DEFAULTS = { lyricFontSize: 13, chordFontSize: 13, lyricFontFamily: 'sans-serif', chordFontFamily: 'monospace' };
  const $ = selector => document.querySelector(selector);
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max, fallback) => { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; };
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const palettes = { basic: ['C','D','E','F','G','A','B'], flat: ['Db','Eb','Gb','Ab','Bb'], minor: ['Am','Bm','Cm','Dm','Em','Fm','Gm'], seventh: ['C7','D7','E7','F7','G7','A7','B7'], other: ['Cmaj7','Dmaj7','Fmaj7','Gmaj7','Am7','Dm7','Em7','Asus4','Dsus4','Esus4','Cadd9','Dadd9','Gadd9','C/G','D/F#','Am/C','Db/F','Eb/G','Bb/D'] };
  const SHARP_NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const FLAT_NOTES = {'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb'};
  const NOTE_INDEX = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
  const els = {
    home: $('#homeScreen'), editor: $('#editorScreen'), songList: $('#songList'), songCount: $('#songCount'), empty: $('#emptyMessage'), newSong: $('#newSongBtn'), homeBtn: $('#homeBtn'), title: $('#titleInput'), artist: $('#artistInput'), key: $('#keyInput'), capo: $('#capoInput'), lyrics: $('#lyricsInput'), score: $('#scoreEditor'), preview: $('#preview'), previewSheet: $('#previewSheet'), addPageBreak: $('#addPageBreakBtn'), previewBreakHint: $('#previewBreakHint'), lyricsEditor: $('#lyricsEditor'), chordsEditor: $('#chordsEditor'), chordTools: $('#chordTools'), palette: $('#chordPalette'), paletteTabs: [...document.querySelectorAll('.palette-tab')], clearPalette: $('#clearPaletteBtn'), closePalette: $('#closePaletteBtn'), paletteBackdrop: $('#paletteBackdrop'), mobile: $('#mobileControls'), addChord: $('#addChordBtn'), selectedName: $('#selectedChordName'), delete: $('#deleteChordBtn'), duplicate: $('#duplicateChordBtn'), left: $('#nudgeLeftBtn'), right: $('#nudgeRightBtn'), copy: $('#copyChordBtn'), paste: $('#pasteChordBtn'), transposeDown: $('#transposeDownBtn'), transposeUp: $('#transposeUpBtn'), transposeValue: $('#transposeValue'), resetTranspose: $('#resetTransposeBtn'), undo: $('#undoBtn'), redo: $('#redoBtn'), pageBreak: $('#pageBreakBtn'), print: $('#printBtn'), status: $('#status'), lyricSize: $('#lyricFontSizeInput'), chordSize: $('#chordFontSizeInput'), lyricSizeValue: $('#lyricFontSizeValue'), chordSizeValue: $('#chordFontSizeValue'), lyricFamily: $('#lyricFontFamilyInput'), chordFamily: $('#chordFontFamilyInput'), resetSize: $('#resetFontSizeBtn'), modes: { lyrics: $('#lyricsMode'), chords: $('#chordsMode'), preview: $('#previewMode') }
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
  let lastChordTap = null;
  let suppressChordActivation = false;
  let currentScoreLineId = null;
  let previewBreakDrag = null;
  let previewBreakAddMode = false;

  function normalizeAccidental(value) { return String(value || '').replace('♯','#').replace('♭','b'); }
  function getNoteIndex(note) { const value = normalizeAccidental(note); return Object.prototype.hasOwnProperty.call(NOTE_INDEX, value) ? NOTE_INDEX[value] : null; }
  function createUniqueLineId(ids) { let id = uid('line'); while (ids.has(id)) id = uid('line'); ids.add(id); return id; }
 function reconcileLines(previousLines, text) {
  const old = Array.isArray(previousLines) ? previousLines : [];
  const next = String(text).split('\n');
  const ids = new Set();

  if (!old.length) {
    return next.map(value => ({
      id: createUniqueLineId(ids),
      text: value
    }));
  }

  const oldText = old.map(line => String(line.text ?? '')).join('\n');
  const newText = next.join('\n');

  let prefix = 0;

  while (
    prefix < oldText.length &&
    prefix < newText.length &&
    oldText[prefix] === newText[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;

  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - 1 - suffix] ===
      newText[newText.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldPrefixLine = oldText.slice(0, prefix).split('\n').length - 1;
  const newPrefixLine = newText.slice(0, prefix).split('\n').length - 1;

  const oldSuffixStart = oldText.length - suffix;
  const newSuffixStart = newText.length - suffix;

  const oldSuffixLine = oldText.slice(0, oldSuffixStart).split('\n').length - 1;
  const newSuffixLine = newText.slice(0, newSuffixStart).split('\n').length - 1;

  const result = next.map((value, index) => ({
    id: null,
    text: value,
    index
  }));

  // 編集範囲より前の行は、位置に基づいてIDを維持する
  for (
    let index = 0;
    index < newPrefixLine &&
    index < old.length &&
    index < result.length;
    index += 1
  ) {
    result[index].id = old[index].id;
    ids.add(result[index].id);
  }

  // 編集範囲内で、行数が変わらない場合は対応する行のIDを維持する
  const oldChangedCount = oldSuffixLine - oldPrefixLine + 1;
  const newChangedCount = newSuffixLine - newPrefixLine + 1;

  if (oldChangedCount === newChangedCount) {
    for (let offset = 0; offset < newChangedCount; offset += 1) {
      const newIndex = newPrefixLine + offset;
      const oldIndex = oldPrefixLine + offset;

      if (
        newIndex >= 0 &&
        newIndex < result.length &&
        oldIndex >= 0 &&
        oldIndex < old.length &&
        !ids.has(old[oldIndex].id)
      ) {
        result[newIndex].id = old[oldIndex].id;
        ids.add(result[newIndex].id);
      }
    }
  }

  // 編集範囲より後ろの行は、共通末尾の位置から対応付ける
  const oldSuffixCount = old.length - oldSuffixLine - 1;
  const newSuffixCount = next.length - newSuffixLine - 1;
  const suffixCount = Math.min(oldSuffixCount, newSuffixCount);

  for (let offset = 0; offset < suffixCount; offset += 1) {
    const oldIndex = old.length - suffixCount + offset;
    const newIndex = next.length - suffixCount + offset;
    const oldId = old[oldIndex]?.id;

    if (
      oldId &&
      newIndex >= 0 &&
      newIndex < result.length &&
      !ids.has(oldId)
    ) {
      result[newIndex].id = oldId;
      ids.add(oldId);
    }
  }

  return result.map(line => ({
    id: line.id || createUniqueLineId(ids),
    text: line.text
  }));
}
  function normalizeSong(target) {
    if (!target || typeof target !== 'object') return null;
    target.id = target.id || uid('song'); target.title = String(target.title || ''); target.artist = String(target.artist || ''); target.key = String(target.key || '');
    target.lyrics = String(target.lyrics ?? (Array.isArray(target.lines) ? target.lines.map(line => String(line?.text || '')).join('\n') : ''));
    target.capo = clamp(target.capo, 0, 12, 0); target.transpose = clamp(target.transpose, -12, 12, 0); target.updatedAt = Number(target.updatedAt) || Date.now();
    const oldLines = Array.isArray(target.lines) ? target.lines : []; const ids = new Set();
    target.lines = target.lyrics.split('\n').map((text, index) => { const oldId = oldLines[index]?.id; if (oldId && !ids.has(oldId)) { ids.add(oldId); return { id: oldId, text }; } return { id: createUniqueLineId(ids), text }; });
    if (!target.lines.length) target.lines.push({ id: createUniqueLineId(ids), text: '' });
    const valid = new Set(target.lines.map(line => line.id));
    const validBreaks = new Set(target.lines.slice(0, -1).map(line => line.id));
    target.pageBreakAfter = Array.isArray(target.pageBreakAfter) ? [...new Set(target.pageBreakAfter.filter(id => validBreaks.has(id)))] : [];
    target.chords = Array.isArray(target.chords) ? target.chords.map(chord => {
      if (!chord || !valid.has(chord.lineId)) return null;
      const line = target.lines.find(item => item.id === chord.lineId); const max = [...(line?.text || '')].length;
      const offset = Number(chord.offset);
      return { id: chord.id || uid('chord'), name: String(chord.name || '').trim(), lineId: chord.lineId, charIndex: clamp(chord.charIndex, 0, max, 0), offset: Number.isFinite(offset) ? offset : 0 };
    }).filter(chord => chord && chord.name) : [];
    target.lyricFontSize = clamp(target.lyricFontSize, 12, 32, DEFAULTS.lyricFontSize); target.chordFontSize = clamp(target.chordFontSize, 12, 32, DEFAULTS.chordFontSize);
    target.lyricFontFamily = typeof target.lyricFontFamily === 'string' && target.lyricFontFamily.trim() ? target.lyricFontFamily.trim() : DEFAULTS.lyricFontFamily;
    target.chordFontFamily = typeof target.chordFontFamily === 'string' && target.chordFontFamily.trim() ? target.chordFontFamily.trim() : DEFAULTS.chordFontFamily;
    return target;
  }
  function loadStore() {
    const empty = { version: 2, songs: [], currentSongId: null };
    try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return empty; const saved = JSON.parse(raw); if (Array.isArray(saved.songs)) return { version: 2, songs: saved.songs.map(normalizeSong).filter(Boolean), currentSongId: saved.currentSongId || null }; const one = normalizeSong(saved); return { version: 2, songs: one ? [one] : [], currentSongId: one?.id || null }; } catch { return empty; }
  }
  function persist() { if (song) store.currentSongId = song.id; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { if (els.status) els.status.textContent = '保存できませんでした'; } }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (!song) return; song.updatedAt = Date.now(); const index = store.songs.findIndex(item => item.id === song.id); if (index >= 0) store.songs[index] = clone(song); persist(); }, 150); }
  function commit(label) { if (!song) return; song.updatedAt = Date.now(); history = history.slice(0, historyIndex + 1); history.push({ song: clone(song), label }); if (history.length > MAX_HISTORY) history.shift(); historyIndex = history.length - 1; updateHistoryButtons(); save(); }
  function resetHistory() { history = [{ song: clone(song), label: '初期状態' }]; historyIndex = 0; updateHistoryButtons(); }
  function updateHistoryButtons() { if (els.undo) els.undo.disabled = historyIndex <= 0; if (els.redo) els.redo.disabled = historyIndex >= history.length - 1; }
  function replaceCurrentSong() { if (!song) return; const index = store.songs.findIndex(item => item.id === song.id); if (index >= 0) store.songs[index] = clone(song); persist(); }
  function getChord(id = selectedChordId) { return song?.chords.find(chord => chord.id === id); }
  function getSelectedChord() { return getChord(selectedChordId); }
  function getLyricsCaretLineId() { if (!song || !els.lyrics) return null; const position = Number(els.lyrics.selectionStart) || 0; const index = els.lyrics.value.slice(0, position).split('\n').length - 1; return song.lines[index]?.id || null; }
  
  function renderChars(text) { const fragment = document.createDocumentFragment(); [...text].forEach((character, index) => { const span = document.createElement('span'); span.className = 'lyric-char'; span.dataset.index = index; span.textContent = character === ' ' ? '\u00a0' : character; fragment.appendChild(span); }); return fragment; }
  function getCharX(row, index) { const chars = [...row.querySelectorAll('.lyric-char')]; if (!chars.length) return 0; const rect = row.getBoundingClientRect(); const target = chars.find(item => Number(item.dataset.index) === index); return target ? target.getBoundingClientRect().left - rect.left : chars[chars.length - 1].getBoundingClientRect().right - rect.left; }
  function getCharIndexAtX(row, x) { const chars = [...row.querySelectorAll('.lyric-char')]; if (!chars.length) return 0; const index = chars.findIndex(item => x < item.getBoundingClientRect().left + item.getBoundingClientRect().width / 2); return index < 0 ? chars.length : index; }
  function getPreviewBreakZone(afterLineId) {
    return [...(els.previewSheet?.querySelectorAll('.preview-break-zone') || [])]
      .find(zone => zone.dataset.afterLineId === afterLineId) || null;
  }

  function getPreviewBreakLineIdAtY(clientY) {
    const zones = [...(els.previewSheet?.querySelectorAll('.preview-break-zone') || [])];
    if (!zones.length) return null;
    const zone = zones.reduce((nearest, item) => {
      const rect = item.getBoundingClientRect();
      const nearestRect = nearest.getBoundingClientRect();
      const distance = Math.abs(clientY - (rect.top + rect.height / 2));
      const nearestDistance = Math.abs(clientY - (nearestRect.top + nearestRect.height / 2));
      return distance < nearestDistance ? item : nearest;
    });
    return zone.dataset.afterLineId || null;
  }

  function updatePreviewBreakTarget(clientY) {
    els.previewSheet?.querySelectorAll('.preview-break-zone.is-drop-target').forEach(zone => zone.classList.remove('is-drop-target'));
    const lineId = getPreviewBreakLineIdAtY(clientY);
    getPreviewBreakZone(lineId)?.classList.add('is-drop-target');
    return lineId;
  }

  function setPreviewBreakAddMode(enabled) {
    previewBreakAddMode = Boolean(enabled);
    els.preview?.classList.toggle('adding-page-break', previewBreakAddMode);
    els.previewSheet?.querySelectorAll('.preview-break-zone').forEach(zone => {
      zone.classList.toggle('add-target', previewBreakAddMode);
    });
    if (els.addPageBreak) {
      els.addPageBreak.textContent = previewBreakAddMode
        ? '改ページ追加をキャンセル'
        : '＋ 改ページを追加';
      els.addPageBreak.setAttribute('aria-pressed', String(previewBreakAddMode));
    }
    if (els.previewBreakHint) {
      els.previewBreakHint.textContent = previewBreakAddMode
        ? '改ページを入れる行間を選択してください'
        : '追加ボタンを押してから、行間を選択してください';
    }
  }

  function togglePreviewBreak(lineId) {
    if (!song) return;
    const index = song.lines.findIndex(line => line.id === lineId);
    if (index < 0 || index >= song.lines.length - 1) return;
    const breaks = Array.isArray(song.pageBreakAfter) ? [...song.pageBreakAfter] : [];
    const existing = breaks.indexOf(lineId);
    if (existing >= 0) {
      breaks.splice(existing, 1);
      song.pageBreakAfter = breaks;
      commit('改ページ解除');
      els.status.textContent = '改ページを解除しました';
    } else {
      breaks.push(lineId);
      song.pageBreakAfter = breaks;
      commit('改ページ設定');
      els.status.textContent = '改ページを設定しました';
    }
    setPreviewBreakAddMode(false);
    renderAll();
  }

  function createPreviewBreakZone(lineId) {
    const zone = document.createElement('div');
    zone.className = 'preview-break-zone';
    zone.dataset.afterLineId = lineId;
    zone.tabIndex = 0;
    zone.setAttribute('role', 'button');
    zone.setAttribute('aria-label', 'この位置に改ページを設定または解除');
    if (song.pageBreakAfter.includes(lineId)) zone.classList.add('active');

    zone.addEventListener('pointerdown', event => {
      if (!song.pageBreakAfter.includes(lineId)) return;
      event.preventDefault();
      event.stopPropagation();
      previewBreakDrag = {
        pointerId: event.pointerId,
        sourceLineId: lineId,
        startY: event.clientY
      };
      zone.setPointerCapture?.(event.pointerId);
    }, { passive: false });

    zone.addEventListener('pointerup', event => {
      event.preventDefault();
      event.stopPropagation();
      if (previewBreakDrag) {
        finishPreviewBreakDrag(event);
        return;
      }
      if (previewBreakAddMode) {
        togglePreviewBreak(lineId);
      }
    }, { passive: false });

    zone.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (previewBreakAddMode) togglePreviewBreak(lineId);
      }
    });
    return zone;
  }
  function movePreviewBreakDrag(event) {
  if (!previewBreakDrag) return;
  if (event.pointerId !== previewBreakDrag.pointerId) return;

  const distance = Math.abs(event.clientY - previewBreakDrag.startY);

  if (distance < DRAG_THRESHOLD) return;

  event.preventDefault();
  updatePreviewBreakTarget(event.clientY);
}

  function finishPreviewBreakDrag(event) {
    if (!previewBreakDrag) return;
    if (event && event.pointerId !== previewBreakDrag.pointerId) return;
    const drag = previewBreakDrag;
    const clientY = event?.clientY ?? drag.startY;
    const targetLineId = updatePreviewBreakTarget(clientY);
    const moved = Math.abs(clientY - drag.startY) >= DRAG_THRESHOLD;
    previewBreakDrag = null;
    els.previewSheet?.querySelectorAll('.preview-break-zone.is-drop-target').forEach(zone => zone.classList.remove('is-drop-target'));

    if (!song) return;
    const breaks = Array.isArray(song.pageBreakAfter)
      ? song.pageBreakAfter.filter(id => id !== drag.sourceLineId)
      : [];

    if (moved && targetLineId && targetLineId !== drag.sourceLineId) {
      if (!breaks.includes(targetLineId)) breaks.push(targetLineId);
      song.pageBreakAfter = breaks;
      commit('プレビューで改ページ移動');
      els.status.textContent = '改ページ位置を変更しました';
    } else if (!moved) {
      song.pageBreakAfter = breaks;
      commit('改ページ解除');
      els.status.textContent = '改ページを解除しました';
    }
    renderAll();
  }

  function createRow(line, editable) { const row = document.createElement('div'); row.className = editable ? 'score-line' : 'preview-line'; row.dataset.lineId = line.id; if (editable && song.pageBreakAfter.includes(line.id)) row.classList.add('page-break-after'); const lyric = document.createElement('span'); lyric.className = 'lyric-text'; lyric.appendChild(renderChars(line.text)); row.appendChild(lyric); if (editable) { row.addEventListener('pointerdown', () => { currentScoreLineId = line.id;  }, { passive: true }); row.addEventListener('pointerup', event => { currentScoreLineId = line.id;  if (event.target.closest('.chord,.inline-chord-input') || dragState) return; const rect = row.getBoundingClientRect(); const x = event.clientX - rect.left; const index = getCharIndexAtX(row, event.clientX); if (selectedPaletteChord) { addChord(line.id, index, x, selectedPaletteChord); selectedPaletteChord = null; renderPalette(); closeMobilePalette(); return; } clearSelectedChord(); showInlineInput(row, line.id, index, x); }); } return row; }
  function addChord(lineId, charIndex, clickX, name) { const row = [...els.score.querySelectorAll('.score-line')].find(item => item.dataset.lineId === lineId); if (!row) return; const chord = { id: uid('chord'), name: String(name).trim(), lineId, charIndex, offset: Math.max(0, clickX) - getCharX(row, charIndex) }; if (!chord.name) return; song.chords.push(chord); selectedChordId = chord.id; currentScoreLineId = lineId; commit('コード追加'); renderAll(); }
  function renderChordsOnRow(row, lineId, editable) { song.chords.filter(chord => chord.lineId === lineId).forEach(chord => { const button = document.createElement('button'); button.type = 'button'; button.className = `chord${chord.id === selectedChordId ? ' selected' : ''}`; button.textContent = chord.name; button.dataset.chordId = chord.id; button.style.left = `${getCharX(row, chord.charIndex) + chord.offset}px`; if (!editable) { button.disabled = true; button.style.pointerEvents = 'none'; row.appendChild(button); return; } button.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); startDrag(event); }, { passive: false }); button.addEventListener('pointermove', moveDrag, { passive: false }); button.addEventListener('pointerup', event => { event.preventDefault(); event.stopPropagation(); }, { passive: false }); button.addEventListener('pointercancel', event => { event.preventDefault(); event.stopPropagation(); endDrag(event); }, { passive: false }); row.appendChild(button); }); }
  function renderEditor() { els.score.replaceChildren(); song.lines.forEach(line => { const row = createRow(line, true); els.score.appendChild(row); renderChordsOnRow(row, line.id, true); }); }
  function renderPreview() {
    els.previewSheet.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = song.title || '無題';
    const artist = document.createElement('p');
    artist.className = 'artist';
    artist.textContent = [song.artist, song.key ? `Key: ${song.key}` : 'Key: 未設定', `Capo: ${song.capo}`].filter(Boolean).join(' / ');
    const score = document.createElement('div');
    score.className = 'score preview-score';
    els.previewSheet.append(title, artist, score);
    song.lines.forEach((line, index) => {
  const row = createRow(line, false);

  if (song.pageBreakAfter.includes(line.id)) {
    row.classList.add('page-break-after');
  }

  score.appendChild(row);
  renderChordsOnRow(row, line.id, false);

  if (index < song.lines.length - 1) {
    score.appendChild(createPreviewBreakZone(line.id));
  }
});
  }
  function renderFonts() { const root = document.documentElement; root.style.setProperty('--lyric-font-size', `${song.lyricFontSize}px`); root.style.setProperty('--chord-font-size', `${song.chordFontSize}px`); root.style.setProperty('--lyric-font-family', song.lyricFontFamily); root.style.setProperty('--chord-font-family', song.chordFontFamily); els.lyricSize.value = song.lyricFontSize; els.chordSize.value = song.chordFontSize; els.lyricSizeValue.textContent = song.lyricFontSize; els.chordSizeValue.textContent = song.chordFontSize; els.lyricFamily.value = song.lyricFontFamily; els.chordFamily.value = song.chordFontFamily; }
  function renderTransposeValue() { const value = Number(song?.transpose) || 0; els.transposeValue.textContent = value > 0 ? `+${value}` : String(value); }
  function renderAll() { if (!song) return; normalizeSong(song); els.title.value = song.title; els.artist.value = song.artist; els.key.value = song.key; els.capo.value = song.capo; if (els.lyrics.value !== song.lyrics) els.lyrics.value = song.lyrics; renderFonts(); renderEditor(); renderPreview(); renderPalette(); renderTransposeValue(); updateMode(); updateMobileControls();  }
  function updateMode() { els.lyricsEditor.classList.toggle('hidden', mode !== 'lyrics'); els.chordsEditor.classList.toggle('hidden', mode !== 'chords'); els.preview.classList.toggle('hidden', mode !== 'preview'); Object.entries(els.modes).forEach(([name, button]) => button.classList.toggle('active', name === mode)); updateMobileControls(); }
  function switchMode(next) { closeInlineInput(); if (next !== 'preview') setPreviewBreakAddMode(false); mode = next; if (mode !== 'chords') closeMobilePalette(); updateMode(); if (mode === 'chords') renderEditor(); if (mode === 'preview') renderPreview();  }
  function closeInlineInput() { inlineInput?.remove(); inlineInput = null; }
  function showInlineInput(row, lineId, charIndex, clickX) { closeInlineInput(); const input = document.createElement('input'); inlineInput = input; input.className = 'inline-chord-input'; input.type = 'text'; input.placeholder = 'コード'; input.autocomplete = 'off'; input.style.left = `${Math.max(0, clickX)}px`; row.appendChild(input); input.focus(); let done = false; const finish = () => { if (done) return; done = true; const name = input.value.trim(); if (name) { song.chords.push({ id: uid('chord'), name, lineId, charIndex, offset: Math.max(0, clickX) - getCharX(row, charIndex) }); selectedChordId = song.chords.at(-1).id; currentScoreLineId = lineId; commit('コード追加'); } closeInlineInput(); renderAll(); }; input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finish(); } if (event.key === 'Escape') { event.preventDefault(); done = true; closeInlineInput(); } }); input.addEventListener('blur', finish); }
  function showExistingChordInput(row, element, chord) { closeInlineInput(); selectedChordId = chord.id; currentScoreLineId = chord.lineId; const input = document.createElement('input'); inlineInput = input; input.className = 'inline-chord-input'; input.type = 'text'; input.value = chord.name; input.autocomplete = 'off'; const rr = row.getBoundingClientRect(); const cr = element.getBoundingClientRect(); input.style.left = `${cr.left + cr.width / 2 - rr.left}px`; row.appendChild(input); input.focus(); input.select(); let done = false; const finish = () => { if (done) return; done = true; const name = input.value.trim(); if (name && name !== chord.name) { chord.name = name; commit('コード名変更'); } closeInlineInput(); renderAll(); }; input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finish(); } if (event.key === 'Escape') { event.preventDefault(); done = true; closeInlineInput(); } }); input.addEventListener('blur', finish); }
  function handleChordTap(chord, row, button) { const now = Date.now(); const doubleTap = lastChordTap && lastChordTap.id === chord.id && now - lastChordTap.time <= DOUBLE_TAP_DELAY; if (doubleTap) { lastChordTap = null; showExistingChordInput(row, button, chord); return; } lastChordTap = { id: chord.id, time: now }; selectChord(chord.id); setTimeout(() => { if (lastChordTap?.id === chord.id && Date.now() - lastChordTap.time > DOUBLE_TAP_DELAY) lastChordTap = null; }, DOUBLE_TAP_DELAY + 50); }
  function selectChord(id) { const chord = getChord(id); if (!chord) { clearSelectedChord(); return; } closeInlineInput(); selectedChordId = chord.id; currentScoreLineId = chord.lineId; els.score?.querySelectorAll('.chord.selected').forEach(element => element.classList.remove('selected')); const selected = [...(els.score?.querySelectorAll('.chord') || [])].find(element => element.dataset.chordId === chord.id); selected?.classList.add('selected'); updateMobileControls();  }
  function clearSelectedChord() { selectedChordId = null; currentScoreLineId = null; lastChordTap = null; els.score?.querySelectorAll('.chord.selected').forEach(element => element.classList.remove('selected')); updateMobileControls();  }
  function updateMobileControls() { if (!els.mobile) return; const chord = getSelectedChord(); els.mobile.classList.toggle('hidden', mode !== 'chords'); [els.delete,els.duplicate,els.left,els.right,els.copy,els.paste].forEach(button => { if (button) button.disabled = !chord; }); if (els.selectedName) { els.selectedName.disabled = !chord; els.selectedName.value = chord ? chord.name : ''; } }
  function openMobilePalette() { if (mode !== 'chords') switchMode('chords'); els.chordTools.classList.add('mobile-palette-open'); els.paletteBackdrop.classList.remove('hidden'); els.status.textContent = 'パレットからコードを選択してください'; }
  function closeMobilePalette() { els.chordTools.classList.remove('mobile-palette-open'); els.paletteBackdrop.classList.add('hidden'); }
  async function copySelectedChord() { const chord = getSelectedChord(); if (!chord) return; try { await navigator.clipboard.writeText(chord.name); els.status.textContent = `コード「${chord.name}」をコピーしました`; } catch { els.status.textContent = 'コピーできませんでした'; } }
  async function pasteChord() { const source = getSelectedChord(); if (!source) { els.status.textContent = '貼り付ける位置のコードを先に選択してください'; return; } try { const name = (await navigator.clipboard.readText()).trim(); if (!name) return; const pasted = { id: uid('chord'), name, lineId: source.lineId, charIndex: source.charIndex, offset: Number(source.offset || 0) + DUPLICATE_OFFSET }; song.chords.push(pasted); selectedChordId = pasted.id; currentScoreLineId = pasted.lineId; commit('コード貼り付け'); renderAll(); } catch { els.status.textContent = '貼り付けできませんでした'; } }
  function duplicateSelectedChord() { const source = getSelectedChord(); if (!source) return; const copied = clone(source); copied.id = uid('chord'); copied.offset = Number(copied.offset || 0) + DUPLICATE_OFFSET; song.chords.push(copied); selectedChordId = copied.id; currentScoreLineId = copied.lineId; commit('コード複製'); renderAll(); }
  function deleteSelectedChord() { const chord = getSelectedChord(); if (!chord) return; song.chords = song.chords.filter(item => item.id !== chord.id); clearSelectedChord(); commit('コード削除'); renderAll(); }
  function nudge(amount) { const chord = getSelectedChord(); if (!chord) return; chord.offset = Number(chord.offset || 0) + amount; commit('コード位置調整'); renderAll(); }
  function getTargetRow(y) { const rows = [...els.score.querySelectorAll('.score-line')]; if (!rows.length) return null; return rows.reduce((nearest, row) => Math.abs(y - (row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2)) < Math.abs(y - (nearest.getBoundingClientRect().top + nearest.getBoundingClientRect().height / 2)) ? row : nearest); }
  function startDrag(event) { if (mode !== 'chords' || dragState) return; const element = event.currentTarget; const chord = getChord(element.dataset.chordId); const row = element.closest('.score-line'); if (!chord || !row) return; event.preventDefault(); event.stopPropagation(); const rect = element.getBoundingClientRect(); selectedChordId = chord.id; currentScoreLineId = chord.lineId; dragState = { id: chord.id, pointerId: event.pointerId, element, currentRow: row, startX: event.clientX, startY: event.clientY, grabDelta: event.clientX - (rect.left + rect.width / 2), moved: false }; element.setPointerCapture?.(event.pointerId); updateMobileControls();  }
  function moveDrag(event) { if (!dragState || event.pointerId !== dragState.pointerId) return; const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY); if (!dragState.moved && distance < DRAG_THRESHOLD) return; event.preventDefault(); const chord = getChord(dragState.id); const target = getTargetRow(event.clientY); if (!chord || !target) return; dragState.moved = true; const rect = target.getBoundingClientRect(); const index = getCharIndexAtX(target, event.clientX); const base = getCharX(target, index); chord.lineId = target.dataset.lineId; chord.charIndex = index; chord.offset = event.clientX - rect.left - dragState.grabDelta - base; currentScoreLineId = chord.lineId; if (dragState.currentRow !== target) { target.appendChild(dragState.element); dragState.currentRow = target; } dragState.element.style.left = `${base + chord.offset}px`; }
  function endDrag(event) { if (!dragState || event && event.pointerId !== dragState.pointerId) return; const finished = dragState; const chord = getChord(finished.id); try { finished.element.releasePointerCapture?.(finished.pointerId); } catch {} dragState = null; if (!chord) return; selectedChordId = chord.id; if (finished.moved) { lastChordTap = null; suppressChordActivation = true; commit('コード移動'); renderAll(); setTimeout(() => { suppressChordActivation = false; }, 0); return; } if (suppressChordActivation) { suppressChordActivation = false; return; } handleChordTap(chord, finished.currentRow, finished.element); }
  function applyLyrics(text) { song.lyrics = String(text); song.lines = reconcileLines(song.lines, song.lyrics); const valid = new Set(song.lines.map(line => line.id)); song.chords = song.chords.filter(chord => valid.has(chord.lineId)).map(chord => { const line = song.lines.find(item => item.id === chord.lineId); return { ...chord, charIndex: clamp(chord.charIndex, 0, [...(line?.text || '')].length, 0) }; }); song.pageBreakAfter = song.pageBreakAfter.filter(id => valid.has(id) && song.lines.findIndex(line => line.id === id) < song.lines.length - 1); if (currentScoreLineId && !valid.has(currentScoreLineId)) currentScoreLineId = null; if (selectedChordId && !song.chords.some(chord => chord.id === selectedChordId)) selectedChordId = null; }
  function updateMeta() { const before = JSON.stringify({ title: song.title, artist: song.artist, key: song.key, capo: song.capo }); song.title = els.title.value; song.artist = els.artist.value; song.key = els.key.value; song.capo = clamp(els.capo.value, 0, 12, 0); if (before !== JSON.stringify({ title: song.title, artist: song.artist, key: song.key, capo: song.capo })) { commit('曲情報を編集'); renderHome(); } }
  function updateFontSize(type, value) { const size = clamp(value, 12, 32, DEFAULTS[type]); if (song[type] === size) return; song[type] = size; commit(type === 'lyricFontSize' ? '歌詞サイズ変更' : 'コードサイズ変更'); renderAll(); }
  function updateFontFamily(type, value) { const family = typeof value === 'string' && value.trim() ? value.trim() : DEFAULTS[type]; if (song[type] === family) return; song[type] = family; commit(type === 'lyricFontFamily' ? '歌詞フォント変更' : 'コードフォント変更'); renderAll(); }
  function resetFontSizes() { song.lyricFontSize = DEFAULTS.lyricFontSize; song.chordFontSize = DEFAULTS.chordFontSize; commit('文字サイズを標準に戻す'); renderAll(); }
  function parseChord(name) { const match = String(name).trim().match(/^([A-Ga-g])([#♯b♭]?)([^/]*?)(?:\/([A-Ga-g])([#♯b♭]?))?$/); if (!match) return null; const root = match[1].toUpperCase() + normalizeAccidental(match[2]); const bass = match[4] ? match[4].toUpperCase() + normalizeAccidental(match[5]) : null; return getNoteIndex(root) === null || bass && getNoteIndex(bass) === null ? null : { root, suffix: match[3] || '', bass }; }
  function transposeNote(note, amount) { const index = getNoteIndex(note); if (index === null) return note; const result = SHARP_NOTES[(index + amount + 120) % 12]; return String(note).includes('b') ? FLAT_NOTES[result] || result : result; }
  function transposeChordName(name, amount) { const chord = parseChord(name); if (!chord) return name; return `${transposeNote(chord.root, amount)}${chord.suffix}${chord.bass ? `/${transposeNote(chord.bass, amount)}` : ''}`; }
  function transposeAll(amount) { if (!song || !amount) return; const current = Number(song.transpose) || 0; const next = Math.max(-12, Math.min(12, current + amount)); const delta = next - current; if (!delta) return; song.chords.forEach(chord => { chord.name = transposeChordName(chord.name, delta); }); song.transpose = next; commit(`一括移調 ${delta > 0 ? '+' : ''}${delta}`); renderAll(); }
  function renderPalette() { const active = els.paletteTabs.find(button => button.classList.contains('active')); els.palette.replaceChildren(); (palettes[active?.dataset.palette || 'basic'] || []).forEach(name => { const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.className = selectedPaletteChord === name ? 'selected' : ''; button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); selectedPaletteChord = name; renderPalette(); els.status.textContent = `「${name}」を選択中。歌詞上の位置をクリックしてください`; }); els.palette.appendChild(button); }); }
  function renderHome() { els.songList.replaceChildren(); els.songCount.textContent = `${store.songs.length}曲`; els.empty.classList.toggle('hidden', store.songs.length > 0); [...store.songs].sort((a,b) => b.updatedAt - a.updatedAt).forEach(item => { const card = document.createElement('article'); card.className = 'song-card'; const title = document.createElement('h3'); title.textContent = item.title || '無題'; const artist = document.createElement('p'); artist.textContent = item.artist || 'アーティスト未設定'; const meta = document.createElement('p'); meta.textContent = [item.key && `Key: ${item.key}`, Number(item.capo) && `Capo: ${item.capo}`].filter(Boolean).join(' / ') || '曲情報未設定'; const updated = document.createElement('p'); updated.textContent = `更新: ${new Date(item.updatedAt).toLocaleString('ja-JP')}`; const actions = document.createElement('div'); actions.className = 'song-card-actions'; const open = document.createElement('button'); open.type = 'button'; open.textContent = '開く'; const duplicate = document.createElement('button'); duplicate.type = 'button'; duplicate.textContent = '複製'; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '削除'; remove.className = 'delete-song'; open.onclick = () => openEditor(item.id); duplicate.onclick = () => duplicateSong(item.id); remove.onclick = () => deleteSong(item.id); actions.append(open, duplicate, remove); card.append(title, artist, meta, updated, actions); els.songList.appendChild(card); }); }
  function createSong() { return normalizeSong({ id: uid('song'), title: '', artist: '', key: '', capo: 0, transpose: 0, lyrics: '', lines: [{ id: uid('line'), text: '' }], chords: [], pageBreakAfter: [], ...DEFAULTS, updatedAt: Date.now() }); }
  function openEditor(id) { const target = store.songs.find(item => item.id === id); if (!target) return; song = normalizeSong(target); store.currentSongId = song.id; persist(); selectedChordId = null; selectedPaletteChord = null; currentScoreLineId = null; lastChordTap = null; mode = 'lyrics'; closeMobilePalette(); resetHistory(); els.home.classList.add('hidden'); els.editor.classList.remove('hidden'); renderAll(); }
  function showHome() { closeInlineInput(); if (dragState) endDrag(); closeMobilePalette(); persist(); els.editor.classList.add('hidden'); els.home.classList.remove('hidden'); renderHome(); }
  function duplicateSong(id) { const source = store.songs.find(item => item.id === id); if (!source) return; const copied = clone(source); const map = new Map(); copied.id = uid('song'); copied.title = `${source.title || '無題'} のコピー`; copied.updatedAt = Date.now(); copied.lines.forEach(line => { const old = line.id; line.id = uid('line'); map.set(old, line.id); }); copied.chords.forEach(chord => { chord.id = uid('chord'); chord.lineId = map.get(chord.lineId); }); copied.pageBreakAfter = copied.pageBreakAfter.map(id2 => map.get(id2)).filter(Boolean); store.songs.push(normalizeSong(copied)); persist(); renderHome(); }
  function deleteSong(id) { const target = store.songs.find(item => item.id === id); if (!target || !window.confirm(`「${target.title || '無題'}」を削除しますか？`)) return; store.songs = store.songs.filter(item => item.id !== id); if (store.currentSongId === id) store.currentSongId = null; if (song?.id === id) { song = null; els.editor.classList.add('hidden'); els.home.classList.remove('hidden'); } persist(); renderHome(); }
  function preparePrintLayout() { els.previewSheet.querySelectorAll('.preview-line').forEach(row => { row.style.transform = ''; row.style.transformOrigin = 'left top'; row.style.height = ''; const width = els.previewSheet.clientWidth; const content = row.scrollWidth; if (width && content > width) { const scale = width / content; row.style.transform = `scale(${scale})`; row.style.height = `${row.offsetHeight * scale}px`; } }); }
  function clearPrintLayout() { els.previewSheet.querySelectorAll('.preview-line').forEach(row => { row.style.transform = ''; row.style.transformOrigin = ''; row.style.height = ''; }); }

  if (els.addPageBreak) {
    els.addPageBreak.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      if (mode !== 'preview') {
        mode = 'preview';
        updateMode();
        renderPreview();
      }
      setPreviewBreakAddMode(!previewBreakAddMode);
    };
  }

  els.newSong.onclick = () => { const fresh = createSong(); store.songs.push(fresh); persist(); openEditor(fresh.id); };
  els.homeBtn.onclick = showHome;
  els.lyrics.onfocus = () => { lyricsBeforeEdit = song?.lyrics || ''; };
  els.lyrics.oninput = event => { if (!song) return; applyLyrics(event.target.value); renderEditor();  save(); };
  els.lyrics.onblur = () => { if (song && lyricsBeforeEdit !== song.lyrics) commit('歌詞を編集'); };
  [els.title,els.artist,els.key,els.capo].forEach(input => input.addEventListener('change', updateMeta));
// 改ページ操作はプレビュー画面の行間ゾーンで行う
  els.lyricSize.oninput = event => updateFontSize('lyricFontSize', event.target.value); els.chordSize.oninput = event => updateFontSize('chordFontSize', event.target.value); els.lyricFamily.onchange = event => updateFontFamily('lyricFontFamily', event.target.value); els.chordFamily.onchange = event => updateFontFamily('chordFontFamily', event.target.value); els.resetSize.onclick = resetFontSizes; els.copy.onclick = copySelectedChord; els.paste.onclick = pasteChord; els.delete.onclick = deleteSelectedChord; els.duplicate.onclick = duplicateSelectedChord; els.left.onclick = () => nudge(-1); els.right.onclick = () => nudge(1); els.addChord.onclick = openMobilePalette; els.closePalette?.addEventListener('click', closeMobilePalette); els.paletteBackdrop?.addEventListener('click', closeMobilePalette);
  els.selectedName.onchange = () => { const chord = getSelectedChord(); const name = els.selectedName.value.trim(); if (chord && name && name !== chord.name) { chord.name = name; commit('コード名変更'); renderAll(); } };
  els.paletteTabs.forEach(button => button.addEventListener('click', () => { els.paletteTabs.forEach(tab => { tab.classList.remove('active'); tab.setAttribute('aria-selected','false'); }); button.classList.add('active'); button.setAttribute('aria-selected','true'); renderPalette(); }));
  els.clearPalette.onclick = () => { selectedPaletteChord = null; renderPalette(); closeMobilePalette(); }; els.transposeDown.onclick = () => transposeAll(-1); els.transposeUp.onclick = () => transposeAll(1); els.resetTranspose.onclick = () => transposeAll(-(Number(song?.transpose) || 0)); els.modes.lyrics.onclick = () => switchMode('lyrics'); els.modes.chords.onclick = () => switchMode('chords'); els.modes.preview.onclick = () => switchMode('preview');
  els.undo.onclick = () => { if (historyIndex <= 0) return; song = clone(history[--historyIndex].song); normalizeSong(song); if (!song.chords.some(chord => chord.id === selectedChordId)) selectedChordId = null; if (!song.lines.some(line => line.id === currentScoreLineId)) currentScoreLineId = getSelectedChord()?.lineId || null; replaceCurrentSong(); renderAll(); updateHistoryButtons(); };
  els.redo.onclick = () => { if (historyIndex >= history.length - 1) return; song = clone(history[++historyIndex].song); normalizeSong(song); if (!song.chords.some(chord => chord.id === selectedChordId)) selectedChordId = null; if (!song.lines.some(line => line.id === currentScoreLineId)) currentScoreLineId = getSelectedChord()?.lineId || null; replaceCurrentSong(); renderAll(); updateHistoryButtons(); };
  els.print.onclick = () => { closeInlineInput(); closeMobilePalette(); renderPreview(); requestAnimationFrame(() => { preparePrintLayout(); window.print(); }); }; window.addEventListener('afterprint', clearPrintLayout); window.addEventListener('pointermove', moveDrag, { passive: false });
window.addEventListener('pointermove', movePreviewBreakDrag, { passive: false });
window.addEventListener('pointerup', event => {
    endDrag(event);
    if (previewBreakDrag) finishPreviewBreakDrag(event);
  }, true);
  window.addEventListener('pointercancel', event => {
  endDrag(event);

  if (
    previewBreakDrag &&
    event.pointerId === previewBreakDrag.pointerId
  ) {
    previewBreakDrag = null;
  }

  els.previewSheet?.querySelectorAll('.preview-break-zone.is-drop-target')
    .forEach(zone => zone.classList.remove('is-drop-target'));
}, true);
  document.addEventListener('keydown', event => { if (inlineInput || mode !== 'chords' || event.target.matches('input,textarea,select')) return; if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelectedChord(); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteChord(); } else if (getSelectedChord()) { if (event.key === 'ArrowLeft') { event.preventDefault(); nudge(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); nudge(1); } if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelectedChord(); } if (event.key === 'Escape') clearSelectedChord(); } });
  document.addEventListener('pointerdown', event => { const chord = event.target.closest('.chord'); const controls = event.target.closest('.mobile-controls'); const tools = event.target.closest('#chordTools'); const input = event.target.closest('.inline-chord-input'); const backdrop = event.target.closest('#paletteBackdrop'); if (inlineInput && !input && !chord) setTimeout(() => inlineInput?.blur(), 0); if (els.chordTools.classList.contains('mobile-palette-open') && !tools && !controls && !backdrop) closeMobilePalette(); if (selectedChordId && !chord && !controls && !input && !tools) clearSelectedChord(); }, true);
  els.editor.classList.add('hidden'); els.home.classList.remove('hidden'); renderPalette(); renderHome();
})();
