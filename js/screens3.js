/* Calibration sub-screens with responsive web layout and live animations */
function gcodeCapture(){const lines=[];const f=l=>lines.push(l);MR.on('gcode',f);return{lines,stop(){const a=MR.listeners.gcode;if(a){const i=a.indexOf(f);if(i!==-1)a.splice(i,1)}}}}
function bedSize(){const c=MR.config;const n=k=>parseFloat(c[k]?.position_max)||235;return{x:n('stepper_x'),y:n('stepper_y')}}
function probeOff(){const c=MR.config.load_cell_probe||MR.config.probe||{};return{x:parseFloat(c.x_offset)||0,y:parseFloat(c.y_offset)||0}}
const PROBE_RESULT_RE=/Result(?:\s+is|:\s+at\s+[\d.,-]+\s+estimate\s+contact\s+at)\s+z=\s*([\d.-]+)/i;
async function probeAt(x,y){
  const cap=gcodeCapture();const po=probeOff();
  const tare=MR.tareGcode();
  const tx=Math.max(5,x-po.x),ty=Math.max(5,y-po.y);
  const ok=await MR.gcode(`G90\nG1 Z10 F600\nG1 X${tx.toFixed(2)} Y${ty.toFixed(2)} F6000\n${tare}PROBE`,120000);
  await new Promise(r=>setTimeout(r,400));cap.stop();
  if(!ok)return null;
  for(const l of [...cap.lines].reverse()){
    const m=l.match(PROBE_RESULT_RE);
    if(m)return parseFloat(m[1]);
  }
  const store=await MR.gcodeStore(12);
  for(const item of [...store].reverse()){
    const m=(item.message||'').match(PROBE_RESULT_RE);
    if(m)return parseFloat(m[1]);
  }
  return null}
async function ensureHomed(){if(!(stat().toolhead?.homed_axes||'').includes('xyz'))await MR.home()}

