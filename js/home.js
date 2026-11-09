/* Home: pro operator dashboard with collapsible & rearrangeable cards */
App.pages.home = (() => {
  const root = $('#p-home');
  let step = 1, elen = 10, hist = { nozzle: [], bed: [] }, cmdHist = [], hi = 0, dragging = null;

  // Pro Quick Actions (no duplicate Home buttons here)
  const QA = [
    ['gantry', 'Z-Tilt', 'Z_TILT_ADJUST', '', () => MR.gcode('Z_TILT_ADJUST', 300000), 'z_tilt'],
    ['gantry', 'QGL', 'QUAD_GANTRY_LEVEL', '', () => MR.gcode('QUAD_GANTRY_LEVEL', 300000), 'quad_gantry_level'],
    ['mesh', 'Load Mesh', 'BED_MESH_PROFILE LOAD=default', '', () => MR.gcode('BED_MESH_PROFILE LOAD=default'), 'bed_mesh'],
    ['power', 'Motors Off', 'M84', 'off', () => MR.motorsOff()],
    ['restart', 'FW Restart', 'FIRMWARE_RESTART', '', () => MR.fwRestart()],
    ['reload', 'Restart', 'RESTART', '', () => MR.restart()],
  ];

  const chip = (id, l) => `<div class="hchip" id="${id}"><span class="k">${l}</span><b>--</b></div>`;

  const DEF_LAYOUT = [
    ['card-nozzle', 'card-bed', 'card-tune'],
    ['card-motion', 'card-extruder'],
    ['card-probe', 'card-console', 'card-macros']
  ];

  let currentLayout = DEF_LAYOUT.map(c => [...c]);
  try {
    const saved = JSON.parse(localStorage.getItem('home_card_layout') || 'null');
    if (Array.isArray(saved) && saved.length === 3) {
      const flat = saved.flat();
      const all = DEF_LAYOUT.flat();
      if (all.every(id => flat.includes(id))) currentLayout = saved;
    }
  } catch (e) {}

  let collapsedSet = new Set();
  try {
    const savedCol = JSON.parse(localStorage.getItem('home_collapsed') || '[]');
    if (Array.isArray(savedCol)) collapsedSet = new Set(savedCol);
  } catch (e) {}

  const saveLayout = () => {
    const cols = root.querySelectorAll('.hcol');
    currentLayout = Array.from(cols).map(c =>
      Array.from(c.querySelectorAll('.card[data-card-id]')).map(el => el.dataset.cardId)
    );
    try { localStorage.setItem('home_card_layout', JSON.stringify(currentLayout)); } catch (e) {}
  };

  const saveCollapsed = () => {
    try { localStorage.setItem('home_collapsed', JSON.stringify(Array.from(collapsedSet))); } catch (e) {}
  };

  root.innerHTML = `
  <div class="hstrip">
    ${chip('c-klippy', 'KLIPPER')}
    ${chip('c-print', 'STATE')}
    ${chip('c-mesh', 'MESH')}
    ${chip('c-save', 'CONFIG')}
    <div class="grow"></div>
    <button class="hchip-btn" id="h-rearrange" title="Customize and rearrange cards">⇄ Rearrange</button>
    <button class="hchip-btn danger" id="h-reset-layout" title="Reset layout and expand all cards" style="display:none">↺ Reset Layout</button>
  </div>
  <div class="hqa" id="hqa"></div>
  <div class="hgrid" id="hgrid">
    <div class="hcol" data-col="0"></div>
    <div class="hcol" data-col="1"></div>
    <div class="hcol" data-col="2"></div>
  </div>`;

  const headHtml = (title, iconKey, sumId, extraBadges = '', defaultSum = '') => `
    <div class="card-head">
      <div class="card-handle" title="Drag to rearrange">⠿</div>
      <div class="ti3">${ICON(iconKey, 20)}</div>
      <div class="card-title-group grow">
        <div class="card-title">${title}</div>
        <div class="card-summary" id="${sumId}">${defaultSum}</div>
      </div>
      ${extraBadges}
      <div class="card-reorder-ctrls">
        <button class="btn-card-mv" data-dir="left" title="Move to left column">◀</button>
        <button class="btn-card-mv" data-dir="up" title="Move up in column">▲</button>
        <button class="btn-card-mv" data-dir="down" title="Move down in column">▼</button>
        <button class="btn-card-mv" data-dir="right" title="Move to right column">▶</button>
      </div>
      <button class="card-collapse-btn" title="Toggle collapse"><span class="chev">▼</span></button>
    </div>
  `;

  // Pre-build card DOM elements
  const cardNodes = {
    'card-nozzle': el(`
      <div class="card ht nozzle" id="t-nozzle" data-card-id="card-nozzle" draggable="true">
        ${headHtml('NOZZLE', 'nozzle', 'sum-nozzle', '<span class="badge off" id="b-nozzle" style="position:static">OFF</span>', 'Target 0°C')}
        <div class="card-body">
          <div class="tg" id="tg-nozzle">Target 0°C</div>
          <div class="tv" id="v-nozzle">--</div>
          <div class="bar"><i id="bar-nozzle"></i></div>
          <canvas class="spark" id="sp-nozzle" height="46"></canvas>
          <div class="row tq" data-k="nozzle">
            <button class="btn sm" data-t="0">Off</button>
            ${PRE['nozzle'].slice(0, 3).map(([m, t]) => `<button class="btn sm" data-t="${t}">${m} ${t}°</button>`).join('')}
            <button class="btn sm pri" data-t="set">Set…</button>
          </div>
        </div>
      </div>
    `),
    'card-bed': el(`
      <div class="card ht bed" id="t-bed" data-card-id="card-bed" draggable="true">
        ${headHtml('HEATED BED', 'bed', 'sum-bed', '<span class="badge off" id="b-bed" style="position:static">OFF</span>', 'Target 0°C')}
        <div class="card-body">
          <div class="tg" id="tg-bed">Target 0°C</div>
          <div class="tv" id="v-bed">--</div>
          <div class="bar"><i id="bar-bed"></i></div>
          <canvas class="spark" id="sp-bed" height="46"></canvas>
          <div class="row tq" data-k="bed">
            <button class="btn sm" data-t="0">Off</button>
            ${PRE['bed'].slice(0, 3).map(([m, t]) => `<button class="btn sm" data-t="${t}">${m} ${t}°</button>`).join('')}
            <button class="btn sm pri" data-t="set">Set…</button>
          </div>
        </div>
      </div>
    `),
    'card-tune': el(`
      <div class="card" id="c-tune-card" data-card-id="card-tune" draggable="true">
        ${headHtml('LIVE TUNING', 'tune', 'sum-tune', '', 'Spd 100% • Flw 100% • Fan 0%')}
        <div class="card-body" style="margin-top:6px">
          ${[['sp', 'Speed', 'M220', '10', '300', '#38BDF8'], ['fl', 'Flow', 'M221', '50', '150', '#34D399'], ['fn', 'Part Fan', 'M106', '0', '100', '#C084FC']].map(([i, l, , mn, mx, c]) => `<div class="sl"><span style="color:${c}">${l}</span><input type="range" id="r-${i}" min="${mn}" max="${mx}" value="${i === 'fn' ? 0 : 100}" style="accent-color:${c}"><b id="rv-${i}">${i === 'fn' ? 0 : 100}%</b><button class="btn sm" data-r="${i}">↺</button></div>`).join('')}
        </div>
      </div>
    `),
    'card-motion': el(`
      <div class="card col" id="c-motion-card" data-card-id="card-motion" draggable="true">
        ${headHtml('MOTION & POSITION', 'homeaxis', 'sum-motion', '', 'X 0.00 • Y 0.00 • Z 0.00')}
        <div class="card-body col">
          <div class="grid3">${['X', 'Y', 'Z'].map(a => `<div class="axis ${a}"><div class="n">${a}<span class="hb n" id="h${a}">UNHOMED</span></div><div class="c" id="c${a}">0.00</div></div>`).join('')}</div>
          <div class="hdr" style="margin:4px 0 0">MOVE (mm)</div>
          <div class="seg" id="steps"></div>
          <div class="row" style="justify-content:space-around;align-items:center;flex-wrap:wrap;gap:14px">
            <div class="pad"><span></span><button class="jog" data-a="Y" data-s="1">${ICON('up')}</button><span></span><button class="jog" data-a="X" data-s="-1">${ICON('left')}</button><button class="jog home" id="hxy">HOME<br>XY</button><button class="jog" data-a="X" data-s="1">${ICON('right')}</button><span></span><button class="jog" data-a="Y" data-s="-1">${ICON('down')}</button><span></span></div>
            <div class="pad" style="grid-template-columns:var(--jb)"><button class="jog" data-a="Z" data-s="1">${ICON('up')}</button><button class="jog home" id="hz">HOME<br>Z</button><button class="jog" data-a="Z" data-s="-1">${ICON('down')}</button></div>
          </div>
          <button class="btn home" id="hall" style="min-height:42px;width:100%;margin-top:2px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:8px">${ICON('homeaxis', 20)} <b>Home All Axes (G28)</b></button>
          <div class="row" style="align-items:center;margin-top:4px"><span class="sub" style="font-weight:800">BABYSTEP Z</span><span class="mono grow" id="hbz" style="text-align:center;font-weight:800">+0.000</span>
            ${[-0.05, -0.01, 0.01, 0.05].map(d => `<button class="btn sm" data-bz="${d}">${d > 0 ? '+' : ''}${d}</button>`).join('')}</div>
        </div>
      </div>
    `),
    'card-extruder': el(`
      <div class="card col" id="c-extruder-card" data-card-id="card-extruder" draggable="true">
        ${headHtml('EXTRUDER', 'spool', 'sum-extruder', '', '10 mm')}
        <div class="card-body col">
          <div class="seg" id="elen">${[5, 10, 25, 50, 100].map(d => `<button class="step ${d === 10 ? 'on' : ''}" data-l="${d}">${d}</button>`).join('')}</div>
          <div class="grid2"><button class="btn ext hb2" id="hext">⬇ Extrude</button><button class="btn ret hb2" id="hret">⬆ Retract</button></div>
          <div class="sub" id="hestat" style="min-height:15px;text-align:center"></div>
        </div>
      </div>
    `),
    'card-probe': el(`
      <div class="card col" id="c-probe-card" data-card-id="card-probe" draggable="true">
        ${headHtml('PROBE FORCE', 'probe', 'sum-probe', '<span class="pill ok" id="prb-st">○ OPEN</span><button class="btn sm" id="ptare" style="margin-left:4px">⚖ Tare</button>', '0.0 g • OPEN')}
        <div class="card-body col">
          <div class="row" style="align-items:baseline;margin-top:4px">
            <span class="big" id="lcv">0.0 g</span>
            <span class="sub grow" id="lcs" style="text-align:right">trigger: ±25 g</span>
          </div>
          <div class="gauge"><i id="lcg"></i><u></u></div>
        </div>
      </div>
    `),
    'card-console': el(`
      <div class="card col" id="c-console-card" data-card-id="card-console" draggable="true" style="flex:1">
        ${headHtml('G-CODE CONSOLE', 'settings', 'sum-console', '', 'Terminal')}
        <div class="card-body col" style="flex:1">
          <div class="console" id="con"></div>
          <div class="row"><input id="cin" class="grow" placeholder="G-code…  (↑ ↓ history)" autocomplete="off" spellcheck="false"><button class="btn pri" id="csend">Send</button></div>
        </div>
      </div>
    `),
    'card-macros': el(`
      <div class="card col" id="c-macros-card" data-card-id="card-macros" draggable="true">
        ${headHtml('MACROS', 'tune', 'sum-macros', '', 'Macros')}
        <div class="card-body col">
          <input id="mf" placeholder="Filter macros…">
          <div class="macros" id="mac"></div>
        </div>
      </div>
    `)
  };

  // Render cards into columns according to layout
  const renderLayout = () => {
    for (let i = 0; i < 3; i++) {
      const col = root.querySelector(`.hcol[data-col="${i}"]`);
      if (!col) continue;
      col.innerHTML = '';
      currentLayout[i].forEach(id => {
        const card = cardNodes[id];
        if (card) {
          if (collapsedSet.has(id)) card.classList.add('collapsed');
          else card.classList.remove('collapsed');
          col.appendChild(card);
        }
      });
    }
  };
  renderLayout();

  /* quick actions */
  const qa = $('#hqa', root);
  const meshBtn = el(`<button class="qa" id="bl">${ICON('mesh')}<span>Bed Levelling</span></button>`);
  const buildQA = () => {
    qa.innerHTML = '';
    QA.filter(q => !q[5] || q[5] in MR.config || MR.objects.includes(q[5]) || (q[5] === 'bed_mesh' && MR.objects.includes('bed_mesh'))).forEach(q => {
      const b = el(`<button class="qa ${q[3]}" title="${q[2]}">${ICON(q[0])}<span>${q[1]}</span></button>`);
      b.onclick = () => q[4]();
      qa.append(b);
    });
    qa.append(meshBtn);
  };
  buildQA();
  MR.on('config', buildQA);

  /* temps */
  const tstate = (c, t) => t > 0 ? (Math.abs(c - t) <= 2 ? ['ready', 'READY'] : c < t ? ['heating', 'HEATING'] : ['cooling', 'COOLING']) : (c > 45 ? ['cooling', 'COOLING'] : ['off', 'OFF']);
  root.querySelectorAll('.tq').forEach(r => r.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const k = r.dataset.k;
    if (b.dataset.t === 'set') return preheat(k);
    MR.setTemp(k === 'nozzle' ? 'extruder' : 'heater_bed', +b.dataset.t);
  }));
  $('#v-nozzle', root).onclick = () => preheat('nozzle');
  $('#v-bed', root).onclick = () => preheat('bed');

  const spark = (k) => {
    const c = $('#sp-' + k, root);
    if (!c || !c.offsetParent) return; // Skip if card is collapsed or invisible
    const { x, w, h } = Anim.fit(c);
    x.clearRect(0, 0, w, h);
    const d = hist[k];
    if (d.length < 2) return;
    const lo = Math.min(...d.map(p => p[0]), ...d.map(p => p[1])) - 2, hi_ = Math.max(...d.map(p => p[0]), ...d.map(p => p[1])) + 2;
    const Y = v => h - (v - lo) / (hi_ - lo) * h, X = i => i / (d.length - 1) * w;
    x.strokeStyle = 'rgba(251,191,36,.7)'; x.setLineDash([4, 4]); x.beginPath();
    d.forEach((p, i) => i ? x.lineTo(X(i), Y(p[1])) : x.moveTo(X(i), Y(p[1])));
    x.stroke(); x.setLineDash([]);
    const g = x.createLinearGradient(0, 0, 0, h); const col = k === 'nozzle' ? '255,122,0' : '0,229,255';
    g.addColorStop(0, `rgba(${col},.35)`); g.addColorStop(1, `rgba(${col},0)`);
    x.beginPath(); d.forEach((p, i) => i ? x.lineTo(X(i), Y(p[0])) : x.moveTo(X(i), Y(p[0])));
    x.strokeStyle = `rgb(${col})`; x.lineWidth = 2; x.stroke(); x.lineTo(w, h); x.lineTo(0, h); x.fillStyle = g; x.fill(); x.lineWidth = 1;
  };

  /* motion */
  const sb = $('#steps', root);
  STEPS.forEach(s => {
    const b = el(`<button class="step ${s === step ? 'on' : ''}">${s}</button>`);
    b.onclick = () => { step = s; sb.querySelectorAll('.step').forEach(x => x.classList.toggle('on', x === b)); };
    sb.append(b);
  });
  root.querySelectorAll('.jog[data-a]').forEach(b => b.onclick = () => MR.jog(b.dataset.a, step * +b.dataset.s));
  $('#hxy', root).onclick = () => MR.home('X Y');
  $('#hz', root).onclick = () => MR.home('Z');
  $('#hall', root).onclick = () => MR.home();

  root.querySelectorAll('[data-bz]').forEach(b => b.onclick = () => { MR.babystep(+b.dataset.bz); });
  root.querySelectorAll('#elen [data-l]').forEach(b => b.onclick = () => {
    elen = +b.dataset.l;
    root.querySelectorAll('#elen .step').forEach(x => x.classList.toggle('on', x === b));
    const sumExt = $('#sum-extruder', root);
    if (sumExt) sumExt.textContent = `${elen} mm`;
  });

  const doExt = async l => {
    const t = stat().extruder?.temperature || 0, s = $('#hestat', root);
    if (t < 170) { s.textContent = '⚠ Nozzle too cold (' + t.toFixed(0) + '°C) — heat it first'; return; }
    s.textContent = (l > 0 ? 'Extruding ' : 'Retracting ') + Math.abs(l) + ' mm…';
    const ok = await MR.extrude(l, l > 0 ? 5 : 10);
    s.textContent = ok ? '✓ Done' : '⚠ Rejected by Klipper';
  };
  $('#hext', root).onclick = () => doExt(elen);
  $('#hret', root).onclick = () => doExt(-elen);

  /* probe tare button */
  $('#ptare', root).onclick = () => MR.tare().then(() => toast('Load cell zeroed'));

  /* tuning sliders */
  const tun = { sp: v => MR.speed(v), fl: v => MR.flow(v), fn: v => MR.fan(v) }; let tt = {};
  Object.keys(tun).forEach(i => {
    const r = $('#r-' + i, root);
    r.oninput = () => {
      dragging = i; $('#rv-' + i, root).textContent = r.value + '%';
      const sumTune = $('#sum-tune', root);
      if (sumTune) sumTune.textContent = `Spd ${$('#r-sp', root).value}% • Flw ${$('#r-fl', root).value}% • Fan ${$('#r-fn', root).value}%`;
      clearTimeout(tt[i]); tt[i] = setTimeout(() => { tun[i](+r.value); dragging = null; }, 250);
    };
  });
  root.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    const i = b.dataset.r, r = $('#r-' + i, root); r.value = i === 'fn' ? 0 : 100;
    $('#rv-' + i, root).textContent = r.value + '%'; tun[i](+r.value);
    const sumTune = $('#sum-tune', root);
    if (sumTune) sumTune.textContent = `Spd ${$('#r-sp', root).value}% • Flw ${$('#r-fl', root).value}% • Fan ${$('#r-fn', root).value}%`;
  });

  /* console */
  const con = $('#con', root);
  let lastMsg = '', lastMsgTime = 0;
  const addLine = (t, cls) => {
    const now = performance.now();
    // Drop rapid duplicate echoes arriving within 200ms
    if (!cls && t === lastMsg && (now - lastMsgTime) < 200) return;
    if (!cls) { lastMsg = t; lastMsgTime = now; }
    const d = document.createElement('div');
    d.className = 'cl ' + (cls || (/^!!|error/i.test(t) ? 'err' : /^\/\//.test(t) ? 'inf' : ''));
    d.textContent = t; con.append(d);
    while (con.childNodes.length > 200) con.firstChild.remove();
    con.scrollTop = con.scrollHeight;
  };
  const onGcode = t => addLine(t);
  MR.on('gcode', onGcode);
  MR.on('connection', async ok => {
    if (ok) { con.innerHTML = ''; (await MR.gcodeStore(40)).forEach(m => addLine(m.message, m.type === 'command' ? 'cmd' : '')); }
  });
  const send = () => {
    const i = $('#cin', root), v = i.value.trim(); if (!v) return;
    cmdHist.push(v); hi = cmdHist.length; addLine(v, 'cmd'); i.value = '';
    MR.gcode(v, 600000).then(ok => { if (!ok) addLine('!! command failed', 'err'); });
  };
  $('#csend', root).onclick = send;
  $('#cin', root).onkeydown = e => {
    if (e.key === 'Enter') send();
    else if (e.key === 'ArrowUp' && hi > 0) { $('#cin', root).value = cmdHist[--hi]; }
    else if (e.key === 'ArrowDown') { hi = Math.min(cmdHist.length, hi + 1); $('#cin', root).value = cmdHist[hi] || ''; }
  };

  /* macros */
  const drawMac = () => {
    const f = $('#mf', root).value.toLowerCase();
    const m = MR.objects.filter(o => o.startsWith('gcode_macro ')).map(o => o.slice(12)).filter(n => !n.startsWith('_') && n.toLowerCase().includes(f)).sort();
    $('#mac', root).innerHTML = '';
    m.forEach(n => {
      const b = el(`<button class="btn sm">${n}</button>`);
      b.onclick = () => confirmBox('Run macro', `Run <b>${n}</b>?`, 'Run', () => { addLine(n, 'cmd'); MR.gcode(n, 600000); });
      $('#mac', root).append(b);
    });
    if (!m.length) $('#mac', root).innerHTML = '<div class="sub">No macros</div>';
    const sumMac = $('#sum-macros', root);
    if (sumMac) sumMac.textContent = `${m.length} macros`;
  };
  $('#mf', root).oninput = drawMac;
  MR.on('config', drawMac);
  drawMac();

  /* bed levelling mode selector (Normal / KAMP / Off in PRINT_START) */
  let curMeshMode = 'off';
  const applyMeshBtnStyle = mode => {
    curMeshMode = mode;
    meshBtn.dataset.mode = mode;
    meshBtn.dataset.on = mode !== 'off' ? 1 : 0;
    if (mode === 'kamp') {
      meshBtn.querySelector('span').textContent = '⚡ Levelling: KAMP';
      meshBtn.className = 'qa on';
      meshBtn.style.background = 'linear-gradient(135deg, rgba(168,85,247,.28), rgba(56,189,248,.32))';
      meshBtn.style.borderColor = '#C084FC';
      meshBtn.style.color = '#F3E8FF';
    } else if (mode === 'normal') {
      meshBtn.querySelector('span').textContent = '⊞ Levelling: Normal';
      meshBtn.className = 'qa on';
      meshBtn.style.background = '';
      meshBtn.style.borderColor = '';
      meshBtn.style.color = '';
    } else {
      meshBtn.querySelector('span').textContent = '⊞ Levelling: Off';
      meshBtn.className = 'qa off';
      meshBtn.style.background = '';
      meshBtn.style.borderColor = '';
      meshBtn.style.color = '';
    }
  };
  const meshState = async () => {
    try {
      const res = await MR.checkStartGcodeMesh();
      applyMeshBtnStyle(res.mode);
    } catch (e) {}
  };
  meshBtn.onclick = async () => {
    await meshState();
    const cur = curMeshMode;
    const modes = [
      ['normal', '⊞  Normal (Saved Bed Mesh)', 'Loads saved default mesh (BED_MESH_PROFILE LOAD=default) — Fast start, full bed', '#10B981'],
      ['kamp', '⚡  KAMP (Adaptive Mesh)', 'Probes only the print area before each print (KAMP_Settings.cfg + BED_MESH_CALIBRATE)', '#C084FC'],
      ['off', '✕  Levelling Off', 'Disables automatic bed mesh loading and probing in PRINT_START', '#EF4444']
    ];
    const n = el(`<div class="dlg" style="max-width:520px;border:1.5px solid rgba(0,229,255,.45)">
      <div class="row" style="align-items:center;margin-bottom:6px">
        <div style="width:28px;color:#00E5FF">${ICON('mesh')}</div>
        <div class="grow">
          <h3 style="margin:0;font-size:17px">Bed Levelling Mode (PRINT_START)</h3>
          <div class="sub">Select how printer.cfg handles bed mesh at the start of every print</div>
        </div>
        <button class="x" id="bl-x">✕</button>
      </div>
      <div class="col" style="gap:10px;margin:12px 0" id="bl-opts"></div>
      <div class="row" style="justify-content:flex-end;margin-top:8px">
        <button class="btn" id="bl-can">Cancel</button>
      </div>
    </div>`);
    const close = modal(n);
    $('#bl-x', n).onclick = $('#bl-can', n).onclick = close;
    const optsBox = $('#bl-opts', n);
    modes.forEach(([key, title, desc, color]) => {
      const isCur = key === cur;
      const card = el(`<button class="box col" data-mode="${key}" style="text-align:left;cursor:pointer;transition:all .15s;border:1.5px solid ${isCur ? color : 'rgba(255,255,255,.12)'};background:${isCur ? 'rgba(15,23,42,.95)' : 'rgba(15,23,42,.55)'};padding:12px 14px;border-radius:12px">
        <div class="row" style="align-items:center;justify-content:space-between;width:100%">
          <span style="font-size:14.5px;font-weight:800;color:${isCur ? color : '#F8FAFC'}">${title}</span>
          ${isCur ? `<span class="pill" style="color:${color};border-color:${color};background:rgba(255,255,255,.06)">ACTIVE</span>` : ''}
        </div>
        <div class="sub" style="font-size:12px;color:#94A3B8;margin-top:4px;line-height:1.35">${desc}</div>
      </button>`);
      card.onclick = async () => {
        close();
        meshBtn.disabled = true;
        meshBtn.querySelector('span').textContent = `Applying ${key.toUpperCase()}…`;
        try {
          await MR.setStartGcodeMeshMode(key);
          applyMeshBtnStyle(key);
          toast(`✓ Bed Levelling set to ${key.toUpperCase()} — Klipper restarting…`);
          setTimeout(meshState, 4000);
        } catch (err) {
          toast('⚠ Failed to update printer.cfg: ' + (err.message || err));
          meshState();
        } finally {
          meshBtn.disabled = false;
        }
      };
      optsBox.append(card);
    });
  };

  /* card collapse wiring */
  Object.keys(cardNodes).forEach(id => {
    const card = cardNodes[id];
    const head = card.querySelector('.card-head');
    const collapseBtn = card.querySelector('.card-collapse-btn');

    const toggle = () => {
      card.classList.toggle('collapsed');
      if (card.classList.contains('collapsed')) {
        collapsedSet.add(id);
      } else {
        collapsedSet.delete(id);
        if (id === 'card-nozzle') setTimeout(() => spark('nozzle'), 50);
        if (id === 'card-bed') setTimeout(() => spark('bed'), 50);
      }
      saveCollapsed();
    };

    collapseBtn.onclick = e => {
      e.stopPropagation();
      toggle();
    };

    head.onclick = e => {
      if (e.target.closest('button, input, select, .card-handle, .badge, .pill')) return;
      toggle();
    };
  });

  /* drag-and-drop & rearrangement */
  let draggedCard = null;
  Object.values(cardNodes).forEach(card => {
    card.addEventListener('dragstart', e => {
      draggedCard = card;
      card.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.cardId);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      draggedCard = null;
      root.querySelectorAll('.hcol').forEach(c => c.classList.remove('drag-over'));
      saveLayout();
    });
  });

  const cols = root.querySelectorAll('.hcol');
  cols.forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault();
      col.classList.add('drag-over');
      if (!draggedCard) return;

      const cardsInCol = Array.from(col.querySelectorAll('.card:not(.is-dragging)'));
      const afterCard = cardsInCol.find(c => {
        const box = c.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });

      if (afterCard) {
        col.insertBefore(draggedCard, afterCard);
      } else {
        col.appendChild(draggedCard);
      }
    });

    col.addEventListener('dragleave', e => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('drag-over');
      }
    });

    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      saveLayout();
    });
  });

  /* 1-tap reorder move buttons */
  root.querySelectorAll('.btn-card-mv').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const card = btn.closest('.card');
      const col = card.parentElement;
      const colIdx = parseInt(col.dataset.col, 10);
      const dir = btn.dataset.dir;

      if (dir === 'up') {
        const prev = card.previousElementSibling;
        if (prev) col.insertBefore(card, prev);
      } else if (dir === 'down') {
        const next = card.nextElementSibling;
        if (next) col.insertBefore(next, card);
      } else if (dir === 'left') {
        const targetColIdx = (colIdx - 1 + 3) % 3;
        const targetCol = root.querySelector(`.hcol[data-col="${targetColIdx}"]`);
        if (targetCol) targetCol.appendChild(card);
      } else if (dir === 'right') {
        const targetColIdx = (colIdx + 1) % 3;
        const targetCol = root.querySelector(`.hcol[data-col="${targetColIdx}"]`);
        if (targetCol) targetCol.appendChild(card);
      }
      saveLayout();
    };
  });

  /* rearrange toggle & reset layout */
  const btnRearrange = $('#h-rearrange', root);
  const btnReset = $('#h-reset-layout', root);
  let isRearranging = false;

  btnRearrange.onclick = () => {
    isRearranging = !isRearranging;
    root.classList.toggle('rearrange-mode', isRearranging);
    btnRearrange.classList.toggle('active', isRearranging);
    btnRearrange.textContent = isRearranging ? '✓ Done Rearranging' : '⇄ Rearrange';
    btnReset.style.display = isRearranging ? 'inline-flex' : 'none';
  };

  btnReset.onclick = () => {
    localStorage.removeItem('home_card_layout');
    localStorage.removeItem('home_collapsed');
    currentLayout = DEF_LAYOUT.map(c => [...c]);
    collapsedSet.clear();
    Object.values(cardNodes).forEach(c => c.classList.remove('collapsed'));
    renderLayout();
    isRearranging = false;
    root.classList.remove('rearrange-mode');
    btnRearrange.classList.remove('active');
    btnRearrange.textContent = '⇄ Rearrange';
    btnReset.style.display = 'none';
    toast('✓ Home layout reset to default');
    setTimeout(() => { spark('nozzle'); spark('bed'); }, 50);
  };

  /* status updates */
  let lastH = 0;
  const setChip = (id, txt, cls) => { const c = $('#' + id, root); if (c) { c.querySelector('b').textContent = txt; c.className = 'hchip ' + (cls || ''); } };

  MR.on('status', s => {
    const e = s.extruder || {}, b = s.heater_bed || {};
    [['nozzle', e, 300], ['bed', b, 120]].forEach(([k, h, mx]) => {
      const c = h.temperature || 0, t = h.target || 0;
      const vEl = $('#v-' + k, root);
      if (vEl) vEl.textContent = c.toFixed(1) + '°C';
      const tgEl = $('#tg-' + k, root);
      if (tgEl) tgEl.textContent = 'Target ' + Math.round(t) + '°C';
      const [cl, tx] = tstate(c, t);
      const bg = $('#b-' + k, root);
      if (bg) { bg.className = 'badge ' + cl; bg.textContent = tx; }
      const br = $('#bar-' + k, root);
      if (br) {
        br.style.width = Math.min(100, c / Math.max(1, t || mx) * 100) + '%';
        br.style.background = t > 0 && Math.abs(c - t) <= 2 ? 'linear-gradient(90deg,#F59E0B,#EF4444)' : c < 45 ? 'linear-gradient(90deg,#00D2FF,#2563EB)' : 'linear-gradient(90deg,#F59E0B,#FB923C)';
      }
      const sumEl = $('#sum-' + k, root);
      if (sumEl) sumEl.textContent = `${c.toFixed(1)}°C / ${Math.round(t)}°C`;
    });

    if (Date.now() - lastH > 1500) {
      lastH = Date.now();
      [['nozzle', e], ['bed', b]].forEach(([k, h]) => { hist[k].push([h.temperature || 0, h.target || 0]); if (hist[k].length > 120) hist[k].shift(); spark(k); });
    }

    const tp = s.toolhead || {}, gm = s.gcode_move || {}, pos = gm.gcode_position || tp.position || [0, 0, 0, 0], hm = tp.homed_axes || '';
    ['X', 'Y', 'Z'].forEach((a, i) => {
      const cEl = $('#c' + a, root);
      if (cEl) cEl.textContent = (pos[i] ?? 0).toFixed(2);
      const h = hm.includes(a.toLowerCase()), hb = $('#h' + a, root);
      if (hb) {
        hb.className = 'hb ' + (h ? 'y' : 'n');
        hb.textContent = h ? 'HOMED' : 'UNHOMED';
      }
    });

    const sumMotion = $('#sum-motion', root);
    if (sumMotion) sumMotion.textContent = `X ${(pos[0] ?? 0).toFixed(1)} • Y ${(pos[1] ?? 0).toFixed(1)} • Z ${(pos[2] ?? 0).toFixed(2)}`;

    const zo = gm.homing_origin ? gm.homing_origin[2] : 0;
    const hbz = $('#hbz', root);
    if (hbz) hbz.textContent = (zo >= 0 ? '+' : '') + zo.toFixed(3);

    const rSp = $('#r-sp', root), rFl = $('#r-fl', root), rFn = $('#r-fn', root);
    if (dragging !== 'sp' && rSp) { rSp.value = Math.round((gm.speed_factor || 1) * 100); $('#rv-sp', root).textContent = rSp.value + '%'; }
    if (dragging !== 'fl' && rFl) { rFl.value = Math.round((gm.extrude_factor || 1) * 100); $('#rv-fl', root).textContent = rFl.value + '%'; }
    if (dragging !== 'fn' && s.fan && rFn) { rFn.value = Math.round((s.fan.speed || 0) * 100); $('#rv-fn', root).textContent = rFn.value + '%'; }

    const sumTune = $('#sum-tune', root);
    if (sumTune) sumTune.textContent = `Spd ${rSp?.value || 100}% • Flw ${rFl?.value || 100}% • Fan ${rFn?.value || 0}%`;

    const wh = s.webhooks || {}, ps = s.print_stats || {}, bm = s.bed_mesh || {};
    setChip('c-klippy', (wh.state || '--').toUpperCase(), wh.state === 'ready' ? 'ok' : wh.state ? 'bad' : '');
    setChip('c-print', (ps.state || '--').toUpperCase(), ps.state === 'printing' ? 'ok' : ps.state === 'error' ? 'bad' : ps.state === 'paused' ? 'warn' : '');
    const meshLabel = curMeshMode === 'kamp' ? ((bm.profile_name || 'KAMP') + ' (KAMP)') : curMeshMode === 'off' ? 'OFF' : (bm.profile_name || 'NONE');
    setChip('c-mesh', meshLabel, curMeshMode === 'kamp' || bm.profile_name ? 'ok' : '');

    const sc = s.configfile?.save_config_pending;
    setChip('c-save', sc ? 'SAVE PENDING' : 'OK', sc ? 'warn' : 'ok');
    if (sc) $('#c-save', root).onclick = () => confirmBox('SAVE_CONFIG', 'Save pending changes and restart Klipper?', 'Save', () => MR.saveConfig());

    // Probe status & load cell force
    const lc = s.load_cell_probe || s.load_cell || {};
    const prb = s.probe || {};
    const trig = parseFloat((MR.config.load_cell_probe || {}).trigger_force) || 25;

    const isTriggered = Boolean(lc.last_query === true || lc.last_query === 1 || lc.last_query === 'TRIGGERED' || prb.last_query === true || prb.last_query === 1 || s.query_endstops?.last_query?.stepper_z === 1 || s.query_endstops?.last_query?.z === 1);

    const prbBadge = $('#prb-st', root);
    if (prbBadge) {
      prbBadge.textContent = isTriggered ? '● TRIGGERED' : '○ OPEN';
      prbBadge.className = 'pill ' + (isTriggered ? 'bad' : 'ok');
    }

    if (lc.force_g !== undefined) {
      const g = lc.force_g;
      const lcv = $('#lcv', root);
      if (lcv) {
        lcv.textContent = (g >= 0 ? '+' : '') + g.toFixed(1) + ' g';
        lcv.style.color = isTriggered ? '#EF4444' : Math.abs(g) > trig ? '#FBBF24' : '#34D399';
      }
      const lcs = $('#lcs', root);
      if (lcs) lcs.textContent = 'trigger: ±' + trig + ' g';
      const gi = $('#lcg', root);
      if (gi) {
        gi.style.left = Math.max(2, Math.min(98, (50 + (g / trig) * 25))) + '%';
      }
      const sumProbe = $('#sum-probe', root);
      if (sumProbe) sumProbe.textContent = `${(g >= 0 ? '+' : '') + g.toFixed(1)} g • ${isTriggered ? 'TRIGGERED' : 'OPEN'}`;
    }
  });

  MR.on('config', meshState);
  return {
    show() {
      meshState();
      spark('nozzle');
      spark('bed');
    }
  };
})();
