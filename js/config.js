/* printer.cfg editor with save and save & restart */
App.pages.config = (() => {
  const root = $('#p-config');
  let currentFile = 'printer.cfg';
  let originalText = '';
  let isDirty = false;
  let searchMatches = [];
  let currentMatchIdx = -1;

  root.innerHTML = `
  <div class="cfg-bar">
    <div class="cfg-badge" style="gap:6px">
      ${ICON('config')}
      <select class="cfg-sel" id="cfg-file-sel" title="Select configuration file to view or edit" style="font-weight:800;color:#F8FAFC;background:transparent;border:0;padding:2px 4px;cursor:pointer">
        <option value="printer.cfg">printer.cfg</option>
      </select>
    </div>
    <span class="pill ok" id="cfg-status">● Saved</span>
    <select class="cfg-sel" id="cfg-sections" title="Jump directly to a configuration section">
      <option value="">Jump to section…</option>
    </select>
    <div class="cfg-search">
      <input id="cfg-find" placeholder="Find… (Enter / Shift+Enter)" autocomplete="off" spellcheck="false">
      <span id="cfg-matches" style="font-size:11px;color:var(--muted);min-width:35px;text-align:center"></span>
      <button id="cfg-prev" title="Previous match">▲</button>
      <button id="cfg-next" title="Next match">▼</button>
    </div>
    <div class="cfg-font-ctrl" title="Editor font size">
      <span>A</span>
      <input type="range" id="cfg-font-sz" min="11" max="22" value="13" step="1">
      <span style="font-size:15px">A</span>
      <b id="cfg-font-val">13px</b>
    </div>
    <div class="grow"></div>
    <button class="cfg-btn" id="cfg-backup-zip" title="Download all config files as a .zip archive" style="border-color:rgba(56,189,248,.4);color:#7DD3FC">📦 Backup (.zip)</button>
    <button class="cfg-btn reload" id="cfg-reload" title="Discard edits and reload from printer">⟳ Reload</button>
    <button class="cfg-btn pri" id="cfg-save">💾 Save</button>
    <button class="cfg-btn cfg-restart" id="cfg-save-restart">⚡ Save & Restart</button>
  </div>

  <div class="cfg-split">
    <div class="cfg-nav">
      <div class="cfg-nav-hdr"><span>SECTIONS</span><span id="cfg-sec-count">0</span></div>
      <div class="cfg-nav-filter"><input id="cfg-sec-filter" placeholder="Filter sections…" autocomplete="off" spellcheck="false"></div>
      <div class="cfg-nav-list" id="cfg-sec-items"></div>
    </div>
    <div class="cfg-editor">
      <div class="cfg-gutter" id="cfg-gutter">1</div>
      <div class="cfg-stage">
        <pre class="cfg-high" id="cfg-high"><code id="cfg-code"></code></pre>
        <textarea class="cfg-ta" id="cfg-text" spellcheck="false" autocomplete="off" wrap="off" placeholder="Loading printer.cfg…"></textarea>
      </div>
    </div>
  </div>

  <div class="cfg-foot">
    <div class="cfg-quick">
      <span style="font-weight:700;color:var(--muted);margin-right:2px">Sections:</span>
      <span class="cfg-tag" data-sec="stepper_x">[stepper_x]</span>
      <span class="cfg-tag" data-sec="extruder">[extruder]</span>
      <span class="cfg-tag" data-sec="heater_bed">[heater_bed]</span>
      <span class="cfg-tag" data-sec="load_cell_probe">[load_cell_probe]</span>
      <span class="cfg-tag" data-sec="bed_mesh">[bed_mesh]</span>
      <span class="cfg-tag" data-sec="gcode_macro PRINT_START">[PRINT_START]</span>
    </div>
    <div class="row" style="align-items:center;gap:12px">
      <span id="cfg-pos" style="font-family:Consolas,monospace">Ln 1, Col 1</span>
      <span id="cfg-info" style="font-family:Consolas,monospace">-- lines</span>
      <span class="sub" style="font-size:11px">Ctrl+S: Save • Ctrl+Enter: Save & Restart</span>
    </div>
  </div>`;

  const ta = $('#cfg-text', root);
  const high = $('#cfg-high', root);
  const codeEl = $('#cfg-code', root);
  const gutter = $('#cfg-gutter', root);
  const statusPill = $('#cfg-status', root);
  const secSelect = $('#cfg-sections', root);
  const posEl = $('#cfg-pos', root);
  const infoEl = $('#cfg-info', root);
  const findIn = $('#cfg-find', root);
  const matchesEl = $('#cfg-matches', root);
  const fontSlider = $('#cfg-font-sz', root);
  const fontVal = $('#cfg-font-val', root);

  // Editor font size adjustment
  const applyFontSize = sz => {
    sz = Math.max(11, Math.min(24, parseInt(sz, 10) || 13));
    const lh = Math.round(sz * 1.6);
    ta.style.fontSize = sz + 'px';
    ta.style.lineHeight = lh + 'px';
    high.style.fontSize = sz + 'px';
    high.style.lineHeight = lh + 'px';
    gutter.style.fontSize = sz + 'px';
    gutter.style.lineHeight = lh + 'px';
    if (fontVal) fontVal.textContent = sz + 'px';
    if (fontSlider) fontSlider.value = sz;
    try { localStorage.setItem('cfg_font_size', sz); } catch (e) {}
  };

  const savedSz = parseInt(localStorage.getItem('cfg_font_size'), 10) || 13;
  applyFontSize(savedSz);

  if (fontSlider) {
    fontSlider.addEventListener('input', () => {
      applyFontSize(fontSlider.value);
    });
  }

  // Syntax highlighting for Klipper INI / G-code
  const highlightKlipperCfg = code => {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = code.split('\n');
    return lines.map(line => {
      let commentIdx = -1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '#' || line[i] === ';') {
          commentIdx = i;
          break;
        }
      }
      let main = commentIdx !== -1 ? line.slice(0, commentIdx) : line;
      let comment = commentIdx !== -1 ? line.slice(commentIdx) : '';
      let escMain = esc(main);

      if (/^\s*\[[^\]]+\]/.test(main)) {
        escMain = escMain.replace(/^(\s*)(\[[^\]]+\])/, '$1<span class="tok-sec">$2</span>');
      } else if (/^\s*[a-zA-Z0-9_\-\.]+\s*[:=]/.test(main)) {
        escMain = escMain.replace(/^(\s*)([a-zA-Z0-9_\-\.]+)(\s*[:=]\s*)(.*)$/, (m, p1, k, sep, val) => {
          let v = val;
          v = v.replace(/\b(True|False|true|false)\b/g, '<span class="tok-bool">$1</span>');
          v = v.replace(/\b([a-zA-Z0-9_]+:[a-zA-Z0-9_]+|[A-Z]{1,2}\d{1,2}|gpio\d+)\b/g, '<span class="tok-pin">$1</span>');
          v = v.replace(/(?<![a-zA-Z0-9_])(-?\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>');
          return `${p1}<span class="tok-key">${k}</span><span class="tok-sep">${sep}</span>${v}`;
        });
      } else {
        escMain = escMain.replace(/\b(G\d+|M\d+|[A-Z][A-Z0-9_]{3,})\b/g, '<span class="tok-gcode">$1</span>');
        escMain = escMain.replace(/(?<![a-zA-Z0-9_])(-?\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>');
      }

      const escComment = comment ? `<span class="tok-com">${esc(comment)}</span>` : '';
      return escMain + escComment;
    }).join('\n');
  };

  const updateHighlight = () => {
    codeEl.innerHTML = highlightKlipperCfg(ta.value) + '\n';
  };

  // Sync scroll
  ta.addEventListener('scroll', () => {
    high.scrollTop = ta.scrollTop;
    high.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  });

  // Update line numbers gutter
  const updateGutter = () => {
    const lines = ta.value.split('\n');
    const count = lines.length;
    gutter.innerHTML = Array.from({ length: count }, (_, i) => i + 1).join('<br>');
    infoEl.textContent = `${count} lines • ${(new Blob([ta.value]).size / 1024).toFixed(1)} KB`;
  };

  // Cursor position
  const updateCursor = () => {
    const pos = ta.selectionStart;
    const textBefore = ta.value.substring(0, pos);
    const lines = textBefore.split('\n');
    const row = lines.length;
    const col = lines[lines.length - 1].length + 1;
    posEl.textContent = `Ln ${row}, Col ${col}`;
  };

  ['keyup', 'click', 'select', 'input'].forEach(ev => {
    ta.addEventListener(ev, updateCursor);
  });

  // Populate sections dropdown & sidebar
  let allSections = [];
  const secList = $('#cfg-sec-items', root);
  const secCount = $('#cfg-sec-count', root);
  const secFilter = $('#cfg-sec-filter', root);

  const renderSecList = () => {
    const q = secFilter.value.trim().toLowerCase();
    secList.innerHTML = '';
    const filtered = allSections.filter(s => s.name.toLowerCase().includes(q));
    secCount.textContent = filtered.length;
    filtered.forEach(s => {
      const it = document.createElement('div');
      it.className = 'cfg-nav-item';
      it.innerHTML = `<span>[${s.name}]</span><span class="ln">L${s.line + 1}</span>`;
      it.onclick = () => {
        secList.querySelectorAll('.cfg-nav-item').forEach(x => x.classList.remove('active'));
        it.classList.add('active');
        jumpToLine(s.line);
      };
      secList.appendChild(it);
    });
  };

  secFilter.addEventListener('input', renderSecList);

  const parseSections = () => {
    secSelect.innerHTML = '<option value="">Jump to section…</option>';
    allSections = [];
    const lines = ta.value.split('\n');
    lines.forEach((line, idx) => {
      const m = line.match(/^\s*\[([^\]]+)\]/);
      if (m) {
        allSections.push({ name: m[1], line: idx });
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `[${m[1]}] (L${idx + 1})`;
        secSelect.appendChild(opt);
      }
    });
    renderSecList();
  };

  // Jump to line number
  const jumpToLine = lineIdx => {
    const lines = ta.value.split('\n');
    let charOffset = 0;
    for (let i = 0; i < lineIdx && i < lines.length; i++) {
      charOffset += lines[i].length + 1;
    }
    ta.focus();
    ta.setSelectionRange(charOffset, charOffset + (lines[lineIdx] ? lines[lineIdx].length : 0));
    // Scroll cursor into view approximately
    const lineHeight = parseInt(ta.style.lineHeight, 10) || 21;
    ta.scrollTop = Math.max(0, lineIdx * lineHeight - 100);
    high.scrollTop = ta.scrollTop;
    high.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
    updateCursor();
  };

  secSelect.addEventListener('change', () => {
    const line = parseInt(secSelect.value, 10);
    if (!isNaN(line)) {
      jumpToLine(line);
    }
  });

  // Quick section tags
  root.querySelectorAll('.cfg-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const target = tag.dataset.sec;
      const lines = ta.value.split('\n');
      const idx = lines.findIndex(l => new RegExp(`^\s*\\[${target}\\b`, 'i').test(l));
      if (idx !== -1) {
        jumpToLine(idx);
      } else {
        toast(`Section [${target}] not found`);
      }
    });
  });

  // Dirty state tracking
  const markDirty = dirty => {
    isDirty = dirty;
    if (dirty) {
      statusPill.className = 'pill warn';
      statusPill.textContent = '● Unsaved changes';
    } else {
      statusPill.className = 'pill ok';
      statusPill.textContent = '● Saved';
    }
  };

  ta.addEventListener('input', () => {
    updateGutter();
    updateHighlight();
    markDirty(ta.value !== originalText);
  });

  // Tab key & shortcut key interception
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (!e.shiftKey) {
        // Insert 2 spaces
        ta.setRangeText('  ', start, end, 'end');
      } else {
        // Un-indent if preceded by spaces
        if (start >= 2 && ta.value.substring(start - 2, start) === '  ') {
          ta.setSelectionRange(start - 2, start);
          ta.setRangeText('', start - 2, start, 'end');
        }
      }
      updateGutter();
      updateHighlight();
      markDirty(ta.value !== originalText);
      updateCursor();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (e.shiftKey) {
        saveAndRestart();
      } else {
        saveOnly();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveAndRestart();
    }
  });

  // Search feature
  const performSearch = () => {
    const q = findIn.value.trim().toLowerCase();
    searchMatches = [];
    currentMatchIdx = -1;
    if (!q) {
      matchesEl.textContent = '';
      return;
    }
    const val = ta.value.toLowerCase();
    let idx = 0;
    while ((idx = val.indexOf(q, idx)) !== -1) {
      searchMatches.push(idx);
      idx += q.length;
    }
    if (searchMatches.length > 0) {
      currentMatchIdx = 0;
      goToMatch(0);
    } else {
      matchesEl.textContent = '0 of 0';
    }
  };

  const goToMatch = idx => {
    if (idx < 0 || idx >= searchMatches.length) return;
    currentMatchIdx = idx;
    const qLen = findIn.value.trim().length;
    const start = searchMatches[idx];
    ta.focus();
    ta.setSelectionRange(start, start + qLen);

    // Scroll into view
    const textBefore = ta.value.substring(0, start);
    const lineIdx = textBefore.split('\n').length - 1;
    const lineHeight = parseInt(ta.style.lineHeight, 10) || 21;
    ta.scrollTop = Math.max(0, lineIdx * lineHeight - 120);
    high.scrollTop = ta.scrollTop;
    high.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;

    matchesEl.textContent = `${idx + 1} of ${searchMatches.length}`;
    updateCursor();
  };

  findIn.addEventListener('input', performSearch);
  findIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchMatches.length === 0) performSearch();
      else {
        const next = e.shiftKey
          ? (currentMatchIdx - 1 + searchMatches.length) % searchMatches.length
          : (currentMatchIdx + 1) % searchMatches.length;
        goToMatch(next);
      }
    }
  });

  $('#cfg-next', root).onclick = () => {
    if (searchMatches.length > 0) {
      goToMatch((currentMatchIdx + 1) % searchMatches.length);
    }
  };
  $('#cfg-prev', root).onclick = () => {
    if (searchMatches.length > 0) {
      goToMatch((currentMatchIdx - 1 + searchMatches.length) % searchMatches.length);
    }
  };

  const fileSel = $('#cfg-file-sel', root);

  const loadConfigList = async () => {
    try {
      const list = await MR.listConfigs();
      const editable = list.filter(f => /\.(cfg|conf|ini|json|txt)$/i.test(f.path || '') && !/^printer-\d{8}_\d{6}\.cfg$/i.test(f.path || ''));
      const priority = ['printer.cfg', 'moonraker.conf', 'crowsnest.conf', 'KAMP_Settings.cfg', 'klipper-touch.conf'];
      editable.sort((a, b) => {
        const ai = priority.findIndex(p => p.toLowerCase() === a.path.toLowerCase());
        const bi = priority.findIndex(p => p.toLowerCase() === b.path.toLowerCase());
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.path.localeCompare(b.path);
      });
      if (editable.length && fileSel) {
        fileSel.innerHTML = editable.map(f => `<option value="${f.path}" ${f.path === currentFile ? 'selected' : ''} style="background:#0F172A;color:#F8FAFC">${f.path}</option>`).join('');
      }
    } catch (e) {}
  };

  if (fileSel) {
    fileSel.addEventListener('change', () => {
      const nextFile = fileSel.value;
      if (!nextFile || nextFile === currentFile) return;
      if (isDirty) {
        confirmBox(
          'Discard Unsaved Changes?',
          `You have unsaved edits in <b>${currentFile}</b>. Switch to <b>${nextFile}</b> without saving?`,
          'Switch File',
          () => {
            currentFile = nextFile;
            loadConfig();
          },
          true
        );
        fileSel.value = currentFile;
      } else {
        currentFile = nextFile;
        loadConfig();
      }
    });
  }

  $('#cfg-backup-zip', root).onclick = async () => {
    const btn = $('#cfg-backup-zip', root);
    btn.disabled = true;
    btn.textContent = '📦 Packing…';
    try {
      const blob = await MR.backupConfigsZip();
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `klipper-configs-backup-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
      toast('✓ Downloaded config backup (.zip)');
    } catch (e) {
      toast('⚠ Backup failed: ' + (e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = '📦 Backup (.zip)';
    }
  };

  // Load config from Moonraker
  const loadConfig = async () => {
    statusPill.className = 'pill';
    statusPill.textContent = 'Loading…';
    try {
      loadConfigList();
      const text = await MR.readConfig(currentFile);
      originalText = text;
      ta.value = text;
      updateHighlight();
      markDirty(false);
      updateGutter();
      parseSections();
      updateCursor();
      toast(`${currentFile} loaded`);
    } catch (e) {
      statusPill.className = 'pill bad';
      statusPill.textContent = 'Load Failed';
      toast(`Failed to load ${currentFile} from printer`);
    }
  };

  // Save only
  const saveOnly = async () => {
    const text = ta.value;
    const btn = $('#cfg-save', root);
    btn.disabled = true;
    btn.textContent = 'Saving…';
    statusPill.className = 'pill warn';
    statusPill.textContent = '● Uploading…';

    try {
      const ok = await MR.writeConfig(text, currentFile);
      if (ok) {
        originalText = text;
        markDirty(false);
        parseSections();
        toast(`✓ ${currentFile} saved to printer`);
      } else {
        toast('⚠ Upload failed');
        markDirty(true);
      }
    } catch (e) {
      toast(`⚠ Failed to save ${currentFile}: ` + e.message);
      markDirty(true);
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Save';
    }
  };

  // Save and restart
  const saveAndRestart = () => {
    confirmBox(
      'Save & Restart Klipper',
      `This will save <b>${currentFile}</b> and immediately execute a Klipper <b>RESTART</b>. Motors and active jobs will stop. Proceed?`,
      'Save & Restart',
      async () => {
        const text = ta.value;
        const btn = $('#cfg-save-restart', root);
        btn.disabled = true;
        btn.textContent = 'Saving & restarting…';
        statusPill.className = 'pill warn';
        statusPill.textContent = '● Restarting…';

        try {
          const ok = await MR.writeConfig(text, currentFile);
          if (ok) {
            originalText = text;
            markDirty(false);
            toast(`✓ Saved ${currentFile}! Restarting Klipper…`);
            await MR.restart();
            setTimeout(() => {
              go('home');
            }, 1200);
          } else {
            toast('⚠ Upload failed before restart');
          }
        } catch (e) {
          toast('⚠ Error: ' + e.message);
        } finally {
          btn.disabled = false;
          btn.textContent = '⚡ Save & Restart';
        }
      },
      false
    );
  };

  // Reload
  $('#cfg-reload', root).onclick = () => {
    if (isDirty) {
      confirmBox(
        'Discard Unsaved Changes?',
        'You have unsaved changes in printer.cfg. Reloading will discard them. Continue?',
        'Discard & Reload',
        loadConfig,
        true
      );
    } else {
      loadConfig();
    }
  };

  $('#cfg-save', root).onclick = saveOnly;
  $('#cfg-save-restart', root).onclick = saveAndRestart;

  let loadedOnce = false;
  MR.on('connection', ok => {
    if (ok && (!loadedOnce || !ta.value || ta.value === 'Loading printer.cfg…')) {
      if (App.cur === 'config') {
        loadedOnce = true;
        loadConfig();
      }
    }
  });

  return {
    show() {
      if (!loadedOnce || !ta.value || ta.value === 'Loading printer.cfg…') {
        loadedOnce = true;
        loadConfig();
      }
    },
    reload: loadConfig
  };
})();