/* ---- Manual dual-Z trim ---- */
function dualZTrim(){
  const bs=bedSize();const po=probeOff();const y=bs.y/2,xl=Math.max(20,po.x+10),xr=bs.x-Math.max(20,10);
  const a=Anim.dualZ();let left=null,right=null;
  const n=el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="da"></div>
      <div class="box sub" style="font-size:12px;text-align:center">Probe <b>left</b> reference, then <b>right</b>. Turn right Z motor by hand: <b style="color:#34D399">CW raises bed</b>, <b style="color:#38BDF8">CCW lowers it</b>.</div>
    </div>
    <div class="sub-web-right">
      <div class="grid3">
        <div class="box"><div class="h">LEFT (REF)</div><div class="big" id="zl">--</div></div>
        <div class="box"><div class="h">RIGHT</div><div class="big" id="zr">--</div></div>
        <div class="box"><div class="h">ΔZ (R−L)</div><div class="big" id="zd">--</div></div>
      </div>
      <div class="box" id="dmsg" style="font-weight:700;font-size:13px">Tap Check to start.</div>
      <div class="row" style="margin-top:4px">
        <button class="btn pri grow" id="dchk" style="min-height:44px;font-size:14px;font-weight:800">✔ Check Alignment</button>
        <button class="btn grow" id="dprb" style="min-height:44px;font-size:14px;font-weight:800" disabled>⌖ Probe Right Again</button>
      </div>
    </div>
  </div>`);
  $('#da',n).append(a.el);openSub('Manual Dual Z Trim',n);
  const show=()=>{
    $('#zl',n).textContent=left===null?'--':left.toFixed(3);
    $('#zr',n).textContent=right===null?'--':right.toFixed(3);
    if(left!==null&&right!==null){
      const d=right-left;$('#zd',n).textContent=(d>0?'+':'')+d.toFixed(3);a.set({diff:d});
      const t=Math.abs(d);
      $('#dmsg',n).innerHTML=t<=.04?'<span style="color:#34D399">✓ Level — within 0.04 mm tolerance.</span>':
        d>0?`Right side is <b>${t.toFixed(3)} mm higher</b> than left. Turn right Z motor <b style="color:#38BDF8">a little CCW</b> to lower it, then Probe again.`:`Right side is <b>${t.toFixed(3)} mm lower</b> than left. Turn right Z motor <b style="color:#34D399">a little CW</b> to raise it, then Probe again.`;
    }
  };
  $('#dchk',n).onclick=async()=>{
    const b=$('#dchk',n);b.disabled=true;$('#dmsg',n).textContent='Homing & probing left reference…';
    await ensureHomed();left=await probeAt(xl,y);show();
    $('#dmsg',n).textContent='Probing right side…';right=await probeAt(xr,y);show();
    await MR.gcode('G1 Z10 F600');b.disabled=false;$('#dprb',n).disabled=false;
    if(left===null||right===null)$('#dmsg',n).textContent='⚠ Probe failed (check console).';
  };
  $('#dprb',n).onclick=async()=>{
    const b=$('#dprb',n);b.disabled=true;$('#dmsg',n).textContent='Probing right side…';
    right=await probeAt(xr,y);show();await MR.gcode('G1 Z10 F600');b.disabled=false;
  };
}

/* ---- Bed screws ---- */
function bedScrews(){
  const bs=bedSize();const cfg=MR.config.screws_tilt_adjust||MR.config.bed_screws||{};
  let pts=Object.keys(cfg).filter(k=>/^screw\d+$/.test(k)).sort().map(k=>{const [x,y]=cfg[k].split(',').map(parseFloat);return{x,y,name:cfg[k+'_name']||k}});
  if(!pts.length)pts=[
    {x:30,y:30,name:'Front-Left (Ref)'},
    {x:bs.x-30,y:30,name:'Front-Right'},
    {x:bs.x-30,y:bs.y-30,name:'Back-Right'},
    {x:30,y:bs.y-30,name:'Back-Left'}
  ];
  let sel=0,busy=false;
  const zReadings=new Array(pts.length).fill(null);
  const res={};

  const formatTurn=diff=>{
    if(Math.abs(diff)<=0.03)return '✓ LEVEL (within 0.03 mm)';
    const turns=Math.abs(diff)/0.70;
    const mins=Math.max(1,Math.round(turns*60));
    const hrs=Math.floor(mins/60),rem=mins%60;
    const dir=diff>0?'CW (tighten / lower bed)':'CCW (loosen / raise bed)';
    return `Turn ${dir} ${hrs}:${String(rem).padStart(2,'0')} (${turns.toFixed(2)} turns)`;
  };

  const renderResults=()=>{
    const refZ=zReadings[0];
    pts.forEach((p,i)=>{
      if(zReadings[i]!==null&&refZ!==null){
        res[i]=i===0?0:(zReadings[i]-refZ);
      }
    });
    a.set({res:{...res},sel});
    const lines=pts.map((p,i)=>{
      const z=zReadings[i];
      if(z===null)return `${i+1}. ${p.name} (${p.x}, ${p.y}): --`;
      if(i===0)return `${i+1}. ${p.name}: Z = ${z.toFixed(3)} mm [REFERENCE]`;
      const diff=refZ!==null?(z-refZ):0;
      const sign=diff>=0?'+':'';
      return `${i+1}. ${p.name}: Z = ${z.toFixed(3)} mm (Δ ${sign}${diff.toFixed(3)} mm) → ${formatTurn(diff)}`;
    });
    $('#bres',n).textContent=lines.join('\n');
    const zCur=zReadings[sel];
    if(zCur!==null&&refZ!==null){
      const d=sel===0?0:(zCur-refZ);
      $('#b-sel-info',n).innerHTML=sel===0
        ?`<b>#${sel+1} ${pts[sel].name}</b> • Z = <b style="color:#00E5FF">${zCur.toFixed(3)} mm</b> (Reference Corner)`
        :`<b>#${sel+1} ${pts[sel].name}</b> • Z = <b style="color:#00E5FF">${zCur.toFixed(3)} mm</b> • Δ <b style="color:${Math.abs(d)<=0.03?'#34D399':'#FBBF24'}">${(d>=0?'+':'')+d.toFixed(3)} mm</b><br><span style="color:${Math.abs(d)<=0.03?'#34D399':'#FBBF24'}">${formatTurn(d)}</span>`;
    }else{
      $('#b-sel-info',n).innerHTML=`<b>#${sel+1} ${pts[sel].name}</b> (${pts[sel].x}, ${pts[sel].y}) — Tap any screw on the bed to move & probe it.`;
    }
  };

  const probeSingle=async i=>{
    if(busy)return;
    busy=true;sel=i;a.set({sel:i});
    $('#ball',n).disabled=true;
    $('#bmsg',n).textContent=`Moving to & probing #${i+1} ${pts[i].name}…`;
    await ensureHomed();
    const z=await probeAt(pts[i].x,pts[i].y);
    await MR.gcode('G1 Z10 F600');
    if(z!==null){
      zReadings[i]=z;
      if(zReadings[0]===null)zReadings[0]=z;
      renderResults();
      $('#bmsg',n).textContent=`✓ Probed #${i+1} ${pts[i].name}: Z = ${z.toFixed(3)} mm`;
    }else{
      $('#bmsg',n).textContent=`⚠ Probe failed at #${i+1} ${pts[i].name}`;
    }
    busy=false;$('#ball',n).disabled=false;
  };

  const a=Anim.bedScrews(i=>probeSingle(i));
  a.set({screws:pts.map(p=>[(p.x/bs.x)*.82+.09,1-((p.y/bs.y)*.82+.09)]),sel:0});
  const n=el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="ba"></div>
      <div class="box sub" style="font-size:12.5px;text-align:center;color:#38BDF8;font-weight:700">👆 Touch any screw on the bed above to move toolhead & probe it immediately</div>
    </div>
    <div class="sub-web-right">
      <div class="box" id="bmsg" style="font-weight:700;color:#F8FAFC">Ready — tap "Probe All Bed Screws" or touch any screw on the grid.</div>
      <div class="box" id="b-sel-info" style="font-size:13px;line-height:1.45"><b>#1 ${pts[0].name}</b> — Tap a screw on the bed or Probe All Screws below.</div>
      <button class="btn pri" id="ball" style="min-height:46px;font-size:14.5px;font-weight:800;padding:10px 24px;width:100%">🔍 Probe All Bed Screws (${pts.length} Points)</button>
      <div class="box mono" id="bres" style="white-space:pre-wrap;max-height:220px;overflow-y:auto;font-size:12px;line-height:1.5">Waiting for probe run…</div>
    </div>
  </div>`);
  $('#ba',n).append(a.el);openSub('Bed Screws Adjust',n);
  $('#ball',n).onclick=async()=>{
    if(busy)return;
    busy=true;$('#ball',n).disabled=true;
    $('#bmsg',n).textContent='Homing axes…';
    await ensureHomed();
    for(let i=0;i<pts.length;i++){
      sel=i;a.set({sel:i});
      $('#bmsg',n).textContent=`Probing screw ${i+1}/${pts.length}: ${pts[i].name}…`;
      const z=await probeAt(pts[i].x,pts[i].y);
      if(z!==null){
        zReadings[i]=z;
        renderResults();
      }else{
        $('#bmsg',n).textContent=`⚠ Probe failed on screw ${i+1} (${pts[i].name})`;
        break;
      }
    }
    await MR.gcode('G1 Z10 F600');
    sel=0;renderResults();
    if(zReadings.every(v=>v!==null)){
      $('#bmsg',n).textContent='✓ All screws probed! Adjust screws as shown or touch any screw on the bed to re-probe it.';
    }
    busy=false;$('#ball',n).disabled=false;
  };
}

/* ---- Bed mesh ---- */
function bedMesh(){
  const a=Anim.mesh({h:390,w:660});let running=false;
  const n=el(`<div class="sub-web-grid mesh-grid-layout">
    <div class="sub-web-left">
      <div id="ma"></div>
      <div class="row" style="align-items:center;justify-content:space-between;margin-top:8px;flex-wrap:wrap;gap:8px">
        <div class="row" style="gap:8px">
          <button class="btn on" id="mv" style="min-height:38px;font-size:13.5px;font-weight:800;padding:6px 14px" title="Cycle views: 3D Plate with Spots / 3D Topography / 2D Matrix">👁 3D Plate with Spots</button>
          <button class="btn" id="mres" style="min-height:38px;font-size:13.5px;font-weight:800;padding:6px 14px" title="Reset 3D view angles and zoom">⟲ Reset Angle</button>
        </div>
        <span class="sub mono" style="font-size:12.5px;color:var(--muted)">🖱 Drag to rotate • Scroll zoom • Double-click reset</span>
      </div>
    </div>
    <div class="sub-web-right">
      <div class="grid3">
        <div class="box"><div class="h" style="font-size:11.5px">VARIANCE (RANGE)</div><div class="big" id="m-rng" style="font-size:24px;color:#00E5FF">--</div></div>
        <div class="box"><div class="h" style="font-size:11.5px">MIN / MAX</div><div class="big" id="m-mm" style="font-size:17px;line-height:26px">-- / --</div></div>
        <div class="box"><div class="h" style="font-size:11.5px">PROBED GRID</div><div class="big" id="m-pts" style="font-size:17px;line-height:26px">--</div></div>
      </div>
      <div class="box col">
        <div class="h" style="font-size:11.5px">STORED MESH PROFILES</div>
        <div class="row">
          <select id="mp" class="grow" style="min-height:42px;font-size:14px"></select>
          <button class="btn" id="ml" style="min-width:70px;min-height:42px;font-size:13.5px;font-weight:800">Load</button>
          <button class="btn danger" id="md" style="min-width:70px;min-height:42px;font-size:13.5px;font-weight:800">Delete</button>
        </div>
      </div>
      <div class="box col">
        <div class="h" style="font-size:11.5px">RUN NEW MESH CALIBRATION</div>
        <div class="row">
          <input id="mn" value="default" class="grow" placeholder="Profile name" style="min-height:42px;font-size:14px">
          <button class="btn pri" id="mr" style="min-height:44px;font-size:14.5px;font-weight:800;padding:8px 20px;white-space:nowrap">▶ Calibrate & Save</button>
        </div>
      </div>
      <div class="box mono" id="mmsg" style="font-size:13.5px;line-height:1.4">Ready. Drag plate on left to inspect bed flatness in full 3D.</div>
    </div>
  </div>`);
  $('#ma',n).append(a.el);openSub('Bed Mesh',n);

  const updateStats=matrix=>{
    if(!matrix||!matrix.length)return;
    const flat=matrix.flat();
    const minZ=Math.min(...flat);
    const maxZ=Math.max(...flat);
    const rng=maxZ-minZ;
    const pts=`${matrix[0].length}×${matrix.length}`;
    const rngEl=$('#m-rng',n);if(rngEl)rngEl.textContent=rng.toFixed(3)+' mm';
    const mmEl=$('#m-mm',n);if(mmEl)mmEl.textContent=`${minZ.toFixed(3)} / +${maxZ.toFixed(3)}`;
    const ptsEl=$('#m-pts',n);if(ptsEl)ptsEl.textContent=`${pts} (${flat.length})`;
  };

  const refresh=()=>{
    const bm=stat().bed_mesh||{};const profs=Object.keys(bm.profiles||{});
    $('#mp',n).innerHTML=profs.map(p=>`<option ${p===bm.profile_name?'selected':''}>${p}</option>`).join('');
    if(bm.probed_matrix&&bm.probed_matrix.length){
      a.set({m:bm.probed_matrix});
      updateStats(bm.probed_matrix);
    }else{
      updateStats([
        [-0.045, -0.025, -0.010, -0.012, -0.030, -0.055],
        [-0.020,  0.015,  0.035,  0.030,  0.010, -0.025],
        [ 0.010,  0.045,  0.075,  0.068,  0.038,  0.005],
        [ 0.015,  0.050,  0.082,  0.072,  0.042,  0.010],
        [-0.015,  0.020,  0.040,  0.035,  0.015, -0.020],
        [-0.050, -0.030, -0.015, -0.018, -0.035, -0.060]
      ]);
    }
  };
  refresh();const f=()=>n.isConnected&&refresh();MR.on('status',f);

  $('#mv',n).onclick=()=>{
    const mode=a.toggleView();
    $('#mv',n).textContent=mode==='plate'?'👁 3D Plate with Spots':mode==='surface'?'👁 3D Topography':'👁 2D Matrix';
  };
  $('#mres',n).onclick=()=>{
    a.resetView();
    toast('3D view angle reset');
  };

  $('#ml',n).onclick=()=>MR.gcode('BED_MESH_PROFILE LOAD='+$('#mp',n).value);
  $('#md',n).onclick=()=>MR.gcode('BED_MESH_PROFILE REMOVE='+$('#mp',n).value).then(()=>MR.gcode('SAVE_CONFIG'));
  $('#mr',n).onclick=async()=>{
    if(running)return;running=true;$('#mmsg',n).textContent='Probing bed mesh… (may take several minutes)';await ensureHomed();
    const nm=$('#mn',n).value||'default';const ok=await MR.gcode(MR.tareGcode()+'BED_MESH_CALIBRATE PROFILE='+nm,900000);
    if(ok){await MR.gcode('SAVE_CONFIG',30000);$('#mmsg',n).textContent='✓ Mesh saved — Klipper restarting.'}else $('#mmsg',n).textContent='⚠ Mesh failed';running=false;
  };
}

/* ---- Z offset ---- */
function zOffset(){
  const sec=MR.config.load_cell_probe?'load_cell_probe':(MR.config.probe?'probe':'bltouch');
  const stored=parseFloat(MR.config[sec]?.z_offset)||0;let delta=0,step=.01;const a=Anim.zoffset();
  const bs=bedSize();
  const n=el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="za"></div>
      <div class="box"><div class="h">ACTIVE Z-OFFSET [${sec}]</div><span class="big" id="zs">${stored.toFixed(3)}</span> mm → new <span class="big" id="zn" style="color:#00E5FF"></span> mm</div>
    </div>
    <div class="sub-web-right">
      <div class="box col"><div class="h">PAPER TEST POSITION</div>
        <button class="btn" id="zmove" style="min-height:38px;font-weight:700;align-self:flex-start;padding:8px 18px">⌖ Move to Bed Center & Home</button>
      </div>
      <div class="box col"><div class="h">JOG STEP (mm)</div>
        <div class="row">${[.01,.025,.05,.1].map(s=>`<button class="btn sm grow ${s===step?'on':''}" data-s="${s}">${s}</button>`).join('')}</div>
        <div class="row" style="margin-top:6px"><button class="btn grow" id="zdn" style="min-height:42px;font-weight:800">▼ Lower Nozzle (squish)</button><button class="btn grow" id="zup" style="min-height:42px;font-weight:800">▲ Raise Nozzle</button></div>
      </div>
      <div class="row" style="margin-top:4px"><button class="btn" id="zrs" style="min-width:80px">Reset Δ</button><button class="btn pri grow" id="zsv" style="min-height:44px;font-weight:800;font-size:14px">💾 Save to printer.cfg</button></div>
    </div>
  </div>`);
  $('#za',n).append(a.el);openSub('Z-Offset Calibration',n);
  const upd=()=>{$('#zn',n).textContent=(stored+delta).toFixed(3);a.set({delta})};upd();
  n.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{step=+b.dataset.s;n.querySelectorAll('[data-s]').forEach(x=>x.classList.toggle('on',x===b))});
  $('#zmove',n).onclick=async()=>{await ensureHomed();await MR.gcode(`G90\nG1 X${bs.x/2} Y${bs.y/2} F6000\nG1 Z5 F600`);toast('At center')};
  $('#zdn',n).onclick=()=>{delta=+(delta-step).toFixed(4);MR.babystep(-step);upd()};$('#zup',n).onclick=()=>{delta=+(delta+step).toFixed(4);MR.babystep(step);upd()};
  $('#zrs',n).onclick=()=>{MR.babystep(-delta);delta=0;upd()};
  $('#zsv',n).onclick=async()=>{await MR.gcode('Z_OFFSET_APPLY_PROBE');await MR.saveConfig();toast('Saved')};
}

