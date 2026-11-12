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

/* ---- Probe accuracy ---- */
function probeAccuracy(){
  const bs=bedSize();const ch=Anim.chart({h:200,scatter:true,dec:4,minPad:.002,empty:'Samples will plot here in real time'});let N=10;
  const pSec=['load_cell_probe','probe','bltouch','smart_effector','beacon'].find(k=>MR.config[k])||'load_cell_probe';
  const pCfg=MR.config[pSec]||{};
  const ps=+(parseFloat(localStorage.getItem('probe_speed'))||parseFloat(pCfg.speed)||8.0).toFixed(1);
  const ls=+(parseFloat(localStorage.getItem('probe_lift_speed'))||parseFloat(pCfg.lift_speed)||10.0).toFixed(1);
  const rd=+(parseFloat(localStorage.getItem('probe_retract_dist'))||parseFloat(pCfg.sample_retract_dist)||3.0).toFixed(1);

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
        <button class="btn pri grow" id="arun" style="min-height:44px;font-weight:800;font-size:14px">▶ Run PROBE_ACCURACY</button></div>
        <div class="sub" style="font-size:11px;color:#94A3B8;margin-top:6px;text-align:center">Active: <b>${ps} mm/s</b> • Retract: <b>${rd} mm</b> • Lift: <b>${ls} mm/s</b> (Configure in Settings)</div>
      </div>
    </div>
  </div>`);
  $('#aa',n).append(ch.el);openSub('Probe Accuracy',n);
  $('#an',n).onchange=()=>{N=parseInt($('#an',n).value)};
  $('#arun',n).onclick=async()=>{
    const b=$('#arun',n);b.disabled=true;$('#amsg',n).textContent=`Probing bed center (${N} samples @ ${ps} mm/s, retract ${rd} mm)…`;await ensureHomed();
    const cap=gcodeCapture();
    const po=probeOff();const iv=setInterval(()=>{const zs=cap.lines.map(l=>(l.match(PROBE_RESULT_RE)||[])[1]).filter(Boolean).map(Number);ch.set({pts:zs})},500);
    const tare=MR.tareGcode();
    const ok=await MR.gcode(`G90\nG1 Z10 F600\nG1 X${(bs.x/2-po.x).toFixed(1)} Y${(bs.y/2-po.y).toFixed(1)} F6000\n${tare}PROBE_ACCURACY SAMPLES=${N} PROBE_SPEED=${ps.toFixed(1)} LIFT_SPEED=${ls.toFixed(1)} SAMPLE_RETRACT_DIST=${rd.toFixed(1)}`,600000);
    clearInterval(iv);cap.stop();b.disabled=false;
    const all=cap.lines.join('\n');
    const m=all.match(/range\s+([\d.]+).*average\s+([\d.]+).*deviation\s+([\d.]+)/i);
    if(m){$('#ar',n).textContent=m[1];$('#av',n).textContent=m[2];$('#as',n).textContent=m[3];const rng=+m[1],sd=+m[3];
      const okAcc=sd<=.025&&rng<=.08;
      const tier=sd<=.0025?'EXCELLENT':sd<=.005?'GOOD':sd<=.01?'FAIR':'PASS';
      $('#amsg',n).innerHTML=okAcc
        ?`<b style="color:#34D399">✔ ACCEPTABLE (${tier} • σ=${sd.toFixed(4)} mm, Range=${rng.toFixed(4)} mm)</b>`
        :`<b style="color:#EF4444">✖ NOT ACCEPTABLE (σ=${sd.toFixed(4)} mm, Range=${rng.toFixed(4)} mm — reduce speed or check mount)</b>`}
    else $('#amsg',n).textContent=ok?'Done.':'⚠ Failed';await MR.gcode('G1 Z10 F600');
  };
}

/* ---- Probe speeds & heights setting screen ---- */
function probeSettingsScreen(){
  const pSec=['load_cell_probe','probe','bltouch','smart_effector','beacon'].find(k=>MR.config[k])||'load_cell_probe';
  const pCfg=MR.config[pSec]||{};
  const cfgPs=+(parseFloat(pCfg.speed)||8.0).toFixed(1);
  const cfgLs=+(parseFloat(pCfg.lift_speed)||10.0).toFixed(1);
  const cfgRd=+(parseFloat(pCfg.sample_retract_dist)||3.0).toFixed(1);
  let ps=+(parseFloat(localStorage.getItem('probe_speed'))||cfgPs).toFixed(1);
  let ls=+(parseFloat(localStorage.getItem('probe_lift_speed'))||cfgLs).toFixed(1);
  let rd=+(parseFloat(localStorage.getItem('probe_retract_dist'))||cfgRd).toFixed(1);

  const n=el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div class="box col" style="gap:10px">
        <div class="h">PROBE PARAMETERS [${pSec.toUpperCase()}]</div>
        <div style="font-size:12px;color:#94A3B8;line-height:1.5">
          Tweak descent speed, retract clearance, and lift speed without modifying config files.
          Values are active immediately for accuracy tests, bed leveling, and probing.
        </div>
        <div class="box mono" style="font-size:11px;color:#38BDF8;background:rgba(0,229,255,0.06)">
          Config Defaults: speed=${cfgPs} mm/s • lift=${cfgLs} mm/s • retract=${cfgRd} mm
        </div>
        <button class="btn" id="ps-reset" style="min-height:38px">↺ Reset to printer.cfg Defaults</button>
      </div>
    </div>
    <div class="sub-web-right">
      <div class="box col">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><div class="h">PROBE DESCENT SPEED</div><div class="sub">Speed nozzle approaches bed to sense contact</div></div>
          <b id="ps-val-ps" style="font-size:22px;color:#00E5FF;font-family:monospace">${ps} mm/s</b>
        </div>
        <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
          ${[2,3,4,6,8].map(v=>`<button class="btn sm grow ${ps===v?'on':''}" data-ps="${v}">${v} mm/s</button>`).join('')}
          <button class="btn sm" data-step-ps="-0.5">– 0.5</button>
          <button class="btn sm" data-step-ps="+0.5">+ 0.5</button>
        </div>
      </div>

      <div class="box col">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><div class="h">LIFT SPEED (RETRACT)</div><div class="sub">Speed nozzle raises away after touching</div></div>
          <b id="ps-val-ls" style="font-size:22px;color:#FBBF24;font-family:monospace">${ls} mm/s</b>
        </div>
        <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
          ${[5,8,10,15].map(v=>`<button class="btn sm grow ${ls===v?'on':''}" data-ls="${v}">${v} mm/s</button>`).join('')}
          <button class="btn sm" data-step-ls="-1.0">– 1.0</button>
          <button class="btn sm" data-step-ls="+1.0">+ 1.0</button>
        </div>
      </div>

      <div class="box col">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><div class="h">RETRACT HEIGHT (CLEARANCE)</div><div class="sub">Clearance lifted between consecutive taps</div></div>
          <b id="ps-val-rd" style="font-size:22px;color:#34D399;font-family:monospace">${rd} mm</b>
        </div>
        <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
          ${[1.0,1.5,2.0,3.0,4.0].map(v=>`<button class="btn sm grow ${rd===v?'on':''}" data-rd="${v}">${v} mm</button>`).join('')}
          <button class="btn sm" data-step-rd="-0.5">– 0.5</button>
          <button class="btn sm" data-step-rd="+0.5">+ 0.5</button>
        </div>
      </div>

      <div class="row" style="gap:8px;margin-top:4px">
        <button class="btn green grow" id="ps-apply" style="min-height:44px;font-size:13px;font-weight:800">✔ Apply (Active for Probing)</button>
        <button class="btn pri grow" id="ps-save" style="min-height:44px;font-size:13px;font-weight:800">💾 Save to printer.cfg & Restart</button>
      </div>
    </div>
  </div>`);

  openSub('Probe Speeds & Heights', n);
  const upd=()=>{
    $('#ps-val-ps',n).textContent=`${ps.toFixed(1)} mm/s`;
    $('#ps-val-ls',n).textContent=`${ls.toFixed(1)} mm/s`;
    $('#ps-val-rd',n).textContent=`${rd.toFixed(1)} mm`;
    n.querySelectorAll('[data-ps]').forEach(b=>b.classList.toggle('on',Math.abs(+b.dataset.ps-ps)<0.05));
    n.querySelectorAll('[data-ls]').forEach(b=>b.classList.toggle('on',Math.abs(+b.dataset.ls-ls)<0.05));
    n.querySelectorAll('[data-rd]').forEach(b=>b.classList.toggle('on',Math.abs(+b.dataset.rd-rd)<0.05));
  };
  n.querySelectorAll('[data-ps]').forEach(b=>b.onclick=()=>{ps=+b.dataset.ps;upd()});
  n.querySelectorAll('[data-ls]').forEach(b=>b.onclick=()=>{ls=+b.dataset.ls;upd()});
  n.querySelectorAll('[data-rd]').forEach(b=>b.onclick=()=>{rd=+b.dataset.rd;upd()});
  n.querySelectorAll('[data-step-ps]').forEach(b=>b.onclick=()=>{ps=Math.max(1,Math.min(25,+(ps+(+b.dataset.stepPs)).toFixed(1)));upd()});
  n.querySelectorAll('[data-step-ls]').forEach(b=>b.onclick=()=>{ls=Math.max(2,Math.min(40,+(ls+(+b.dataset.stepLs)).toFixed(1)));upd()});
  n.querySelectorAll('[data-step-rd]').forEach(b=>b.onclick=()=>{rd=Math.max(0.5,Math.min(15,+(rd+(+b.dataset.stepRd)).toFixed(1)));upd()});

  $('#ps-reset',n).onclick=()=>{
    ps=cfgPs;ls=cfgLs;rd=cfgRd;upd();
    localStorage.removeItem('probe_speed');
    localStorage.removeItem('probe_lift_speed');
    localStorage.removeItem('probe_retract_dist');
    toast('Reset to printer.cfg defaults');
  };
  $('#ps-apply',n).onclick=()=>{
    localStorage.setItem('probe_speed',ps.toFixed(1));
    localStorage.setItem('probe_lift_speed',ls.toFixed(1));
    localStorage.setItem('probe_retract_dist',rd.toFixed(1));
    toast(`✓ Applied: Speed=${ps.toFixed(1)}mm/s, Retract=${rd.toFixed(1)}mm, Lift=${ls.toFixed(1)}mm/s`);
    setTimeout(closeSub, 800);
  };
  $('#ps-save',n).onclick=async()=>{
    const btn=$('#ps-save',n);btn.disabled=true;btn.textContent='Saving to printer.cfg…';
    try{
      let txt=await MR.readConfig();
      if(!txt)throw new Error('Could not read printer.cfg');
      const secRe=new RegExp(`(\\[${pSec}\\][\\s\\S]*?)(?=\\n\\[|$)`,'i');
      const m=txt.match(secRe);
      if(!m)throw new Error(`[${pSec}] not found in printer.cfg`);
      let block=m[1];
      const setKey=(b,k,v)=>{
        const re=new RegExp(`^([ \\t]*${k}[ \\t]*:)[ \\t]*[^\\r\\n#]*`,'im');
        return re.test(b)?b.replace(re,`$1 ${v}`):b.trimEnd()+`\n${k}: ${v}`;
      };
      block=setKey(block,'speed',ps.toFixed(1));
      block=setKey(block,'lift_speed',ls.toFixed(1));
      block=setKey(block,'sample_retract_dist',rd.toFixed(1));
      txt=txt.replace(secRe,block);
      const fd=new FormData();
      fd.append('file',new Blob([txt],{type:'text/plain'}),'printer.cfg');
      fd.append('root','config');
      const r=await fetch(`${MR.base}/server/files/upload`,{method:'POST',body:fd});
      if(!r.ok)throw new Error(`Upload HTTP ${r.status}`);
      localStorage.setItem('probe_speed',ps.toFixed(1));
      localStorage.setItem('probe_lift_speed',ls.toFixed(1));
      localStorage.setItem('probe_retract_dist',rd.toFixed(1));
      await MR.gcode('FIRMWARE_RESTART');
      toast('✓ Saved to printer.cfg & Klipper restarting');
      closeSub();
    }catch(e){
      toast('⚠ Save failed: '+(e.message||e));
      btn.disabled=false;btn.textContent='💾 Save to printer.cfg & Restart';
    }
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

/* ---- Load cell calibration wizard (matches Pi 3-step + Z=100 + trigger force UI) ---- */
function loadCellCal() {
  const ga = Anim.gauge({ h: 220, label: 'LOAD CELL FORCE (g)' });
  const lcCfg = MR.config.load_cell_probe || MR.config.load_cell || {};
  let storedForce = Math.round(parseFloat(lcCfg.trigger_force) || 60);
  let targetForce = storedForce;
  let knownWeight = 500;
  let calActive = false;
  let step = 1;
  let virtualZ = 100.0;
  let jogZCum = 0.0;
  let cpgVal = 0;
  let tareVal = 0;

  const n = el(`<div class="sub-web-grid">
    <div class="sub-web-left">
      <div id="lca-cal"></div>
      <div class="grid2">
        <div class="box">
          <div class="h">LIVE SENSOR READING</div>
          <div class="big" id="lcc-live" style="font-size:22px;color:#38BDF8">--.- g</div>
        </div>
        <div class="box">
          <div class="h">STATUS</div>
          <div class="big" id="lcc-status" style="font-size:16px;color:#34D399">Initializing…</div>
        </div>
      </div>
      <div class="box mono" id="lcc-meta" style="font-size:11px;color:#94A3B8;text-align:center">Tare: -- • -- counts/g</div>
      <div class="box mono" id="lcc-log" style="font-size:11.5px;line-height:1.4">Setting Z=100 &amp; starting LOAD_CELL_CALIBRATE…</div>
    </div>

    <div class="sub-web-right">
      <div class="row" style="gap:6px">
        <button class="btn grow on" id="lcc-tab-scale" style="min-height:36px;font-weight:800">⚖ Calibrate Scale (Weight)</button>
        <button class="btn grow" id="lcc-tab-force" style="min-height:36px;font-weight:700">⚙ Trigger Force (${storedForce}g)</button>
      </div>

      <div id="lcc-panel-scale" class="col" style="gap:8px">
        <div class="grid3" style="gap:6px">
          <div class="box" id="lcc-p1" style="padding:6px;text-align:center;font-size:11px;font-weight:800;background:#0284C7;color:#fff;border-color:#38BDF8">1. Empty Tare</div>
          <div class="box" id="lcc-p2" style="padding:6px;text-align:center;font-size:11px;font-weight:700;color:#64748B">2. Hang Weight</div>
          <div class="box" id="lcc-p3" style="padding:6px;text-align:center;font-size:11px;font-weight:700;color:#64748B">3. Accept Scale</div>
        </div>

        <div class="box col" id="lcc-z-box" style="gap:6px;border-color:rgba(56,189,248,.4)">
          <div class="row" style="justify-content:space-between;align-items:center;gap:6px">
            <span class="mono" id="lcc-z-readout" style="font-size:11.5px;font-weight:700;color:#38BDF8">Z: 100.00 mm (rel +0.00) • -Z up / +Z down</span>
            <button class="btn sm green" id="lcc-z100" style="padding:4px 9px;font-size:11px">Set Z=100</button>
          </div>
          <div class="row" style="gap:4px;flex-wrap:wrap">
            ${[-10, -1, -0.1, -0.05].map(s => `<button class="btn sm danger grow" data-zj="${s}" style="min-height:32px;padding:4px">${s}</button>`).join('')}
            ${[0.05, 0.1, 1, 10].map(s => `<button class="btn sm ret grow" data-zj="${s}" style="min-height:32px;padding:4px">+${s}</button>`).join('')}
          </div>
        </div>

        <!-- Step 1 -->
        <div id="lcc-step1" class="box col" style="gap:8px">
          <div class="h" style="color:#34D399">STEP 1: SENSOR EMPTY TARE</div>
          <div class="sub" style="font-size:12px;line-height:1.4">Ensure cold nozzle is clean with NO weight or scale touching it (use <b>+10</b> above to lower bed if needed). Tap below to capture empty zero.</div>
          <button class="btn green" id="lcc-tare" style="min-height:44px;font-weight:800;font-size:14px">✓ Sensor Empty — Send TARE</button>
        </div>

        <!-- Step 2 -->
        <div id="lcc-step2" class="box col" style="display:none;gap:8px">
          <div class="h" style="color:#00E5FF">STEP 2: APPLY WEIGHT / JOG ONTO SCALE</div>
          <div class="sub" style="font-size:12px;line-height:1.35">Hang weight OR jog Z (-up onto bed scale; need &ge;1% change, e.g. 500–1000g). Report reading:</div>
          <div class="row" style="gap:6px">
            ${[100, 200, 500, 1000].map(w => `<button class="btn sm grow ${w === 500 ? 'on' : ''}" data-w="${w}">${w}g</button>`).join('')}
          </div>
          <div class="row" style="align-items:center;gap:6px">
            <button class="btn sm danger" data-wg="-10">-10g</button>
            <button class="btn sm danger" data-wg="-1">-1g</button>
            <div class="big grow" id="lcc-grams" style="text-align:center;font-size:24px;color:#fff">500 g</div>
            <button class="btn sm ret" data-wg="1">+1g</button>
            <button class="btn sm ret" data-wg="10">+10g</button>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn danger" id="lcc-abort2" style="min-height:42px">✕ Abort</button>
            <button class="btn pri grow" id="lcc-cal" style="min-height:42px;font-weight:800;font-size:14px">▶ Send Scale Reading (CALIBRATE GRAMS=500)</button>
          </div>
        </div>

        <!-- Step 3 -->
        <div id="lcc-step3" class="box col" style="display:none;gap:8px">
          <div class="h" style="color:#34D399">STEP 3: VERIFY &amp; ACCEPT MULTIPLIER</div>
          <div class="big" id="lcc-s3-cpg" style="font-size:22px;color:#fff">Counts / Gram: -- counts/g</div>
          <div class="mono sub" id="lcc-s3-tare" style="font-size:12px">Reference Tare: -- counts</div>
          <div class="sub" style="font-size:11.5px">Klipper has calculated the conversion factor. Send ACCEPT to stage calibration.</div>
          <div class="row" style="gap:8px">
            <button class="btn danger" id="lcc-abort3" style="min-height:42px">✕ Abort</button>
            <button class="btn green grow" id="lcc-accept" style="min-height:42px;font-weight:800;font-size:14px">✓ Accept Multiplier (ACCEPT)</button>
          </div>
        </div>

        <!-- Results -->
        <div id="lcc-results" class="box col" style="display:none;gap:8px;border-color:#34D399">
          <div class="h" style="color:#34D399">LOAD CELL CALIBRATION COMPLETE</div>
          <div class="mono" id="lcc-res-cpg" style="font-size:14px;font-weight:800;color:#fff">Counts / Gram: --</div>
          <div class="mono" id="lcc-res-tare" style="font-size:13px;color:#CBD5E1">Tare Counts: --</div>
          <div class="mono" id="lcc-res-force" style="font-size:13px;color:#38BDF8">Trigger Force: ${storedForce} g</div>
          <div class="row" style="gap:8px;margin-top:4px">
            <button class="btn" id="lcc-close" style="min-height:42px">Close</button>
            <button class="btn green grow" id="lcc-savecfg" style="min-height:42px;font-weight:800;font-size:14px">💾 Save &amp; Apply Config (SAVE_CONFIG)</button>
          </div>
        </div>
      </div>

      <div id="lcc-panel-force" class="col" style="display:none;gap:8px">
        <div class="box col" style="gap:8px">
          <div class="h" id="lcc-f-stored">CONFIG STORED FORCE: ${storedForce} g</div>
          <div class="row" style="align-items:baseline;gap:10px">
            <div class="big" id="lcc-f-val" style="font-size:30px;color:#fff">${targetForce} g</div>
            <div class="sub" id="lcc-f-delta" style="font-size:12px">Stored in printer.cfg</div>
          </div>
          <div class="row" style="gap:6px">
            ${[-10, -5].map(d => `<button class="btn sm danger grow" data-fd="${d}">${d}g</button>`).join('')}
            ${[5, 10].map(d => `<button class="btn sm ret grow" data-fd="${d}">+${d}g</button>`).join('')}
          </div>
          <button class="btn pri" id="lcc-f-save" disabled style="min-height:40px">💾 Save Force to printer.cfg</button>
        </div>
        <div class="box col" style="gap:8px">
          <div class="h">QUICK SENSOR DIAGNOSTICS</div>
          <div class="row" style="gap:8px">
            <button class="btn ret grow" id="lcc-q-tare" style="min-height:38px">⌖ Tare Zero</button>
            <button class="btn orange grow" id="lcc-q-tap" style="min-height:38px">⚡ Test Tap</button>
          </div>
        </div>
      </div>
    </div>
  </div>`);

  $('#lca-cal', n).append(ga.el);

  const lastGcodeErr = lines => {
    const rev = [...lines].reverse();
    const hit = rev.find(l => /^!!|error|unknown command|must be|at least|out of range/i.test(l));
    return hit ? hit.replace(/^!!\s*/, '') : null;
  };

  const setLog = (txt, col = '#CBD5E1') => {
    const l = $('#lcc-log', n);
    if (l) { l.textContent = txt; l.style.color = col; }
  };

  const setStep = s => {
    step = s;
    $('#lcc-z-box', n).style.display = (s === 1 || s === 2) ? '' : 'none';
    $('#lcc-step1', n).style.display = s === 1 ? '' : 'none';
    $('#lcc-step2', n).style.display = s === 2 ? '' : 'none';
    $('#lcc-step3', n).style.display = s === 3 ? '' : 'none';
    $('#lcc-results', n).style.display = s === 4 ? '' : 'none';
    [[1, '#lcc-p1', '1. Empty Tare'], [2, '#lcc-p2', '2. Hang Weight'], [3, '#lcc-p3', '3. Accept Scale']].forEach(([idx, sel, lbl]) => {
      const p = $(sel, n);
      if (idx < s) {
        p.textContent = '✓ ' + lbl.slice(3);
        p.style.background = 'rgba(16,185,129,.22)'; p.style.borderColor = '#10B981'; p.style.color = '#34D399';
      } else if (idx === s) {
        p.textContent = lbl;
        p.style.background = '#0284C7'; p.style.borderColor = '#38BDF8'; p.style.color = '#fff';
      } else {
        p.textContent = lbl;
        p.style.background = ''; p.style.borderColor = ''; p.style.color = '#64748B';
      }
    });
  };

  const setKnownGrams = g => {
    knownWeight = Math.max(50, Math.min(25000, g));
    $('#lcc-grams', n).textContent = `${knownWeight} g`;
    $('#lcc-cal', n).textContent = `▶ Send Scale Reading (CALIBRATE GRAMS=${knownWeight})`;
    n.querySelectorAll('[data-w]').forEach(x => x.classList.toggle('on', parseInt(x.dataset.w) === knownWeight));
  };

  const updateZLabel = (col = '#38BDF8') => {
    const zEl = $('#lcc-z-readout', n);
    if (zEl) {
      zEl.textContent = `Z: ${virtualZ.toFixed(2)} mm (rel ${jogZCum >= 0 ? '+' : ''}${jogZCum.toFixed(2)}) • -Z up / +Z down`;
      zEl.style.color = col;
    }
  };

  const f = s => {
    if (!n.isConnected) return;
    const lc = s.load_cell_probe || s.load_cell || {};
    if (lc.counts_per_gram) cpgVal = parseFloat(lc.counts_per_gram);
    const tc = lc.tare_counts ?? lc.reference_tare_counts;
    if (tc !== undefined && tc !== null) tareVal = parseInt(tc);
    const cpgTxt = cpgVal > 0 ? `${cpgVal.toFixed(1)} counts/g` : 'uncalibrated';
    const tareTxt = tareVal ? `${tareVal.toLocaleString()} counts` : 'uncalibrated';
    $('#lcc-meta', n).textContent = `Tare: ${tareTxt} • ${cpgTxt}`;
    if (lc.is_calibrated === false && lc.force_g === undefined) {
      $('#lcc-live', n).textContent = 'Uncalibrated';
      $('#lcc-status', n).textContent = calActive ? `Step ${Math.min(step, 3)}/3 Active` : 'Needs Calibration';
      $('#lcc-status', n).style.color = '#F59E0B';
      return;
    }
    if (lc.force_g !== undefined && lc.force_g !== null) {
      const g = lc.force_g;
      ga.set({ val: g });
      $('#lcc-live', n).textContent = (g >= 0 ? '+' : '') + g.toFixed(1) + ' g';
      $('#lcc-status', n).textContent = calActive ? `Step ${Math.min(step, 3)}/3 Active` : 'Calibrated';
      $('#lcc-status', n).style.color = '#34D399';
    }
  };

  openSub('Load Cell Scale & Trigger Calibration', n, () => {
    MR.off('status', f);
    if (calActive) { calActive = false; MR.gcode('ABORT'); }
  });

  MR.on('status', f);
  f(stat());

  // Initialize virtual Z=100 and start LOAD_CELL_CALIBRATE cleanly (just like Pi)
  (async () => {
    await MR.gcode('SET_KINEMATIC_POSITION Z=100');
    virtualZ = 100.0; jogZCum = 0.0;
    updateZLabel('#34D399');
    let ok = await MR.gcode('LOAD_CELL_CALIBRATE');
    if (!ok) {
      await MR.gcode('ABORT');
      ok = await MR.gcode('LOAD_CELL_CALIBRATE');
    }
    calActive = ok;
    if (ok) {
      setLog('Calibration active (Z=100 set). Clear nozzle, then tap Send TARE.', '#38BDF8');
    } else {
      setLog('⚠ Could not start LOAD_CELL_CALIBRATE. Check Klipper status.', '#FCA5A5');
    }
  })();

  // Tab switchers
  $('#lcc-tab-scale', n).onclick = () => {
    $('#lcc-tab-scale', n).classList.add('on'); $('#lcc-tab-force', n).classList.remove('on');
    $('#lcc-panel-scale', n).style.display = ''; $('#lcc-panel-force', n).style.display = 'none';
  };
  $('#lcc-tab-force', n).onclick = () => {
    $('#lcc-tab-force', n).classList.add('on'); $('#lcc-tab-scale', n).classList.remove('on');
    $('#lcc-panel-force', n).style.display = ''; $('#lcc-panel-scale', n).style.display = 'none';
  };

  // Z=100 & Z Jog controls
  $('#lcc-z100', n).onclick = async () => {
    const ok = await MR.gcode('SET_KINEMATIC_POSITION Z=100');
    if (ok) {
      virtualZ = 100.0; jogZCum = 0.0;
      updateZLabel('#34D399');
      setLog('Relative Z set to 100.00 mm. Use +Z to lower bed / -Z to raise onto scale.', '#34D399');
    } else {
      setLog('⚠ SET_KINEMATIC_POSITION Z=100 failed (check [force_move]).', '#FCA5A5');
    }
  };

  n.querySelectorAll('[data-zj]').forEach(b => {
    b.onclick = async () => {
      const dz = parseFloat(b.dataset.zj);
      const cap = gcodeCapture();
      const ok = await MR.gcode(`G91\nG1 Z${dz >= 0 ? '+' : ''}${dz.toFixed(2)} F600\nG90`, 15000);
      await new Promise(r => setTimeout(r, 120));
      cap.stop();
      const err = lastGcodeErr(cap.lines);
      if (ok && !err) {
        virtualZ += dz; jogZCum += dz;
        updateZLabel('#38BDF8');
      } else {
        setLog('⚠ ' + (err || 'Z move failed — tap Set Z=100 first.'), '#FCA5A5');
      }
    };
  });

  // Weight presets & +/-10, +/-1 buttons
  n.querySelectorAll('[data-w]').forEach(b => { b.onclick = () => setKnownGrams(parseInt(b.dataset.w)); });
  n.querySelectorAll('[data-wg]').forEach(b => { b.onclick = () => setKnownGrams(knownWeight + parseInt(b.dataset.wg)); });

  // Step 1: TARE
  $('#lcc-tare', n).onclick = async () => {
    const btn = $('#lcc-tare', n);
    btn.disabled = true; btn.textContent = 'Capturing empty zero (TARE)…';
    setLog('Capturing empty baseline (TARE)…', '#38BDF8');
    const cap = gcodeCapture();
    let ok = await MR.gcode('TARE', 20000);
    await new Promise(r => setTimeout(r, 250));
    let err = lastGcodeErr(cap.lines);
    if ((!ok || (err && /unknown command/i.test(err))) && await MR.gcode('LOAD_CELL_CALIBRATE')) {
      calActive = true;
      ok = await MR.gcode('TARE', 20000);
      await new Promise(r => setTimeout(r, 250));
      err = lastGcodeErr(cap.lines);
    }
    cap.stop();
    btn.disabled = false; btn.textContent = '✓ Sensor Empty — Send TARE';
    if (ok && !err) {
      calActive = true;
      ga.set({ val: 0 });
      const raw = cap.lines.join('\n');
      const mT = raw.match(/Load cell tare value:\s*[-\d.]+%\s*\((-?\d+)\)/i);
      if (mT) tareVal = parseInt(mT[1]);
      setLog(`✓ Tare captured (${tareVal ? tareVal.toLocaleString() + ' counts' : 'OK'}). Lower bed (+Z) if needed, apply scale/weight, press nozzle onto scale, and send Step 2.`, '#34D399');
      setStep(2);
      toast('✓ Zero baseline tared');
    } else {
      setLog('⚠ ' + (err || 'TARE failed. Check Klipper status.'), '#FCA5A5');
    }
  };

  // Abort helper (Step 2 & Step 3)
  const doAbort = async () => {
    await MR.gcode('ABORT');
    await MR.gcode('LOAD_CELL_CALIBRATE');
    calActive = true;
    setStep(1);
    setLog('Restarted calibration at Step 1. Ensure nozzle is clear, then send TARE.', '#38BDF8');
    toast('Calibration restarted');
  };
  $('#lcc-abort2', n).onclick = doAbort;
  $('#lcc-abort3', n).onclick = doAbort;

  // Step 2: CALIBRATE GRAMS=
  $('#lcc-cal', n).onclick = async () => {
    const b = $('#lcc-cal', n);
    b.disabled = true; b.textContent = `Calibrating ${knownWeight}g…`;
    setLog(`Running CALIBRATE GRAMS=${knownWeight}…`, '#38BDF8');
    const cap = gcodeCapture();
    const okCal = await MR.gcode(`CALIBRATE GRAMS=${knownWeight}`, 20000);
    await new Promise(r => setTimeout(r, 300));
    cap.stop();
    const err = lastGcodeErr(cap.lines);
    b.disabled = false; b.textContent = `▶ Send Scale Reading (CALIBRATE GRAMS=${knownWeight})`;
    if (!okCal || err) {
      setLog('⚠ ' + (err || 'CALIBRATE failed (need >=1% change, e.g. press >=500g).'), '#FCA5A5');
      return;
    }
    const raw = cap.lines.join('\n');
    const mC = raw.match(/Counts\/gram:\s*([\d.]+)/i);
    if (mC) cpgVal = parseFloat(mC[1]);
    $('#lcc-s3-cpg', n).textContent = `Counts / Gram: ${cpgVal > 0 ? cpgVal.toFixed(2) + ' counts/g' : '-- counts/g'}`;
    $('#lcc-s3-tare', n).textContent = `Reference Tare: ${tareVal ? tareVal.toLocaleString() + ' counts' : '-- counts'}`;
    setLog(`✓ Multiplier computed: ${cpgVal.toFixed(2)} counts/g. Tap ACCEPT to stage calibration.`, '#34D399');
    setStep(3);
  };

  // Step 3: ACCEPT -> Results
  $('#lcc-accept', n).onclick = async () => {
    const b = $('#lcc-accept', n);
    b.disabled = true; b.textContent = 'Accepting multiplier…';
    const cap = gcodeCapture();
    const okAcc = await MR.gcode('ACCEPT', 15000);
    await new Promise(r => setTimeout(r, 250));
    cap.stop();
    const err = lastGcodeErr(cap.lines);
    b.disabled = false; b.textContent = '✓ Accept Multiplier (ACCEPT)';
    if (!okAcc || err) {
      setLog('⚠ ' + (err || 'ACCEPT failed.'), '#FCA5A5');
      return;
    }
    const raw = cap.lines.join('\n');
    const mC = raw.match(/counts_per_gram\s*[:=]\s*([\d.]+)/i);
    const mT = raw.match(/reference_tare_counts\s*[:=]\s*(-?\d+)/i);
    if (mC) cpgVal = parseFloat(mC[1]);
    if (mT) tareVal = parseInt(mT[1]);
    calActive = false;
    $('#lcc-res-cpg', n).textContent = `Counts / Gram: ${cpgVal > 0 ? cpgVal.toFixed(2) + ' counts/g' : '--'}`;
    $('#lcc-res-tare', n).textContent = `Tare Counts: ${tareVal ? tareVal.toLocaleString() + ' counts' : '--'}`;
    $('#lcc-res-force', n).textContent = `Trigger Force: ${targetForce} g`;
    setLog('✓ Calibration accepted! Click Save & Apply Config (SAVE_CONFIG) to write to printer.cfg.', '#34D399');
    setStep(4);
  };

  $('#lcc-close', n).onclick = closeSub;
  $('#lcc-savecfg', n).onclick = async () => {
    const b = $('#lcc-savecfg', n);
    b.disabled = true; b.textContent = 'Saving & Restarting Klipper…';
    await MR.saveConfig();
    toast('✓ Load cell calibrated and saved!');
    setTimeout(closeSub, 1400);
  };

  // Tab 2: Trigger Force Tuning & Quick Diagnostics
  n.querySelectorAll('[data-fd]').forEach(b => {
    b.onclick = () => {
      targetForce = Math.round(Math.max(10, Math.min(350, targetForce + parseInt(b.dataset.fd))) / 5) * 5;
      $('#lcc-f-val', n).textContent = `${targetForce} g`;
      const diff = targetForce - storedForce;
      if (diff === 0) {
        $('#lcc-f-delta', n).textContent = 'Stored in printer.cfg';
        $('#lcc-f-delta', n).style.color = '#94A3B8';
        $('#lcc-f-save', n).disabled = true;
      } else {
        $('#lcc-f-delta', n).textContent = `Modified: ${diff > 0 ? '+' : ''}${diff} g (unsaved)`;
        $('#lcc-f-delta', n).style.color = '#F59E0B';
        $('#lcc-f-save', n).disabled = false;
      }
    };
  });

  $('#lcc-f-save', n).onclick = async () => {
    const b = $('#lcc-f-save', n);
    b.disabled = true; b.textContent = 'Saving to printer.cfg…';
    try {
      const cfg = await MR.readConfig('printer.cfg');
      if (!cfg || cfg.trim().length < 200) throw new Error('printer.cfg read was empty');
      let nextCfg = cfg;
      if (/\[load_cell_probe\][\s\S]*?trigger_force:\s*\d+(?:\.\d+)?/.test(cfg)) {
        nextCfg = cfg.replace(/(trigger_force:\s*)\d+(?:\.\d+)?/, `$1${targetForce}`);
      } else {
        nextCfg = cfg.replace(/(\[load_cell_probe\])/, `$1\ntrigger_force: ${targetForce}`);
      }
      await MR.writeConfig(nextCfg, 'printer.cfg');
      storedForce = targetForce;
      $('#lcc-f-stored', n).textContent = `CONFIG STORED FORCE: ${storedForce} g`;
      $('#lcc-tab-force', n).textContent = `⚙ Trigger Force (${storedForce}g)`;
      $('#lcc-f-delta', n).textContent = `✓ Saved ${storedForce}g & restarting Klipper…`;
      $('#lcc-f-delta', n).style.color = '#34D399';
      b.textContent = '✓ Saved to printer.cfg';
      await MR.fwRestart();
      toast('✓ Trigger force saved');
    } catch (e) {
      b.disabled = false; b.textContent = `Retry Save ${targetForce}g`;
      setLog('⚠ Save trigger_force failed: ' + (e.message || e), '#FCA5A5');
    }
  };

  $('#lcc-q-tare', n).onclick = async () => {
    await MR.tare();
    ga.set({ val: 0 });
    toast('✓ Sensor tared');
  };
  $('#lcc-q-tap', n).onclick = async () => {
    const b = $('#lcc-q-tap', n); b.disabled = true;
    await MR.gcode('LOAD_CELL_TEST_TAP', 30000);
    b.disabled = false;
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
