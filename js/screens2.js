/* Calibrate + Settings pages and their sub-screens */
const CAL = {
  // Bed & First Layer
  bed_mesh: { icon: 'mesh', title: 'Bed Mesh Calibrate', cmd: 'BED_MESH_CALIBRATE', desc: 'Multi-point surface mesh scan & 3D plate view.', custom: 'mesh' },
  z_offset: { icon: 'zoffset', title: 'Z-Offset Adjust', cmd: 'Z_OFFSET_APPLY_PROBE', desc: 'Live nozzle squish & first-layer babystepping.', custom: 'zoff' },
  probe_cal: { icon: 'probe', title: 'Probe Calibrate (Paper Test)', cmd: 'PROBE_CALIBRATE', desc: 'Manual paper drag test for Z probe zero.', custom: 'probe_cal' },
  screws_tilt: { icon: 'screws', title: 'Bed Screws Adjust', cmd: 'BED_SCREWS', desc: 'Bed corner leveling with CW/CCW screw turns.', custom: 'screws' },
  dual_z_trim: { icon: 'gantry', title: 'Manual Dual Z Trim', cmd: 'DUAL_Z_TRIM', desc: 'Dual Z leadscrew alignment & level check.', custom: 'dualz' },
  probe_acc: { icon: 'calibrate', title: 'Probe Accuracy Test', cmd: 'PROBE_ACCURACY', desc: 'Repeatability standard deviation (σ) test.', custom: 'acc' },

  // Gantry Tramming & Multi-Motor Z
  z_tilt: { icon: 'gantry', title: 'Z-Tilt Adjust', cmd: 'Z_TILT_ADJUST', desc: 'Automatic tramming for independent dual/triple Z.', custom: 'z_tilt' },
  quad_gantry_level: { icon: 'gantry', title: 'Quad Gantry Level', cmd: 'QUAD_GANTRY_LEVEL', desc: '4-corner Voron gantry tramming square.', custom: 'qgl' },

  // Toolhead, Load Cell & Resonance
  load_cell_cal: { icon: 'calibrate', title: 'Load Cell Calibrate', cmd: 'LOAD_CELL_CALIBRATE', desc: 'Zero baseline tare & calibration weight wizard.', custom: 'load_cell_cal' },
  load_cell_weight_test: { icon: 'probe', title: 'Load Cell Weight Test', cmd: 'LOAD_CELL_READ', desc: 'Live needle gauge & attached weight readout.', custom: 'lcw' },
  pid_tune: { icon: 'nozzle', title: 'PID Heater Autotune', cmd: 'PID_CALIBRATE', desc: 'Thermal loop autotuning with live temperature curve.', custom: 'pid' },
  input_shaper: { icon: 'shaper', title: 'Input Shaper (ADXL345)', cmd: 'SHAPER_CALIBRATE', desc: 'Resonance frequency sweep & vibration filter tuning.', custom: 'shaper' },

  // Kinematics & Compensation
  axis_twist: { icon: 'twist', title: 'Axis Twist Compensation', cmd: 'AXIS_TWIST_COMPENSATION_CALIBRATE', desc: 'Measure & correct X-rail torsional skew.', custom: 'twist' },
  endstop_phase: { icon: 'endstop', title: 'Endstop Phase Calibrate', cmd: 'ENDSTOP_PHASE_CALIBRATE', desc: 'Microstep stepper phase alignment.', custom: 'phase' },
  delta_cal: { icon: 'delta', title: 'Delta Geometry Calibrate', cmd: 'DELTA_CALIBRATE', desc: 'Delta tower angles & radius geometry calibrate.', custom: 'delta' }
};

function supported(id) {
  const c = MR.config, o = MR.objects;
  const has = (...k) => k.some(x => x in c || o.includes(x));
  const none = !Object.keys(c).length && !o.length;
  const kin = (c.printer?.kinematics || '').toLowerCase();
  if (none) {
    return id !== 'delta_cal';
  }
  switch (id) {
    case 'delta_cal': return kin === 'delta';
    case 'load_cell_cal': case 'load_cell_weight_test': return has('load_cell', 'load_cell_probe', 'hx711');
    case 'quad_gantry_level': return has('quad_gantry_level');
    case 'z_tilt': return has('z_tilt');
    case 'dual_z_trim': return !has('z_tilt', 'quad_gantry_level') && has('probe', 'bltouch', 'load_cell_probe', 'beacon') && kin !== 'delta';
    case 'input_shaper': return has('input_shaper', 'resonance_tester', 'adxl345');
    case 'screws_tilt': return has('screws_tilt_adjust', 'bed_screws');
    case 'axis_twist': return has('axis_twist_compensation');
    case 'endstop_phase': return has('endstop_phase');
    default: return true;
  }
}