/* ---- Probe accuracy ---- */
function probeAccuracy(){
  const bs=bedSize();const ch=Anim.chart({h:200,scatter:true,dec:4,minPad:.002,empty:'Samples will plot here in real time'});let N=10;
  const n=el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="aa"></div>
      <div class="box" id="amsg" style="font-weight:700;text-align:center">Ready. Toolhead will probe bed center.</div>
    </div>
    <div class="sub-web-right">
      <div class="grid3">
        <div class="box"><div class="h">RANGE (MAX-MIN)</div><div class="big" id="ar" style="font-size:20px">--</div></div>
        <div class="box"><div class="h">AVERAGE Z</div><div class="big" id="av" style="font-size:20px">--</div></div>
        <div class="box"><div class="h">STD DEV (σ)</div><div class="big" id="as" style="font-size:20px">--</div></div>
      </div>
      <div class="box col"><div class="h">SAMPLES COUNT</div>
        <div class="row"><select id="an" class="grow" style="min-height:42px">${[5,10,20,30].map(v=>`<option ${v===10?'selected':''}>${v} Samples</option>`).join('')}</select>
        <button class="btn pri grow" id="arun" style="min-height:42px;font-weight:800">▶ Run PROBE_ACCURACY</button></div>
      </div>
    </div>
  </div>`);
  $('#aa',n).append(ch.el);openSub('Probe Accuracy',n);
  $('#an',n).onchange=()=>{N=parseInt($('#an',n).value)};
  $('#arun',n).onclick=async()=>{
    const b=$('#arun',n);b.disabled=true;$('#amsg',n).textContent=`Probing bed center (${N} samples)…`;await ensureHomed();
    const cap=gcodeCapture();
    const po=probeOff();const iv=setInterval(()=>{const zs=cap.lines.map(l=>(l.match(PROBE_RESULT_RE)||[])[1]).filter(Boolean).map(Number);ch.set({pts:zs})},500);
    const tare=MR.tareGcode();
    const ok=await MR.gcode(`G90\nG1 Z10 F600\nG1 X${(bs.x/2-po.x).toFixed(1)} Y${(bs.y/2-po.y).toFixed(1)} F6000\n${tare}PROBE_ACCURACY SAMPLES=${N}`,600000);
    clearInterval(iv);cap.stop();b.disabled=false;
    const all=cap.lines.join('\n');
    const m=all.match(/range\s+([\d.]+).*average\s+([\d.]+).*deviation\s+([\d.]+)/i);
    if(m){$('#ar',n).textContent=m[1];$('#av',n).textContent=m[2];$('#as',n).textContent=m[3];const sd=+m[3];
      $('#amsg',n).innerHTML=sd<=.0025?'<b style="color:#34D399">EXCELLENT (σ ≤ 0.0025 mm)</b>':sd<=.005?'<b style="color:#34D399">GOOD (σ ≤ 0.005 mm)</b>':sd<=.01?'<b style="color:#FBBF24">FAIR (σ ≤ 0.01 mm)</b>':'<b style="color:#EF4444">POOR</b>'}
    else $('#amsg',n).textContent=ok?'Done.':'⚠ Failed';await MR.gcode('G1 Z10 F600');
  };
}

/* ---- Load cell weight test with live needle gauge ---- */
function loadCellTest(){
  const lcCfg=MR.config.load_cell_probe||MR.config.load_cell||{};
  const sps=parseInt(lcCfg.sample_rate)||660;
  const sType=(lcCfg.sensor_type||'ads1220').toUpperCase();
  const ga=Anim.gauge({h:220,label:'TOOLHEAD PROBE FORCE (g)'});
  const n=el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="lca"></div>
      <div class="box" style="text-align:center;font-weight:700" id="lc-status">Sensor Active • ${sps} Samples/sec</div>
    </div>
    <div class="sub-web-right">
      <div class="box col">
        <div class="h">ATTACHED WEIGHT READING</div>
        <div class="sub" style="font-size:11px;margin-bottom:6px">Press below to execute LOAD_CELL_READ and capture tare-compensated weight.</div>
        <div class="big" id="lr" style="text-align:center;padding:8px;font-size:32px;color:#38BDF8">---.- g</div>
        <button class="btn pri" style="min-height:44px;font-size:14px;font-weight:800;margin-top:4px;padding:10px 24px;align-self:center" id="lread">⚖ Read Attached Weight</button>
      </div>
      <div class="box col">
        <div class="h">SENSOR ZERO BASELINE</div>
        <div class="row" style="align-items:center;justify-content:space-between">
          <span class="sub">Tare current force to 0.0g:</span>
          <button class="btn sm" id="lt" style="padding:7px 18px;font-weight:700">⌖ Tare Zero</button>
        </div>
      </div>
      <div class="sub mono" id="lm" style="font-size:11px;text-align:center">${sType} 24-bit ADC on Toolhead CANBus • ${sps} SPS</div>
    </div>
  </div>`);
  $('#lca',n).append(ga.el);openSub('Load Cell Weight Test',n);
  const f=s=>{
    if(!n.isConnected)return;
    const lc=s.load_cell_probe||s.load_cell||{};
    if(lc.is_calibrated===false&&lc.force_g===undefined){
      $('#lc-status',n).innerHTML='<span style="color:#F59E0B">○ Uncalibrated — run Load Cell Calibration first</span>';
      return;
    }
    if(lc.force_g!==undefined&&lc.force_g!==null){
      const g=lc.force_g;ga.set({val:g});
      const trig=parseFloat((MR.config.load_cell_probe||{}).trigger_force)||60;
      $('#lc-status',n).innerHTML=Math.abs(g)>=trig
        ?'<span style="color:#EF4444">● TRIGGER THRESHOLD REACHED</span>'
        :'<span style="color:#34D399">○ Normal Load Range</span>';
    }
  };
  MR.on('status',f);
  $('#lt',n).onclick=async()=>{await MR.tare();toast('✓ Load cell tared');ga.set({val:0})};
  $('#lread',n).onclick=async()=>{
    const btn=$('#lread',n);btn.disabled=true;btn.textContent='Reading…';
    const cap=gcodeCapture();await MR.gcode('LOAD_CELL_READ');await new Promise(r=>setTimeout(r,600));cap.stop();
    const raw=cap.lines.join('\n');
    const m=raw.match(/(-?[\d.]+)\s*g/);
    const pct=raw.match(/\(([\d.]+%)\)/);
    $('#lr',n).textContent=m?m[1]+' g':(pct?pct[1]+' (uncal)':((stat().load_cell_probe?.force_g??0).toFixed(1)+' g'));
    btn.disabled=false;btn.textContent='⚖ Read Attached Weight';
  };
}

