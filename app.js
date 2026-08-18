(() => {
  'use strict';

  const STORAGE_KEY = 'guitar-score-app-v1';
  const MAX_HISTORY = 100;
  const $ = selector => document.querySelector(selector);

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
  let saveTimer = null;
  let lyricsTimer = null;

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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
      capo: 0
    };
  }

  function loadSong() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEY)
      );

      if (saved && typeof saved === 'object') {
        saved.chords = Array.isArray(saved.chords)
          ? saved.chords
          : [];

        saved.sections = Array.isArray(saved.sections)
          ? saved.sections
          : [];

        saved.lines = Array.isArray(saved.lines) && saved.lines.length
          ? saved.lines
          : [
              {
                id: uid('line'),
                text: ''
              }
            ];

        return saved;
      }
    } catch (error) {
      console.warn('保存データの読み込みに失敗しました', error);
    }

    return createSong();
  }

  function saveSong() {
    clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(song)
      );

      if (els.status) {
        els.status.textContent = '自動保存しました';

        setTimeout(() => {
          els.status.textContent = '';
        }, 1500);
      }
    }, 100);
  }

  function commit(label = '変更') {
    history = history.slice(0, historyIndex + 1);

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

  function undo() {
    if (historyIndex <= 0) return;

    historyIndex--;
    song = clone(history[historyIndex].song);
    selectedChordId = null;
    renderAll();
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;

    historyIndex++;
    song = clone(history[historyIndex].song);
    selectedChordId = null;
    renderAll();
  }

  function normalizeLines(text) {
    const previousLines = song.lines || [];
    const texts = String(text).split('\n');

    return texts.map((lineText, index) => ({
      id: previousLines[index]?.id || uid('line'),
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

    song.chords = song.chords.filter(chord =>
      validLineIds.has(chord.lineId)
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
    const fragment = document.createDocumentFragment();

    [...text].forEach((char, index) => {
      const span = document.createElement('span');

      span.className = 'lyric-char';
      span.dataset.index = index;
      span.textContent =
        char === ' ' ? '\u00a0' : char;

      fragment.appendChild(span);
    });

    return fragment;
  }

  /*
   * rowがDOMへ追加された後に呼び出す。
   * rowの左端を基準に、文字の実測位置を返す。
   */
  function getCharX(row, index) {
    const chars = row.querySelectorAll('.lyric-char');

    if (!chars.length) {
      return 0;
    }

    const rowRect = row.getBoundingClientRect();

    if (index >= chars.length) {
      const lastRect =
        chars[chars.length - 1].getBoundingClientRect();

      return lastRect.right - rowRect.left;
    }

    const charRect = chars[index].getBoundingClientRect();

    return charRect.left - rowRect.left;
  }

  function getChordById(id) {
    return song.chords.find(
      chord => chord.id === id
    );
  }

  function getSelectedChord() {
    return getChordById(selectedChordId);
  }

  function renderLine(line, editable) {
    const row = document.createElement('div');

    row.className = editable
      ? 'score-line'
      : 'preview-line';

    row.dataset.lineId = line.id;

    const lyricText = document.createElement('span');
    lyricText.className = 'lyric-text';
    lyricText.appendChild(
      renderLyricWithChars(line.text)
    );

    row.appendChild(lyricText);

    if (editable) {
      row.addEventListener('pointerup', event => {
        if (dragState) return;
        if (event.target.closest('.chord')) return;

        const rowRect = row.getBoundingClientRect();
        const x = event.clientX - rowRect.left;
        const chars = [
          ...row.querySelectorAll('.lyric-char')
        ];

        let charIndex = chars.findIndex(char => {
          const rect = char.getBoundingClientRect();
          const center =
            rect.left -
            rowRect.left +
            rect.width / 2;

          return x < center;
        });

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
      });
    }

    return row;
  }

  /*
   * rowを先にDOMへ追加した後に呼び出す。
   */
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
        chordElement.dataset.chordId = chord.id;

        const baseX = getCharX(
          row,
          chord.charIndex
        );

        const offset =
          Number(chord.offset) || 0;

        chordElement.style.left =
          `${baseX + offset}px`;

        chordElement.style.transform =
          'translateX(-50%)';

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

      /*
       * 先にrowをDOMへ追加する。
       * その後でgetCharX()を使ってコードを配置する。
       */
      els.score.appendChild(row);
      renderChordsOnRow(row, line.id);
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
      Number(song.capo)
        ? `Capo: ${song.capo}`
        : ''
    ]
      .filter(Boolean)
      .join(' / ');

    const score = document.createElement('div');
    score.className = 'score';

    els.previewSheet.append(
      title,
      artist,
      score
    );

    song.lines.forEach(line => {
      const row = renderLine(line, false);

      /*
       * プレビューでも同じ順番で配置する。
       */
      score.appendChild(row);
      renderChordsOnRow(row, line.id);
    });
  }

  function renderAll() {
    els.title.value = song.title || '';
    els.artist.value = song.artist || '';
    els.key.value = song.key || '';
    els.capo.value = song.capo || 0;

    if (els.lyrics.value !== song.lyrics) {
      els.lyrics.value = song.lyrics;
    }

    renderEditor();
    renderPreview();
    updateMode();
    updateMobileControls();
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

  function showInlineInput(
    row,
    lineId,
    charIndex,
    x
  ) {
    closeInlineInput();

    inlineInput = document.createElement('input');
    inlineInput.className =
      'inline-chord-input';

    inlineInput.type = 'text';
    inlineInput.placeholder = 'コード';
    inlineInput.autocomplete = 'off';

    inlineInput.style.left = `${x}px`;
    inlineInput.style.transform =
      'translateX(-50%)';

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

          /*
           * クリック位置をコード中心として保存する。
           */
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
      () => {
        setTimeout(finish, 80);
      }
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

  /*
   * ドラッグ開始。
   * コード中心とポインタの距離を保存する。
   */
  function startDrag(event) {
    if (mode !== 'chords') return;

    event.preventDefault();
    event.stopPropagation();

    const chordElement =
      event.currentTarget;

    const chordId =
      chordElement.dataset.chordId;

    const chord = getChordById(chordId);

    if (!chord) return;

    const rect =
      chordElement.getBoundingClientRect();

    selectedChordId = chord.id;
    updateMobileControls();

    dragState = {
      id: chord.id,
      pointerId: event.pointerId,
      chordElement,

      /*
       * transform: translateX(-50%)後の
       * 実際の中心位置を使う。
       */
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
    if (!dragState) return;

    if (
      event.pointerId !==
      dragState.pointerId
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

    /*
     * 現在のポインタ位置から、
     * コード中心の位置を求める。
     */
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
      event.pointerId !==
      dragState.pointerId
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

    /*
     * 保存済みoffsetを基準に一度だけ再描画する。
     */
    renderAll();
  }

  function updateMeta() {
    song.title = els.title.value;
    song.artist = els.artist.value;
    song.key = els.key.value;
    song.capo =
      Math.max(0, Number(els.capo.value) || 0);

    commit('曲情報を編集');
  }

  els.lyrics.addEventListener(
    'input',
    () => {
      clearTimeout(lyricsTimer);

      lyricsTimer = setTimeout(() => {
        syncLyrics(els.lyrics.value);
      }, 250);
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

  els.undo.addEventListener('click', undo);
  els.redo.addEventListener('click', redo);

  els.print.addEventListener('click', () => {
    renderPreview();

    requestAnimationFrame(() => {
      window.print();
    });
  });

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
      if (mode !== 'chords') return;
      if (!getSelectedChord()) return;

      if (
        event.target.matches('input, textarea')
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

  history.push({
    song: clone(song),
    label: '初期状態'
  });

  historyIndex = 0;

  renderAll();
})();