function cardHTML(k, i) {
  return `<div class="cc" data-k="${k}">${ICON(i.icon)}<div style="min-width:0"><div class="ti">${i.title}</div><div class="ds">${i.desc}</div><span class="cmd">${i.cmd}</span></div><span class="ar">›</span></div>`;
}

function openCal(k) {
  const i = CAL[k];
  if (!i || !i.custom) return;
  const dispatch = {
    mesh: bedMesh,
    zoff: zOffset,
    probe_cal: probeCal,
    screws: bedScrews,
    dualz: dualZTrim,
    acc: probeAccuracy,
    z_tilt: zTiltSub,
    qgl: quadGantrySub,
    load_cell_cal: loadCellCal,
    lcw: loadCellTest,
    pid: pidTune,
    shaper: inputShaperSub,
    twist: axisTwistSub,
    phase: endstopPhaseSub,
    delta: deltaCalSub
  };
  dispatch[i.custom]?.();
}

App.pages.calibrate = (() => {
  const root = $('#p-calibrate');
  const sections = [
    {
      title: 'BED LEVELING & PROBE CALIBRATION',
      keys: ['bed_mesh', 'z_offset', 'probe_cal', 'screws_tilt', 'dual_z_trim', 'probe_acc']
    },
    {
      title: 'GANTRY LEVELING & TRAMMING',
      keys: ['z_tilt', 'quad_gantry_level']
    },
    {
      title: 'TOOLHEAD, SENSORS & RESONANCE TUNING',
      keys: ['load_cell_cal', 'load_cell_weight_test', 'pid_tune', 'input_shaper']
    },
    {
      title: 'KINEMATICS & COMPENSATION',
      keys: ['axis_twist', 'endstop_phase', 'delta_cal']
    }
  ];

  const draw = () => {
    let html = '';
    sections.forEach(sec => {
      const items = sec.keys.filter(k => CAL[k] && supported(k));
      if (items.length) {
        html += `<div class="hdr">${sec.title}</div><div class="grid2">${items.map(k => cardHTML(k, CAL[k])).join('')}</div>`;
      }
    });
    root.innerHTML = html;
    root.querySelectorAll('.cc').forEach(c => c.onclick = () => openCal(c.dataset.k));
  };

  MR.on('config', draw);
  draw();
  return { show: draw };
})();