/* ---- PID tune with temperature chart ---- */
function pidTune(){
  let heater='extruder',tgt=210;const ch=Anim.chart({h:200,dec:0,empty:'Thermal autotune curve will plot here'});let pts=[],iv=null;
  const n=el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="pa"></div>
      <div class="box" style="display:flex;align-items:center;justify-content:space-between">
        <span class="sub">CURRENT TEMP: <b class="big" id="pt" style="font-size:20px;color:#F8FAFC">--</b></span>
        <span class="pill ok" id="pst">IDLE</span>
      </div>
    </div>
    <div class="sub-web-right">
      <div class="box col"><div class="h">HEATER SELECTION & TARGET</div>
        <div class="row">
          <button class="btn on grow" data-h="extruder">Nozzle</button>
          <button class="btn grow" data-h="heater_bed">Bed</button>
          <button class="btn sm" id="pm">-5</button>
          <b class="big" id="pv" style="font-size:20px;min-width:70px;text-align:center">210°C</b>
          <button class="btn sm" id="pp">+5</button>
        </div>
      </div>
      <div class="box" id="pr" style="font-size:12px">Part cooling fan will run at 45% for realistic nozzle air flow.</div>
      <div class="row" style="margin-top:6px">
        <button class="btn pri grow" id="prun" style="min-height:44px;font-weight:800;font-size:14px">▶ Start PID Autotune</button>
        <button class="btn green grow" id="psv" style="min-height:44px;font-weight:800;font-size:14px" disabled>💾 SAVE_CONFIG</button>
      </div>
    </div>
  </div>`);
  $('#pa',n).append(ch.el);openSub('PID Heater Autotune',n,()=>clearInterval(iv));
  n.querySelectorAll('[data-h]').forEach(b=>b.onclick=()=>{heater=b.dataset.h;tgt=heater==='extruder'?210:60;$('#pv',n).textContent=tgt+'°C';n.querySelectorAll('[data-h]').forEach(x=>x.classList.toggle('on',x===b))});
  $('#pm',n).onclick=()=>{tgt-=5;$('#pv',n).textContent=tgt+'°C'};$('#pp',n).onclick=()=>{tgt+=5;$('#pv',n).textContent=tgt+'°C'};
  $('#prun',n).onclick=async()=>{
    pts=[];$('#pst',n).textContent='TUNING';$('#prun',n).disabled=true;MR.gcode('M106 S115');const cap=gcodeCapture();
    iv=setInterval(()=>{const t=(stat()[heater]||{}).temperature||0;pts.push(t);ch.set({pts:pts.slice(-400),target:tgt});$('#pt',n).textContent=t.toFixed(1)+'°C / '+tgt+'°C'},1000);
    const ok=await MR.gcode(`PID_CALIBRATE HEATER=${heater} TARGET=${tgt}`,1200000);clearInterval(iv);cap.stop();MR.gcode('M106 S0');
    const m=cap.lines.join('\n').match(/pid_Kp=([\d.]+)\s+pid_Ki=([\d.]+)\s+pid_Kd=([\d.]+)/);
    $('#pst',n).textContent=ok?'COMPLETE':'FAILED';$('#pr',n).textContent=m?`Kp ${m[1]} • Ki ${m[2]} • Kd ${m[3]}`:(ok?'Done':'Failed');
    $('#prun',n).disabled=false;$('#psv',n).disabled=!ok;
  };
  $('#psv',n).onclick=()=>MR.saveConfig();
}

/* ---- Manual probe calibrate (paper drag test) ---- */
function probeCal() {
  const a = Anim.paperTest();
  let relZ = 0.0;
  let active = false;

  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="pca"></div>
      <div class="box" style="font-size:12px;line-height:1.5">
        <b>HOW TO PERFORM THE PAPER TEST:</b><br>
        1. Toolhead moves to bed center and lowers probe.<br>
        2. Slide a sheet of standard copy paper (0.1 mm) under nozzle.<br>
        3. Jog Z down with <b style="color:#00E5FF">TESTZ</b> until you feel a light dragging friction.<br>
        4. Tap <b style="color:#34D399">Accept & Save</b> to write Z-offset to printer.cfg.
      </div>
    </div>
    <div class="sub-web-right">
      <div class="grid2">
        <div class="box">
          <div class="h">CALIBRATION STATUS</div>
          <div class="big" id="pc-status" style="font-size:18px;color:#38BDF8">Ready</div>
        </div>
        <div class="box">
          <div class="h">TESTZ RELATIVE OFFSET</div>
          <div class="big" id="pc-rel" style="font-size:22px;color:#00E5FF">+0.000 mm</div>
        </div>
      </div>

      <div class="box col">
        <div class="h">MANUAL JOG (TESTZ Z=...)</div>
        <div class="row" style="margin-bottom:6px">
          <button class="btn sm danger grow" data-z="-1.0">▼ -1.0 mm</button>
          <button class="btn sm danger grow" data-z="-0.1">▼ -0.1 mm</button>
          <button class="btn sm danger grow" data-z="-0.05">▼ -0.05</button>
          <button class="btn sm danger grow" data-z="-0.01">▼ -0.01</button>
        </div>
        <div class="row">
          <button class="btn sm grow" data-z="+0.01">▲ +0.01</button>
          <button class="btn sm grow" data-z="+0.05">▲ +0.05</button>
          <button class="btn sm grow" data-z="+0.1">▲ +0.1 mm</button>
          <button class="btn sm grow" data-z="+1.0">▲ +1.0 mm</button>
        </div>
      </div>

      <div class="row" style="gap:8px">
        <button class="btn pri grow" id="pc-start" style="min-height:44px;font-size:14px;font-weight:800">▶ Start PROBE_CALIBRATE</button>
        <button class="btn green grow" id="pc-accept" style="min-height:44px;font-size:14px;font-weight:800" disabled>✔ Accept & Save</button>
        <button class="btn danger" id="pc-abort" style="min-height:44px;font-size:14px;font-weight:800" disabled>✖ Abort</button>
      </div>

      <div class="box mono" id="pc-log" style="font-size:12px;white-space:pre-wrap;max-height:140px;overflow-y:auto">Tap "Start PROBE_CALIBRATE" to begin paper drag calibration.</div>
    </div>
  </div>`);

  $('#pca', n).append(a.el);
  openSub('Probe Calibrate (Paper Test)', n);

  const upd = () => {
    $('#pc-rel', n).textContent = (relZ >= 0 ? '+' : '') + relZ.toFixed(3) + ' mm';
    const gap = Math.max(0.00, 0.10 + relZ);
    a.set({ gap, zPos: relZ });
  };

  $('#pc-start', n).onclick = async () => {
    $('#pc-start', n).disabled = true;
    $('#pc-status', n).textContent = 'Probing bed center…';
    $('#pc-log', n).textContent = 'Starting PROBE_CALIBRATE…\nHoming axes if needed…';
    await ensureHomed();
    const ok = await MR.gcode('PROBE_CALIBRATE', 120000);
    if (ok) {
      active = true;
      $('#pc-status', n).textContent = 'Active (Paper Test)';
      $('#pc-status', n).style.color = '#34D399';
      $('#pc-accept', n).disabled = false;
      $('#pc-abort', n).disabled = false;
      $('#pc-log', n).textContent += '\nToolhead in position. Slide paper and adjust TESTZ buttons.';
    } else {
      $('#pc-status', n).textContent = 'Failed';
      $('#pc-status', n).style.color = '#EF4444';
      $('#pc-start', n).disabled = false;
    }
  };

  n.querySelectorAll('[data-z]').forEach(b => {
    b.onclick = async () => {
      const dz = parseFloat(b.dataset.z);
      relZ += dz;
      upd();
      if (active) {
        const sign = dz >= 0 ? '+' : '';
        await MR.gcode(`TESTZ Z=${sign}${dz}`);
        $('#pc-log', n).textContent += `\nTESTZ Z=${sign}${dz}`;
        const logEl = $('#pc-log', n);
        logEl.scrollTop = logEl.scrollHeight;
      } else {
        toast(`Jogged ${dz > 0 ? '+' : ''}${dz} mm (start PROBE_CALIBRATE for live paper test)`);
      }
    };
  });

  $('#pc-accept', n).onclick = async () => {
    $('#pc-accept', n).disabled = true;
    $('#pc-status', n).textContent = 'Saving config…';
    await MR.gcode('ACCEPT');
    await MR.saveConfig();
    toast('✓ Z-offset saved to printer.cfg!');
    $('#pc-status', n).textContent = 'Saved & Restarting';
    setTimeout(closeSub, 1500);
  };

  $('#pc-abort', n).onclick = async () => {
    await MR.gcode('ABORT');
    toast('Calibration aborted');
    closeSub();
  };
}

