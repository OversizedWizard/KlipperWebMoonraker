/* System & Service Logs page: list Moonraker/Klipper logs, inspect, search, download & print */
App.pages.logs = (() => {
  const root = $('#p-logs');
  let allFiles = [];
  let currentFile = null;
  let rawText = '';
  let lineLimit = 2000;
  let levelFilter = 'all'; // 'all' | 'warn' | 'error'
  let searchQuery = '';

  const LOG_META = {
    'klippy.log': {
      title: 'Klipper Firmware Log',
      service: 'KLIPPER',
      color: '#FF7A00',
      bg: 'rgba(255,122,0,.14)',
      border: 'rgba(255,122,0,.4)',
      icon: 'firmware',
      desc: 'MCU communication, kinematics, heater PID, homing, macros & G-code execution errors.'
    },
    'moonraker.log': {
      title: 'Moonraker API Server Log',
      service: 'MOONRAKER',
      color: '#00E5FF',
      bg: 'rgba(0,229,255,.14)',
      border: 'rgba(0,229,255,.4)',
      icon: 'reload',
      desc: 'REST API, WebSocket clients, file manager, update manager & system service events.'
    },
    'klipperscreen.log': {
      title: 'KlipperScreen Display Log',
      service: 'DISPLAY UI',
      color: '#A855F7',
      bg: 'rgba(168,85,247,.14)',
      border: 'rgba(168,85,247,.4)',
      icon: 'tune',
      desc: 'Touchscreen UI events, panel navigation, Moonraker connection & display diagnostics.'
    },
    'crowsnest.log': {
      title: 'Crowsnest Webcam Log',
      service: 'WEBCAM',
      color: '#22C55E',
      bg: 'rgba(34,197,94,.14)',
      border: 'rgba(34,197,94,.4)',
      icon: 'info',
      desc: 'Camera streamer daemon, v4l2 video devices, resolution & MJPEG/WebRTC stream status.'
    },
    'mainsail-error.log': {
      title: 'Web Server Error Log',
      service: 'NGINX / WEB',
      color: '#F43F5E',
      bg: 'rgba(244,63,94,.14)',
      border: 'rgba(244,63,94,.4)',
      icon: 'logs',
      desc: 'HTTP reverse proxy and static web server error entries.'
    },
    'mainsail-access.log': {
      title: 'Web Server Access Log',
      service: 'NGINX / WEB',
      color: '#64748B',
      bg: 'rgba(100,116,139,.14)',
      border: 'rgba(100,116,139,.4)',
      icon: 'logs',
      desc: 'HTTP client requests and proxy access log.'
    }
  };

  function getMetaForFile(path) {
    const lower = String(path || '').toLowerCase();
    if (LOG_META[lower]) return LOG_META[lower];
    const base = lower.replace(/\.\d{4}-\d{2}-\d{2}.*$/, '').replace(/\.\d+$/, '');
    if (LOG_META[base]) {
      return {
        ...LOG_META[base],
        title: `${LOG_META[base].title} (Archived)`,
        service: `${LOG_META[base].service} ARCHIVE`
      };
    }
    return {
      title: path,
      service: 'SYSTEM LOG',
      color: '#38BDF8',
      bg: 'rgba(56,189,248,.12)',
      border: 'rgba(56,189,248,.35)',
      icon: 'logs',
      desc: 'System or companion service log file stored in Moonraker logs directory.'
    };
  }

  function isRollover(path) {
    return /\.\d{4}-\d{2}-\d{2}|\.\d+$/.test(path);
  }

  function fmtSize(bytes) {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '-- B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function fmtDate(ts) {
    if (!ts) return 'Unknown date';
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return 'Unknown date';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  root.innerHTML = `
    <!-- LIST VIEW -->
    <div class="logs-list-wrap" id="logs-list-view">
      <div class="logs-top-bar">
        <div class="row" style="align-items:center;gap:10px">
          <div class="cfg-badge">${ICON('logs')} <span>System & Service Logs</span></div>
          <span class="pill ok" id="logs-count-pill">0 logs</span>
        </div>
        <div class="grow"></div>
        <div class="logs-filter-box">
          ${ICON('search', 15)}
          <input id="logs-list-filter" placeholder="Filter log files…" autocomplete="off" spellcheck="false">
        </div>
        <button class="btn sm" id="logs-refresh-btn" title="Refresh log file list">⟳ Refresh</button>
      </div>

      <div class="logs-scroll-body">
        <div class="logs-sec-hdr">
          <span>ACTIVE SERVICE LOGS</span>
          <span class="sub" style="font-size:11px">Click any log to open viewer, download, or print</span>
        </div>
        <div class="logs-grid" id="logs-active-grid"></div>

        <div class="logs-sec-hdr" id="logs-archive-hdr" style="margin-top:18px;display:none">
          <span>ARCHIVED / ROLLOVER LOGS</span>
          <span class="sub" id="logs-archive-count" style="font-size:11px"></span>
        </div>
        <div class="logs-archive-grid" id="logs-archive-grid" style="display:none"></div>
      </div>
    </div>

    <!-- DETAIL VIEWER -->
    <div class="logs-detail-wrap" id="logs-detail-view" style="display:none">
      <div class="logs-viewer-bar">
        <button class="btn sm" id="log-back-btn" title="Back to all logs">‹ All Logs</button>
        <div class="cfg-badge" id="log-active-badge">${ICON('logs')} <span id="log-active-name">klippy.log</span></div>
        <span class="pill" id="log-meta-pill">-- KB</span>

        <div class="logs-level-group" role="group" aria-label="Filter log level">
          <button class="log-lvl-btn active" data-lvl="all">All</button>
          <button class="log-lvl-btn warn" data-lvl="warn">⚠ Warn+</button>
          <button class="log-lvl-btn err" data-lvl="error">✖ Errors</button>
        </div>

        <select class="cfg-sel" id="log-tail-sel" title="Number of lines to display">
          <option value="500">Last 500 lines</option>
          <option value="2000" selected>Last 2,000 lines</option>
          <option value="5000">Last 5,000 lines</option>
          <option value="0">All lines (Full)</option>
        </select>

        <div class="cfg-search" style="min-width:170px">
          <input id="log-find-input" placeholder="Search in log…" autocomplete="off" spellcheck="false">
          <button id="log-find-clear" title="Clear search" style="display:none">✕</button>
        </div>

        <div class="grow"></div>

        <button class="cfg-btn" id="log-bottom-btn" title="Scroll to bottom (latest entries)">⬇ Bottom</button>
        <button class="cfg-btn reload" id="log-reload-btn" title="Reload log from printer">⟳ Reload</button>
        <button class="cfg-btn log-dl-btn" id="log-download-btn" title="Download full log file">${ICON('download', 15)} <span>Download</span></button>
        <button class="cfg-btn log-print-btn" id="log-print-btn" title="Print log or Save as PDF">${ICON('print', 15)} <span>Print</span></button>
      </div>

      <div class="logs-viewer-stage" id="log-viewer-stage">
        <div class="logs-code-wrap" id="log-code-wrap">
          <div class="logs-empty-msg">Loading log file…</div>
        </div>
      </div>

      <div class="cfg-foot">
        <div class="row" style="align-items:center;gap:14px">
          <span id="log-foot-file" style="font-weight:800;color:var(--text)">--</span>
          <span id="log-foot-stats" class="sub" style="font-family:Consolas,monospace">-- lines</span>
        </div>
        <div class="row" style="align-items:center;gap:12px">
          <span id="log-foot-mod" class="sub" style="font-size:11px">Modified: --</span>
        </div>
      </div>
    </div>
  `;

  const listView = $('#logs-list-view', root);
  const detailView = $('#logs-detail-view', root);
  const activeGrid = $('#logs-active-grid', root);
  const archiveGrid = $('#logs-archive-grid', root);
  const archiveHdr = $('#logs-archive-hdr', root);
  const archiveCount = $('#logs-archive-count', root);
  const countPill = $('#logs-count-pill', root);
  const listFilter = $('#logs-list-filter', root);

  const activeNameEl = $('#log-active-name', root);
  const metaPill = $('#log-meta-pill', root);
  const tailSel = $('#log-tail-sel', root);
  const findInput = $('#log-find-input', root);
  const findClear = $('#log-find-clear', root);
  const codeWrap = $('#log-code-wrap', root);
  const footFile = $('#log-foot-file', root);
  const footStats = $('#log-foot-stats', root);
  const footMod = $('#log-foot-mod', root);

  async function loadLogList() {
    countPill.textContent = 'Loading…';
    try {
      const files = await MR.listLogs();
      if (files && files.length > 0) {
        allFiles = files.slice();
      } else {
        // Fallback default log entries if Moonraker list is empty or offline
        allFiles = [
          { path: 'klippy.log', size: 0, modified: 0 },
          { path: 'moonraker.log', size: 0, modified: 0 },
          { path: 'KlipperScreen.log', size: 0, modified: 0 },
          { path: 'crowsnest.log', size: 0, modified: 0 }
        ];
      }
      renderLogList();
    } catch (e) {
      countPill.textContent = 'Offline';
      renderLogList();
    }
  }

  function sortLogs(list) {
    const priority = ['klippy.log', 'moonraker.log', 'klipperscreen.log', 'crowsnest.log', 'mainsail-error.log', 'mainsail-access.log'];
    return list.slice().sort((a, b) => {
      const al = a.path.toLowerCase();
      const bl = b.path.toLowerCase();
      const ai = priority.indexOf(al);
      const bi = priority.indexOf(bl);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return (b.modified || 0) - (a.modified || 0);
    });
  }

  function renderLogList() {
    const q = (listFilter.value || '').trim().toLowerCase();
    const filtered = allFiles.filter(f => {
      if (!q) return true;
      const m = getMetaForFile(f.path);
      return f.path.toLowerCase().includes(q) || m.title.toLowerCase().includes(q) || m.service.toLowerCase().includes(q);
    });

    const active = sortLogs(filtered.filter(f => !isRollover(f.path)));
    const archived = filtered
      .filter(f => isRollover(f.path))
      .sort((a, b) => (b.modified || 0) - (a.modified || 0));

    countPill.textContent = `${filtered.length} log${filtered.length === 1 ? '' : 's'}`;

    activeGrid.innerHTML = '';
    if (active.length === 0) {
      activeGrid.innerHTML = `<div class="logs-empty-msg">No matching active logs found.</div>`;
    } else {
      active.forEach(file => {
        const meta = getMetaForFile(file.path);
        const card = el(`
          <div class="log-card" style="--log-accent:${meta.color};--log-border:${meta.border};--log-bg:${meta.bg}">
            <div class="log-card-top">
              <div class="log-card-icon" style="background:${meta.bg};border-color:${meta.border};color:${meta.color}">
                ${ICON(meta.icon || 'logs', 22)}
              </div>
              <div class="grow" style="min-width:0">
                <div class="row" style="align-items:center;gap:8px;flex-wrap:wrap">
                  <span class="log-srv-badge" style="background:${meta.bg};color:${meta.color};border-color:${meta.border}">${meta.service}</span>
                  <span class="log-size-pill">${fmtSize(file.size)}</span>
                </div>
                <div class="log-card-name">${escHtml(file.path)}</div>
                <div class="log-card-title">${escHtml(meta.title)}</div>
              </div>
            </div>
            <div class="log-card-desc">${escHtml(meta.desc)}</div>
            <div class="log-card-foot">
              <span class="sub" style="font-size:11px">🕒 ${fmtDate(file.modified)}</span>
              <div class="row" style="gap:6px">
                <button class="btn sm log-quick-dl" title="Download ${escHtml(file.path)}">${ICON('download', 14)} Download</button>
                <button class="btn sm pri log-open-btn">Open Log ›</button>
              </div>
            </div>
          </div>
        `);
        card.onclick = e => {
          if (e.target.closest('.log-quick-dl')) return;
          openLogFile(file);
        };
        $('.log-quick-dl', card).onclick = e => {
          e.stopPropagation();
          downloadLogFile(file.path);
        };
        activeGrid.appendChild(card);
      });
    }

    if (archived.length > 0) {
      archiveHdr.style.display = 'flex';
      archiveGrid.style.display = 'grid';
      archiveCount.textContent = `${archived.length} archived file${archived.length === 1 ? '' : 's'}`;
      archiveGrid.innerHTML = '';
      archived.forEach(file => {
        const meta = getMetaForFile(file.path);
        const item = el(`
          <div class="log-arch-card">
            <div class="log-card-icon sm" style="background:${meta.bg};border-color:${meta.border};color:${meta.color}">
              ${ICON('logs', 16)}
            </div>
            <div class="grow" style="min-width:0">
              <div class="log-arch-name">${escHtml(file.path)}</div>
              <div class="sub" style="font-size:11px">${fmtSize(file.size)} • ${fmtDate(file.modified)}</div>
            </div>
            <button class="btn sm log-arch-dl" title="Download">${ICON('download', 14)}</button>
            <button class="btn sm">Open</button>
          </div>
        `);
        item.onclick = e => {
          if (e.target.closest('.log-arch-dl')) return;
          openLogFile(file);
        };
        $('.log-arch-dl', item).onclick = e => {
          e.stopPropagation();
          downloadLogFile(file.path);
        };
        archiveGrid.appendChild(item);
      });
    } else {
      archiveHdr.style.display = 'none';
      archiveGrid.style.display = 'none';
    }
  }

  async function openLogFile(fileObj) {
    currentFile = typeof fileObj === 'string' ? { path: fileObj, size: 0, modified: 0 } : fileObj;
    listView.style.display = 'none';
    detailView.style.display = 'flex';
    $('#title').textContent = `Logs › ${currentFile.path}`;
    updateTopBack();

    activeNameEl.textContent = currentFile.path;
    metaPill.className = 'pill';
    metaPill.textContent = 'Loading…';
    footFile.textContent = currentFile.path;
    footMod.textContent = `Modified: ${fmtDate(currentFile.modified)}`;
    codeWrap.innerHTML = `<div class="logs-empty-msg">Fetching <b>${escHtml(currentFile.path)}</b> from Moonraker…</div>`;

    await fetchActiveLogContent(true);
  }

  async function fetchActiveLogContent(scrollToEnd = true) {
    if (!currentFile) return;
    metaPill.className = 'pill';
    metaPill.textContent = 'Loading…';
    try {
      rawText = await MR.readLog(currentFile.path);
      const byteSize = new Blob([rawText]).size;
      currentFile.size = byteSize;
      metaPill.className = 'pill ok';
      metaPill.textContent = fmtSize(byteSize);
      renderLogLines(scrollToEnd);
    } catch (e) {
      metaPill.className = 'pill bad';
      metaPill.textContent = 'Load Error';
      codeWrap.innerHTML = `
        <div class="logs-empty-msg" style="color:var(--danger)">
          Failed to load <b>${escHtml(currentFile.path)}</b>.<br>
          <span class="sub">${escHtml(e.message || 'Check Moonraker connection')}</span>
        </div>`;
    }
  }

  function classifyLine(line) {
    if (/\b(ERROR|CRITICAL|FATAL|Traceback|Exception|Shutdown|MCU\s+'[^']+'\s+shutdown|Lost communication)\b/i.test(line)) {
      return 'err';
    }
    if (/\b(WARNING|WARN|webhooks client|bed_mesh:.*warn)\b/i.test(line)) {
      return 'warn';
    }
    if (/^Stats\s+\d+/i.test(line)) {
      return 'stats';
    }
    return '';
  }

  function highlightLine(line, qLower) {
    let html = escHtml(line);
    // Highlight leading timestamp if present
    html = html.replace(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,\.]\d+|\[\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\])/, '<span class="log-ts">$1</span>');
    if (qLower) {
      const safeQ = qLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(${safeQ})`, 'gi');
      html = html.replace(re, '<mark class="log-mark">$1</mark>');
    }
    return html;
  }

  function renderLogLines(scrollToEnd = false) {
    if (!rawText) {
      codeWrap.innerHTML = `<div class="logs-empty-msg">Log file is empty (0 bytes).</div>`;
      footStats.textContent = `0 lines • ${fmtSize(currentFile?.size || 0)}`;
      return;
    }

    const allLines = rawText.replace(/\r\n/g, '\n').split('\n');
    if (allLines.length > 1 && allLines[allLines.length - 1] === '') {
      allLines.pop();
    }
    const totalCount = allLines.length;

    const startIdx = lineLimit > 0 && totalCount > lineLimit ? totalCount - lineLimit : 0;
    const sliced = allLines.slice(startIdx);

    const qLower = (searchQuery || '').trim().toLowerCase();
    const rows = [];
    let matchCount = 0;

    for (let i = 0; i < sliced.length; i++) {
      const line = sliced[i];
      const lineNo = startIdx + i + 1;
      const cls = classifyLine(line);

      if (levelFilter === 'error' && cls !== 'err') continue;
      if (levelFilter === 'warn' && cls !== 'err' && cls !== 'warn') continue;
      if (qLower && !line.toLowerCase().includes(qLower)) continue;

      matchCount++;
      rows.push(
        `<div class="log-line ${cls}"><span class="log-ln">${lineNo}</span><span class="log-txt">${highlightLine(line, qLower)}</span></div>`
      );
    }

    if (rows.length === 0) {
      codeWrap.innerHTML = `<div class="logs-empty-msg">No log lines match the current filter.</div>`;
    } else {
      codeWrap.innerHTML = rows.join('');
    }

    const shownInfo = startIdx > 0
      ? `Showing ${rows.length.toLocaleString()} of last ${sliced.length.toLocaleString()} lines (Total: ${totalCount.toLocaleString()} lines)`
      : `Showing ${rows.length.toLocaleString()} of ${totalCount.toLocaleString()} lines`;
    footStats.textContent = `${shownInfo} • ${fmtSize(currentFile?.size || 0)}`;

    if (scrollToEnd) {
      const stage = $('#log-viewer-stage', root);
      if (stage) {
        stage.scrollTop = stage.scrollHeight;
      }
    }
  }

  function downloadLogFile(filename) {
    const name = filename || currentFile?.path;
    if (!name) return;

    // If we already loaded rawText for the currently open file, download directly via Blob for instant save
    if (currentFile && currentFile.path === name && rawText) {
      const blob = new Blob([rawText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name.split('/').pop();
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 400);
      toast(`⬇ Downloading ${name}`);
      return;
    }

    // Otherwise use Moonraker's direct attachment download endpoint
    const url = MR.logDownloadURL(name);
    const a = document.createElement('a');
    a.href = url;
    a.download = name.split('/').pop();
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 400);
    toast(`⬇ Downloading ${name}`);
  }

  function printActiveLog() {
    if (!currentFile) return;
    const allLines = (rawText || '').replace(/\r\n/g, '\n').split('\n');
    const totalCount = allLines.length;
    const startIdx = lineLimit > 0 && totalCount > lineLimit ? totalCount - lineLimit : 0;
    const sliced = allLines.slice(startIdx);
    const qLower = (searchQuery || '').trim().toLowerCase();

    const printableLines = [];
    for (let i = 0; i < sliced.length; i++) {
      const line = sliced[i];
      const lineNo = startIdx + i + 1;
      const cls = classifyLine(line);
      if (levelFilter === 'error' && cls !== 'err') continue;
      if (levelFilter === 'warn' && cls !== 'err' && cls !== 'warn') continue;
      if (qLower && !line.toLowerCase().includes(qLower)) continue;
      printableLines.push(`${String(lineNo).padStart(6, ' ')} | ${escHtml(line)}`);
    }

    const win = window.open('', '_blank', 'width=960,height=720');
    if (!win) {
      toast('⚠ Pop-up blocked — allow pop-ups to print');
      return;
    }

    const nowStr = new Date().toLocaleString();
    win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Print Log — ${escHtml(currentFile.path)}</title>
<style>
  body {
    font-family: Consolas, "Courier New", monospace;
    margin: 20px;
    color: #111827;
    background: #ffffff;
  }
  .hdr {
    border-bottom: 2px solid #111827;
    padding-bottom: 10px;
    margin-bottom: 14px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .hdr h1 {
    margin: 0;
    font-size: 18px;
  }
  .hdr .meta {
    font-size: 12px;
    color: #4B5563;
  }
  pre {
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
  @media print {
    body { margin: 8mm; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="hdr">
    <div>
      <h1>${escHtml(currentFile.path)}</h1>
      <div class="meta">Size: ${fmtSize(currentFile.size)} • Modified: ${fmtDate(currentFile.modified)} • Lines printed: ${printableLines.length.toLocaleString()}</div>
    </div>
    <div class="meta">Printed: ${escHtml(nowStr)}</div>
  </div>
  <pre>${printableLines.join('\n') || '(No log lines)'}</pre>
  <script>
    window.onload = function() {
      setTimeout(function() {
        window.focus();
        window.print();
      }, 200);
    };
  <\/script>
</body>
</html>`);
    win.document.close();
  }

  function closeDetail() {
    currentFile = null;
    detailView.style.display = 'none';
    listView.style.display = 'flex';
    $('#title').textContent = TITLES.logs || 'System Logs';
    updateTopBack();
  }

  // Event bindings
  $('#logs-refresh-btn', root).onclick = () => {
    loadLogList();
    toast('Refreshing log files…');
  };

  listFilter.addEventListener('input', renderLogList);

  $('#log-back-btn', root).onclick = closeDetail;

  $('#log-reload-btn', root).onclick = () => {
    fetchActiveLogContent(true);
    toast(`Reloaded ${currentFile?.path || 'log'}`);
  };

  $('#log-bottom-btn', root).onclick = () => {
    const stage = $('#log-viewer-stage', root);
    if (stage) stage.scrollTop = stage.scrollHeight;
  };

  $('#log-download-btn', root).onclick = () => {
    if (currentFile) downloadLogFile(currentFile.path);
  };

  $('#log-print-btn', root).onclick = () => {
    printActiveLog();
  };

  tailSel.addEventListener('change', () => {
    lineLimit = parseInt(tailSel.value, 10) || 0;
    renderLogLines(true);
  });

  root.querySelectorAll('.log-lvl-btn').forEach(btn => {
    btn.onclick = () => {
      levelFilter = btn.dataset.lvl || 'all';
      root.querySelectorAll('.log-lvl-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderLogLines(false);
    };
  });

  findInput.addEventListener('input', () => {
    searchQuery = findInput.value;
    findClear.style.display = searchQuery ? 'inline-block' : 'none';
    renderLogLines(false);
  });

  findClear.onclick = () => {
    findInput.value = '';
    searchQuery = '';
    findClear.style.display = 'none';
    renderLogLines(false);
  };

  return {
    show() {
      loadLogList();
      if (currentFile) {
        $('#title').textContent = `Logs › ${currentFile.path}`;
      }
    },
    isDetailOpen() {
      return Boolean(currentFile && detailView.style.display !== 'none');
    },
    openLog: openLogFile,
    closeDetail
  };
})();