App.pages.settings = (() => {
  const root = $('#p-settings');
  const draw = () => {
    const cal = ['bed_mesh', 'z_offset', 'probe_cal', 'screws_tilt', 'dual_z_trim', 'probe_acc', 'pid_tune', 'load_cell_weight_test'].filter(supported);
    root.innerHTML = `${cal.length ? '<div class="hdr">BED & PROBE CALIBRATION SHORTCUTS</div><div class="grid2">' + cal.map(k => cardHTML(k, CAL[k])).join('') + '</div>' : ''}
    <div class="hdr">DIAGNOSTICS, FIRMWARE & HOST</div><div class="grid2">
     <div class="cc" id="s-tests">${ICON('endstop')}<div><div class="ti">Printer Tests</div><div class="ds">Motor buzz, endstops & nozzle touch.</div><span class="cmd">MOTORS • ENDSTOPS</span></div><span class="ar">›</span></div>
     <div class="cc" id="s-fw">${ICON('firmware')}<div><div class="ti">Firmware & MCU Info</div><div class="ds">Live host, MCU & Klipper telemetry.</div><span class="cmd">SYSTEM LOADS</span></div><span class="ar">›</span></div>
     <div class="cc" id="s-fix">${ICON('tune')}<div><div class="ti">Config Health Check</div><div class="ds">Scan PRINT_START for known print-cancel causes.</div><span class="cmd">printer.cfg</span></div><span class="ar">›</span></div>
     <div class="cc" id="s-host">${ICON('settings')}<div><div class="ti">Moonraker Host</div><div class="ds">${MR.base || 'not connected'}</div><span class="cmd">CONNECTION</span></div><span class="ar">›</span></div></div>`;
    root.querySelectorAll('[data-k]').forEach(c => c.onclick = () => openCal(c.dataset.k));
    $('#s-tests').onclick = printerTests; $('#s-fw').onclick = sysLoads; $('#s-fix').onclick = healthCheck;
    $('#s-host').onclick = () => {
      const n = el(`<div class="dlg" style="max-width:420px"><h3>Moonraker Host</h3><div class="sub">e.g. 192.168.0.99:7125 — leave empty for auto</div><input id="hi" style="width:100%;margin:8px 0" value="${localStorage.getItem('moonraker_host') || ''}"><div class="row" style="justify-content:flex-end"><button class="btn" id="hc">Cancel</button><button class="btn pri" id="hs">Save & Reload</button></div></div>`);
      const cl = modal(n); $('#hc', n).onclick = cl; $('#hs', n).onclick = () => { const v = $('#hi', n).value.trim(); v ? localStorage.setItem('moonraker_host', v) : localStorage.removeItem('moonraker_host'); location.reload() }
    };
  };
  MR.on('config', draw); draw(); return { show: draw };
})();
function healthCheck() {
  const sc = Anim.scanner();
  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="sca"></div>
      <div class="box mono sub" style="font-size:11px" id="scinfo">Checking printer.cfg syntax & macros…</div>
    </div>
    <div class="sub-web-right">
      <div class="box col" id="hc-res"><div class="sub">Reading printer.cfg from Moonraker…</div></div>
      <div id="hc-act"></div>
    </div>
  </div>`);
  $('#sca', n).append(sc.el);
  openSub('Config Health Check', n);

  MR.readConfig().then(t => {
    const iss = MoonrakerClient.analyzeConfig(t);
    sc.set({ scanning: false, issues: iss.length });
    const resEl = $('#hc-res', n);
    const actEl = $('#hc-act', n);
    if (iss.length) {
      $('#scinfo', n).textContent = '⚠ Found potential conflict in PRINT_START';
      resEl.innerHTML = `<div class="h w">DETECTED ISSUES (${iss.length})</div>` +
        iss.map(i => `<div class="box" style="margin-top:6px;border-color:rgba(251,191,36,.4);color:#FBBF24">⚠ ${i.msg}</div>`).join('');
      actEl.innerHTML = `<button class="btn pri" id="fx" style="width:100%;min-height:44px;font-weight:800;font-size:14px">⚡ Fix Automatically & Restart Klipper</button>`;
      $('#fx', n).onclick = async () => {
        $('#fx', n).disabled = true;
        $('#fx', n).textContent = 'Applying fix…';
        await MR.writeConfig(MoonrakerClient.fixConfig(t));
        toast('✓ Config updated! Restarting Klipper…');
        await MR.restart();
        closeSub();
      };
    } else {
      $('#scinfo', n).textContent = '✓ Configuration macros verified clean';
      resEl.innerHTML = `<div class="h" style="color:#34D399">CONFIG HEALTHY</div><div style="color:#34D399;font-size:13px;padding:8px 0">✓ No standalone LOAD_CELL_TARE / M109 timing conflicts found in [gcode_macro PRINT_START].</div>`;
    }
  }).catch(() => {
    sc.set({ scanning: false, issues: 1 });
    $('#hc-res', n).innerHTML = '<div class="box sub" style="color:#F87171">⚠ Could not read printer.cfg from printer.</div>';
  });
}
async function sysLoads() {
  const n = el('<div class="col"></div>'); openSub('System Loads & Firmware', n);
  const bar = (l, v, t, c) => `<div class="metric"><div class="cb"><span>${l}</span><span style="color:${c}">${t}</span></div><div class="bar"><i style="width:${Math.min(100, v)}%;background:${c}"></i></div></div>`;
  const run = async () => {
    if (!n.isConnected) return; const d = await MR.systemLoads(); const p = d.proc || {}, sy = d.sys || {};
    const cpu = sy.cpu_info || {}, mem = sy.virtual_memory || {}; const ms = (p.system_cpu_usage?.cpu) || 0; const temp = (p.cpu_temp) || 0;
    const mt = mem.total ? mem.total / 1024 : 0, mu = mem.used ? mem.used / 1024 : (mem.total - mem.available) / 1024;
    const mcus = Object.entries(d.mcu || {}).filter(([k]) => k.startsWith('mcu')).map(([k, v]) => { const l = (v.last_stats || {}); return `<div class="box"><b>${k.toUpperCase()}</b> ${v.mcu_constants?.MCU || ''}<div class="sub">${v.mcu_version || ''}</div>${bar('Awake', (l.mcu_awake || 0) * 100, ((l.mcu_awake || 0) * 100).toFixed(1) + '%', '#34D399')}<div class="sub">Clock ${((v.mcu_constants?.CLOCK_FREQ || 0) / 1e6).toFixed(0)} MHz • bytes w/r ${l.bytes_write || 0}/${l.bytes_read || 0} • retransmit ${l.bytes_retransmit || 0}</div></div>` }).join('');
    n.innerHTML = `<div class="grid2"><div class="box"><div class="h">HOST (${cpu.model || cpu.hardware_desc || 'RASPBERRY PI'})</div><div class="sub">${sy.distribution?.name || ''} ${cpu.cpu_desc || ''}</div>${bar('CPU Load', ms, ms.toFixed(1) + '%', '#00E5FF')}${bar('CPU Temp', temp, temp.toFixed(1) + '°C', '#34D399')}${bar('Memory', mt ? mu / mt * 100 : 0, `${mu.toFixed(0)} / ${mt.toFixed(0)} MB`, '#38BDF8')}<div class="sub">Klipper ${MR.info.klippy_state || ''} • Moonraker ${MR.info.moonraker_version || ''}</div></div><div class="box"><div class="h">MICROCONTROLLER (MCU) LOADS</div>${mcus || '<div class="sub">--</div>'}</div></div>`;
    setTimeout(run, 2000)
  }; run();
}
function printerTests() {
  const bz = Anim.stepperBuzz();
  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="bza"></div>
      <div class="box col"><div class="h">ENDSTOP & PROBE STATUS</div><div id="es" class="col"></div><div class="sub mono" id="lcinfo"></div><div class="row" style="margin-top:4px"><button class="btn sm grow" id="esr">⟳ Refresh Endstops</button><button class="btn sm grow" id="tare">⚖ Tare Nozzle</button></div></div>
    </div>
    <div class="sub-web-right">
      <div class="box col"><div class="h">STEPPER MOTOR BUZZ TEST</div>
        <div class="sub" style="font-size:11px;margin-bottom:6px">Sends STEPPER_BUZZ to physically shake each motor coil 1mm back & forth.</div>
        <div class="grid2">${[['X Axis', 'stepper_x'], ['Y Axis', 'stepper_y'], ['Z Axis (Left)', 'stepper_z'], ['Z1 Axis (Right)', 'stepper_z1'], ['Extruder', 'extruder']].map(([l, s]) => `<button class="btn sm" data-b="${s}" ${s === 'stepper_z1' && !('stepper_z1' in MR.config) ? 'disabled' : ''}>⚡ Buzz ${l}</button>`).join('')}</div>
        <button class="btn sm off" id="m84" style="margin-top:8px">🛑 Motors Off (M84)</button>
      </div>
      <div class="box col"><div class="h">AUXILIARY CONTROLS</div>
        <div class="row"><button class="btn sm grow" data-f="255">💨 Fan 100%</button><button class="btn sm grow" data-f="0">💨 Fan Off</button><button class="btn sm grow" id="hall">🏠 Home All</button></div>
      </div>
      <div class="box mono" id="tst" style="font-size:12px">Ready</div>
    </div>
  </div>`);
  $('#bza', n).append(bz.el);
  openSub('Printer Hardware Tests', n);
  const draw = async () => {
    if (!n.isConnected) return;
    const st = await MR.get('/printer/query_endstops/status').catch(() => ({}));
    const lc = stat().load_cell_probe || stat().load_cell || {};
    const fg = lc.force_g ?? 0;
    const trig = parseFloat((MR.config.load_cell_probe || {}).trigger_force) || 25;
    const isZTrig = lc.last_query === true || (st.stepper_z && st.stepper_z !== 'open') || (st.z && st.z !== 'open');
    const rows = [
      ['X-Axis Endstop', st.stepper_x || st.x || 'open'],
      ['Y-Axis Endstop', st.stepper_y || st.y || 'open'],
      ['Z Endstop (Load Cell Probe)', isZTrig ? 'TRIGGERED' : 'open']
    ];
    $('#es', n).innerHTML = rows.map(([l, v]) => {
      const c = v && v !== 'open';
      return `<div class="row box" style="align-items:center;padding:6px"><b class="grow">${l}</b><span class="pill" style="${c ? 'background:#EF4444;color:#fff' : 'color:#34D399'}">${c ? '● TRIGGERED' : '○ OPEN'}</span></div>`;
    }).join('');
    $('#lcinfo', n).textContent = `Force ${fg >= 0 ? '+' : ''}${fg.toFixed(1)} g • trigger threshold ±${trig} g`;
    setTimeout(draw, 1200);
  };
  draw();
  const say = t => $('#tst', n).textContent = t;
  $('#esr', n).onclick = draw; $('#tare', n).onclick = async () => { say('⚖ Taring…'); await MR.tare(); say('✓ Load cell zeroed') };
  n.querySelectorAll('[data-b]').forEach(b => b.onclick = async () => {
    const s = b.dataset.b;
    bz.set({ active: s });
    say('⚡ STEPPER_BUZZ ' + s + '…');
    const ok = await MR.gcode('STEPPER_BUZZ STEPPER=' + s);
    say(ok ? '✓ Stepper buzz done' : '⚠ Buzz failed (needs [force_move])');
    setTimeout(() => bz.set({ active: null }), 2000);
  });
  n.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { MR.gcode('M106 S' + b.dataset.f); say('Fan set') });
  $('#m84', n).onclick = () => { MR.motorsOff(); say('Motors off') }; $('#hall', n).onclick = async () => { say('Homing…'); say(await MR.home() ? '✓ Homed' : '⚠ failed') };
}