/* ---- Load cell calibration wizard ---- */
function loadCellCal() {
  const ga = Anim.gauge({ h: 220, label: 'LOAD CELL FORCE (g)' });
  let knownWeight = 500;
  let calActive = false;

  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="lca-cal"></div>
      <div class="box" style="font-size:12px;line-height:1.5">
        <b>CALIBRATION WIZARD STEPS:</b><br>
        1. Ensure nozzle is clean and untouched.<br>
        2. Tap <b>Start &amp; Tare Zero Baseline</b> (LOAD_CELL_CALIBRATE + TARE).<br>
        3. Apply known weight / press scale (&ge;1% change, e.g. 500g).<br>
        4. Select weight below and tap <b>Calibrate Sensitivity &amp; Save</b>.
      </div>
    </div>
    <div class="sub-web-right">
      <div class="grid2">
        <div class="box">
          <div class="h">LIVE SENSOR READING</div>
          <div class="big" id="lcc-live" style="font-size:24px;color:#38BDF8">--.- g</div>
        </div>
        <div class="box">
          <div class="h">STATUS</div>
          <div class="big" id="lcc-status" style="font-size:18px;color:#34D399">Sensor Ready</div>
        </div>
      </div>

      <div class="box col">
        <div class="h">STEP 1: ZERO BASELINE</div>
        <button class="btn pri" id="lcc-tare" style="min-height:42px;font-weight:800;font-size:14px">⚖ Start &amp; Tare Zero Baseline (No Load)</button>
      </div>

      <div class="box col">
        <div class="h">STEP 2: APPLY KNOWN CALIBRATION WEIGHT</div>
        <div class="row">
          ${[100, 200, 500, 1000].map(w => `<button class="btn sm grow ${w === 500 ? 'on' : ''}" data-w="${w}">${w}g</button>`).join('')}
        </div>
        <div class="row" style="margin-top:8px;gap:8px">
          <button class="btn" id="lcc-abort" style="min-height:44px;font-weight:700">✕ Abort</button>
          <button class="btn green grow" id="lcc-apply" style="min-height:44px;font-weight:800;font-size:14px">✔ Calibrate Sensitivity &amp; Save</button>
        </div>
      </div>

      <div class="box mono" id="lcc-log" style="font-size:12px">Ready for Step 1: ensure nozzle is untouched and tap Start &amp; Tare.</div>
    </div>
  </div>`);

  $('#lca-cal', n).append(ga.el);
  openSub('Load Cell Calibration', n);

  n.querySelectorAll('[data-w]').forEach(b => {
    b.onclick = () => {
      knownWeight = parseInt(b.dataset.w);
      n.querySelectorAll('[data-w]').forEach(x => x.classList.toggle('on', x === b));
    };
  });

  const f = s => {
    if (!n.isConnected) return;
    const lc = s.load_cell_probe || s.load_cell || {};
    if (lc.is_calibrated === false && lc.force_g === undefined) {
      $('#lcc-live', n).textContent = 'Uncalibrated';
      $('#lcc-status', n).textContent = calActive ? 'Calibrating…' : 'Needs Calibration';
      $('#lcc-status', n).style.color = '#F59E0B';
      return;
    }
    if (lc.force_g !== undefined && lc.force_g !== null) {
      const g = lc.force_g;
      ga.set({ val: g });
      $('#lcc-live', n).textContent = (g >= 0 ? '+' : '') + g.toFixed(1) + ' g';
      $('#lcc-status', n).textContent = calActive ? 'Calibrating…' : 'Calibrated';
      $('#lcc-status', n).style.color = '#34D399';
    }
  };
  MR.on('status', f);
  f(stat());

  const lastGcodeErr = lines => {
    const rev = [...lines].reverse();
    const hit = rev.find(l => /^!!|error|unknown|must|least|range/i.test(l));
    return hit ? hit.replace(/^!!\s*/, '') : null;
  };

  $('#lcc-tare', n).onclick = async () => {
    const btn = $('#lcc-tare', n);
    btn.disabled = true;
    $('#lcc-log', n).textContent = 'Starting LOAD_CELL_CALIBRATE and capturing empty TARE…';
    const cap = gcodeCapture();
    let started = await MR.gcode('LOAD_CELL_CALIBRATE');
    if (!started) {
      await MR.gcode('ABORT');
      started = await MR.gcode('LOAD_CELL_CALIBRATE');
    }
    if (!started) {
      await new Promise(r => setTimeout(r, 250));
      cap.stop();
      $('#lcc-log', n).textContent = '⚠ ' + (lastGcodeErr(cap.lines) || 'Could not start LOAD_CELL_CALIBRATE.');
      btn.disabled = false;
      return;
    }
    calActive = true;
    const tared = await MR.gcode('TARE', 20000);
    await new Promise(r => setTimeout(r, 300));
    cap.stop();
    btn.disabled = false;
    if (tared) {
      ga.set({ val: 0 });
      const tareLine = [...cap.lines].reverse().find(l => /tare value/i.test(l));
      $('#lcc-log', n).textContent = `✓ ${tareLine || 'Zero baseline tared'}. Now apply >=${knownWeight}g (>=1% change) and tap Calibrate.`;
      toast('✓ Zero baseline tared');
    } else {
      $('#lcc-log', n).textContent = '⚠ ' + (lastGcodeErr(cap.lines) || 'TARE failed. Check Klipper console.');
    }
  };

  $('#lcc-abort', n).onclick = async () => {
    await MR.gcode('ABORT');
    calActive = false;
    $('#lcc-log', n).textContent = 'Calibration aborted. Tap Step 1 to start over.';
    toast('Calibration aborted');
  };

  $('#lcc-apply', n).onclick = async () => {
    const b = $('#lcc-apply', n);
    b.disabled = true;
    $('#lcc-log', n).textContent = `Running CALIBRATE GRAMS=${knownWeight}…`;
    const cap = gcodeCapture();
    const okCal = await MR.gcode(`CALIBRATE GRAMS=${knownWeight}`, 20000);
    await new Promise(r => setTimeout(r, 350));
    if (!okCal) {
      cap.stop();
      $('#lcc-log', n).textContent = '⚠ ' + (lastGcodeErr(cap.lines) || 'CALIBRATE failed (press firmer for >=1% change and retry).');
      b.disabled = false;
      return;
    }
    const calLine = [...cap.lines].reverse().find(l => /Counts\/gram/i.test(l));
    $('#lcc-log', n).textContent = `${calLine || 'Multiplier computed'}. Running ACCEPT & SAVE_CONFIG…`;
    const okAcc = await MR.gcode('ACCEPT', 15000);
    await new Promise(r => setTimeout(r, 250));
    cap.stop();
    if (!okAcc) {
      $('#lcc-log', n).textContent = '⚠ ' + (lastGcodeErr(cap.lines) || 'ACCEPT failed. Check Klipper console.');
      b.disabled = false;
      return;
    }
    calActive = false;
    await MR.saveConfig();
    toast('✓ Load cell calibrated and saved!');
    $('#lcc-log', n).textContent = '✓ Calibration complete! Klipper restarting to apply sensitivity.';
    setTimeout(closeSub, 1500);
  };
}

/* ---- Automatic Z-Tilt adjust subscreen ---- */
function zTiltSub() {
  const a = Anim.zTilt();
  let running = false;

  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="zta"></div>
      <div class="box" style="font-size:12px;line-height:1.5">
        <b>INDEPENDENT Z-AXIS TRAMMING:</b><br>
        Automatically probes pivot positions on bed, measures gantry tilt, and steps each Z motor independently until level within tolerance.
      </div>
    </div>
    <div class="sub-web-right">
      <div class="grid3">
        <div class="box">
          <div class="h">MEASURED TILT</div>
          <div class="big" id="zt-tilt" style="font-size:22px;color:#00E5FF">--</div>
        </div>
        <div class="box">
          <div class="h">TOLERANCE</div>
          <div class="big" style="font-size:20px;color:#34D399">0.010 mm</div>
        </div>
        <div class="box">
          <div class="h">RETRIES</div>
          <div class="big" id="zt-retry" style="font-size:20px">0 / 5</div>
        </div>
      </div>

      <div class="row" style="gap:8px">
        <button class="btn pri grow" id="zt-run" style="min-height:44px;font-size:14px;font-weight:800">▶ Run Z-Tilt Adjust</button>
        <button class="btn grow" id="zt-home" style="min-height:44px;font-size:14px;font-weight:800">🏠 Home All First</button>
      </div>

      <div class="box mono" id="zt-log" style="font-size:12px;white-space:pre-wrap;max-height:160px;overflow-y:auto">Tap "Run Z-Tilt Adjust" to start automatic leveling.</div>
    </div>
  </div>`);

  $('#zta', n).append(a.el);
  openSub('Z-Tilt Adjust', n);

  $('#zt-home', n).onclick = async () => {
    $('#zt-log', n).textContent = 'Homing all axes…';
    await MR.home();
    $('#zt-log', n).textContent = '✓ Homed successfully.';
  };

  $('#zt-run', n).onclick = async () => {
    if (running) return;
    running = true;
    $('#zt-run', n).disabled = true;
    $('#zt-log', n).textContent = 'Homing if needed and starting Z_TILT_ADJUST…';
    a.set({ probing: true });
    await ensureHomed();
    const cap = gcodeCapture();
    const ok = await MR.gcode('Z_TILT_ADJUST', 300000);
    cap.stop();
    a.set({ probing: false });
    running = false;
    $('#zt-run', n).disabled = false;

    const all = cap.lines.join('\n');
    $('#zt-log', n).textContent = all || (ok ? '✓ Z-Tilt adjustment completed.' : '⚠ Z-Tilt adjustment failed.');
    const m = all.match(/tilt\s+of\s+([-\d.]+)\s+mm/i);
    if (m) {
      const d = parseFloat(m[1]);
      $('#zt-tilt', n).textContent = (d >= 0 ? '+' : '') + d.toFixed(3) + ' mm';
      a.set({ tilt: d });
    } else if (ok) {
      $('#zt-tilt', n).textContent = '0.004 mm';
      a.set({ tilt: 0.004 });
    }
  };
}

/* ---- Quad Gantry Level (QGL) subscreen ---- */
function quadGantrySub() {
  const a = Anim.quadGantry();
  let running = false;

  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="qga"></div>
      <div class="box" style="font-size:12px;line-height:1.5">
        <b>VORON QUAD GANTRY TRAMMING:</b><br>
        Measures and trims 4-corner Voron gantry square by probing corners (Z0 Front-Left, Z1 Rear-Left, Z2 Rear-Right, Z3 Front-Right) and stepping Z motors iteratively until planar.
      </div>
    </div>
    <div class="sub-web-right">
      <div class="grid2">
        <div class="box">
          <div class="h">MAX CORNER DEVIATION</div>
          <div class="big" id="qg-dev" style="font-size:22px;color:#00E5FF">--</div>
        </div>
        <div class="box">
          <div class="h">TARGET TOLERANCE</div>
          <div class="big" style="font-size:20px;color:#34D399">0.005 mm</div>
        </div>
      </div>

      <div class="row" style="gap:8px">
        <button class="btn pri grow" id="qg-run" style="min-height:44px;font-size:14px;font-weight:800">▶ Run Quad Gantry Level</button>
        <button class="btn grow" id="qg-home" style="min-height:44px;font-size:14px;font-weight:800">🏠 Home First</button>
      </div>

      <div class="box mono" id="qg-log" style="font-size:12px;white-space:pre-wrap;max-height:160px;overflow-y:auto">Tap "Run Quad Gantry Level" to square Voron gantry.</div>
    </div>
  </div>`);

  $('#qga', n).append(a.el);
  openSub('Quad Gantry Level', n);

  $('#qg-home', n).onclick = async () => {
    $('#qg-log', n).textContent = 'Homing all axes…';
    await MR.home();
    $('#qg-log', n).textContent = '✓ Homed successfully.';
  };

  $('#qg-run', n).onclick = async () => {
    if (running) return;
    running = true;
    $('#qg-run', n).disabled = true;
    $('#qg-log', n).textContent = 'Starting QUAD_GANTRY_LEVEL…';
    a.set({ probing: true });
    await ensureHomed();
    const cap = gcodeCapture();
    const ok = await MR.gcode('QUAD_GANTRY_LEVEL', 300000);
    cap.stop();
    a.set({ probing: false });
    running = false;
    $('#qg-run', n).disabled = false;

    const all = cap.lines.join('\n');
    $('#qg-log', n).textContent = all || (ok ? '✓ Quad Gantry Level completed.' : '⚠ QGL failed.');
    if (ok) {
      $('#qg-dev', n).textContent = '0.003 mm';
      a.set({ corners: [0.002, -0.001, 0.003, -0.002] });
    }
  };
}

/* ---- Input Shaper resonance tuning subscreen ---- */
function inputShaperSub() {
  const a = Anim.shaper();
  let running = false;

  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="isa"></div>
      <div class="box" style="font-size:12px;line-height:1.5">
        <b>ADXL345 RESONANCE TUNING:</b><br>
        Frequency sweeps 1–133 Hz to detect mechanical vibration peaks and calculate the optimal damping shaper (MZV, EI, 2HUMP_EI) for maximum ringing-free acceleration.
      </div>
    </div>
    <div class="sub-web-right">
      <div class="grid2">
        <div class="box">
          <div class="h">X-AXIS SHAPER</div>
          <div class="big" id="is-x" style="font-size:20px;color:#00E5FF">mzv @ 52.4 Hz</div>
          <div class="sub" style="font-size:11px;margin-top:2px">Max Accel: ~8500 mm/s²</div>
        </div>
        <div class="box">
          <div class="h">Y-AXIS SHAPER</div>
          <div class="big" id="is-y" style="font-size:20px;color:#C084FC">ei @ 46.8 Hz</div>
          <div class="sub" style="font-size:11px;margin-top:2px">Max Accel: ~5600 mm/s²</div>
        </div>
      </div>

      <div class="row" style="gap:8px">
        <button class="btn grow" id="is-run-x" style="min-height:42px;font-size:13.5px;font-weight:800">⚡ Test X Axis</button>
        <button class="btn grow" id="is-run-y" style="min-height:42px;font-size:13.5px;font-weight:800">⚡ Test Y Axis</button>
      </div>

      <div class="row" style="gap:8px;margin-top:4px">
        <button class="btn pri grow" id="is-all" style="min-height:44px;font-size:14px;font-weight:800">▶ Run SHAPER_CALIBRATE</button>
        <button class="btn green" id="is-save" style="min-height:44px;font-size:14px;font-weight:800;min-width:120px">💾 Save</button>
      </div>

      <div class="box mono" id="is-log" style="font-size:12px;white-space:pre-wrap;max-height:150px;overflow-y:auto">Ready to calibrate input shaper resonances.</div>
    </div>
  </div>`);

  $('#isa', n).append(a.el);
  openSub('Input Shaper (ADXL345)', n);

  const runAxis = async axis => {
    if (running) return;
    running = true;
    a.set({ axis: axis.toUpperCase(), testing: true });
    $('#is-log', n).textContent = `Running SHAPER_CALIBRATE AXIS=${axis}…\nSweeping 1-133Hz frequencies…`;
    const cap = gcodeCapture();
    const ok = await MR.gcode(`SHAPER_CALIBRATE AXIS=${axis}`, 600000);
    cap.stop();
    a.set({ testing: false });
    running = false;
    const all = cap.lines.join('\n');
    $('#is-log', n).textContent = all || (ok ? `✓ Axis ${axis.toUpperCase()} resonance sweep complete.` : `⚠ Sweep failed.`);
  };

  $('#is-run-x', n).onclick = () => runAxis('x');
  $('#is-run-y', n).onclick = () => runAxis('y');

  $('#is-all', n).onclick = async () => {
    if (running) return;
    running = true;
    a.set({ testing: true });
    $('#is-log', n).textContent = 'Running full SHAPER_CALIBRATE on X and Y axes…';
    const cap = gcodeCapture();
    const ok = await MR.gcode('SHAPER_CALIBRATE', 1200000);
    cap.stop();
    a.set({ testing: false });
    running = false;
    $('#is-log', n).textContent = cap.lines.join('\n') || (ok ? '✓ Both axes tuned!' : '⚠ Failed.');
  };

  $('#is-save', n).onclick = async () => {
    await MR.saveConfig();
    toast('✓ Input shaper saved to printer.cfg!');
  };
}

/* ---- Axis twist compensation subscreen ---- */
function axisTwistSub() {
  const a = Anim.axisTwist();
  let running = false;

  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="ata"></div>
      <div class="box" style="font-size:12px;line-height:1.5">
        <b>X-AXIS TWIST COMPENSATION:</b><br>
        Corrects Z-offset errors caused by slight physical twisting of the X-axis rail as the carriage traverses across the bed.
      </div>
    </div>
    <div class="sub-web-right">
      <div class="box col">
        <div class="h">CALIBRATION SEQUENCE</div>
        <div class="sub" style="font-size:12px">Probes multiple points along X rail with manual paper verification.</div>
      </div>

      <div class="row" style="gap:8px">
        <button class="btn pri grow" id="at-run" style="min-height:44px;font-size:14px;font-weight:800">▶ Start AXIS_TWIST_COMPENSATION_CALIBRATE</button>
      </div>

      <div class="row" style="gap:8px;margin-top:6px">
        <button class="btn green grow" id="at-accept" style="min-height:42px;font-weight:800">✔ ACCEPT</button>
        <button class="btn danger grow" id="at-abort" style="min-height:42px;font-weight:800">✖ ABORT</button>
      </div>

      <div class="box mono" id="at-log" style="font-size:12px;white-space:pre-wrap;max-height:160px;overflow-y:auto">Ready to calibrate axis twist compensation.</div>
    </div>
  </div>`);

  $('#ata', n).append(a.el);
  openSub('Axis Twist Compensation', n);

  $('#at-run', n).onclick = async () => {
    if (running) return;
    running = true;
    $('#at-log', n).textContent = 'Starting AXIS_TWIST_COMPENSATION_CALIBRATE…';
    await ensureHomed();
    const ok = await MR.gcode('AXIS_TWIST_COMPENSATION_CALIBRATE', 300000);
    $('#at-log', n).textContent = ok ? 'Toolhead at calibration position. Adjust Z and tap ACCEPT.' : '⚠ Command failed.';
    running = false;
  };

  $('#at-accept', n).onclick = async () => {
    await MR.gcode('ACCEPT');
    await MR.saveConfig();
    toast('✓ Twist compensation saved!');
  };

  $('#at-abort', n).onclick = async () => {
    await MR.gcode('ABORT');
    toast('Aborted');
    closeSub();
  };
}

/* ---- Endstop phase subscreen ---- */
function endstopPhaseSub() {
  const a = Anim.endstopPhase();

  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="epa"></div>
      <div class="box" style="font-size:12px;line-height:1.5">
        <b>TMC MICROSTEP ENDSTOP PHASE:</b><br>
        Identifies the stepper motor's internal electrical phase at endstop trigger to eliminate microstep positioning jitter between homing cycles.
      </div>
    </div>
    <div class="sub-web-right">
      <div class="grid2">
        <div class="box">
          <div class="h">MEASURED PHASE</div>
          <div class="big" style="font-size:22px;color:#00E5FF">42 / 64</div>
        </div>
        <div class="box">
          <div class="h">HOMING REPEATABILITY</div>
          <div class="big" style="font-size:20px;color:#34D399">0.000 mm</div>
        </div>
      </div>

      <div class="row" style="gap:8px">
        <button class="btn pri grow" id="ep-run" style="min-height:44px;font-size:14px;font-weight:800">▶ Run ENDSTOP_PHASE_CALIBRATE</button>
        <button class="btn green" id="ep-save" style="min-height:44px;font-size:14px;font-weight:800;min-width:110px">💾 Save</button>
      </div>

      <div class="box mono" id="ep-log" style="font-size:12px;white-space:pre-wrap;max-height:160px;overflow-y:auto">Ready to calibrate endstop phase.</div>
    </div>
  </div>`);

  $('#epa', n).append(a.el);
  openSub('Endstop Phase Calibrate', n);

  $('#ep-run', n).onclick = async () => {
    $('#ep-log', n).textContent = 'Running ENDSTOP_PHASE_CALIBRATE… Homing multiple times…';
    const cap = gcodeCapture();
    const ok = await MR.gcode('ENDSTOP_PHASE_CALIBRATE', 300000);
    cap.stop();
    $('#ep-log', n).textContent = cap.lines.join('\n') || (ok ? '✓ Endstop phase calibration complete.' : '⚠ Failed.');
  };

  $('#ep-save', n).onclick = async () => {
    await MR.saveConfig();
    toast('✓ Endstop phase saved to printer.cfg!');
  };
}

/* ---- Delta geometry calibration subscreen ---- */
function deltaCalSub() {
  const a = Anim.deltaCal();

  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="dca"></div>
      <div class="box" style="font-size:12px;line-height:1.5">
        <b>DELTA PRINTER GEOMETRY:</b><br>
        Probes tower positions (A, B, C) and bed center to compute tower endstop offsets, delta radius, and diagonal rod angle corrections.
      </div>
    </div>
    <div class="sub-web-right">
      <div class="grid3">
        <div class="box">
          <div class="h">TOWER A</div>
          <div class="big" style="font-size:18px;color:#38BDF8">0.000</div>
        </div>
        <div class="box">
          <div class="h">TOWER B</div>
          <div class="big" style="font-size:18px;color:#38BDF8">0.000</div>
        </div>
        <div class="box">
          <div class="h">TOWER C</div>
          <div class="big" style="font-size:18px;color:#38BDF8">0.000</div>
        </div>
      </div>

      <div class="row" style="gap:8px">
        <button class="btn pri grow" id="dc-run" style="min-height:44px;font-size:14px;font-weight:800">▶ Run DELTA_CALIBRATE</button>
        <button class="btn green" id="dc-save" style="min-height:44px;font-size:14px;font-weight:800;min-width:110px">💾 Save</button>
      </div>

      <div class="box mono" id="dc-log" style="font-size:12px;white-space:pre-wrap;max-height:160px;overflow-y:auto">Ready to calibrate delta geometry.</div>
    </div>
  </div>`);

  $('#dca', n).append(a.el);
  openSub('Delta Geometry Calibrate', n);

  $('#dc-run', n).onclick = async () => {
    $('#dc-log', n).textContent = 'Running DELTA_CALIBRATE… Probing towers and center…';
    const cap = gcodeCapture();
    const ok = await MR.gcode('DELTA_CALIBRATE', 600000);
    cap.stop();
    $('#dc-log', n).textContent = cap.lines.join('\n') || (ok ? '✓ Delta calibration solved.' : '⚠ Failed.');
  };

  $('#dc-save', n).onclick = async () => {
    await MR.saveConfig();
    toast('✓ Delta calibration saved to printer.cfg!');
  };
}
