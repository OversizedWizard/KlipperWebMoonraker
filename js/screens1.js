/* Spool page + filament load/unload dialog + Power page */
const PRESETS_F={PLA:[210,60],'PLA+':[215,60],PETG:[240,75],ABS:[250,100],ASA:[255,105],TPU:[220,50],Nylon:[260,90],PC:[270,110],PVA:[215,60],HIPS:[240,100]};
const PALETTE=[['#EF4444','Red'],['#F97316','Orange'],['#F59E0B','Amber'],['#EAB308','Yellow'],['#10B981','Green'],['#06B6D4','Cyan'],['#3B82F6','Blue'],['#8B5CF6','Purple'],['#EC4899','Pink'],['#FFFFFF','White'],['#94A3B8','Silver/Grey'],['#1E293B','Black'],['#78350F','Brown'],['#14B8A6','Teal'],['#6366F1','Indigo'],['#84CC16','Lime']];
const DEF_SPOOLS={1:{name:'Spool 1',type:'PLA',color:'#3B82F6',nozzle:210,bed:60,weight:1000,cap:1000},2:{name:'Spool 2',type:'PETG',color:'#10B981',nozzle:240,bed:75,weight:1000,cap:1000},3:{name:'Spool 3',type:'ABS',color:'#EF4444',nozzle:250,bed:100,weight:1000,cap:1000},4:{name:'Spool 4',type:'TPU',color:'#F59E0B',nozzle:220,bed:50,weight:1000,cap:1000}};
App.pages.spool=(()=>{
  const root=$('#p-spool');let spools=Object.assign({},DEF_SPOOLS,JSON.parse(localStorage.getItem('spools')||'{}'));let slot=1,dist=10,lastFilMm=null;
  Object.keys(spools).forEach(k=>{if(spools[k].weight===undefined)spools[k].weight=1000;if(!spools[k].cap)spools[k].cap=1000;});
  const save=()=>localStorage.setItem('spools',JSON.stringify(spools));
  App.getActiveSpool=()=>spools[slot]||spools[1];
  const hasAms=()=>Object.keys(MR.config).some(k=>/mmu|ercf|tradrack|happy_hare|bambu_ams|anycubic_ace/i.test(k)||(/^extruder\d/.test(k)));
  const spoolSvg=(color,type)=>`<svg viewBox="0 0 140 140" width="136" height="136" style="flex-shrink:0;filter:drop-shadow(0 4px 14px ${color}44)">
    <circle cx="70" cy="70" r="60" fill="#1E293B" stroke="rgba(148,163,184,0.55)" stroke-width="2.5"/>
    <circle cx="70" cy="70" r="50" fill="${color}" stroke="#FFFFFF44" stroke-width="1.5"/>
    <circle cx="70" cy="70" r="43" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
    <circle cx="70" cy="70" r="36" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
    <path d="M 105 105 C 128 96, 134 118, 122 130" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="70" cy="70" r="26" fill="#1E293B" stroke="rgba(148,163,184,0.6)" stroke-width="2"/>
    <circle cx="70" cy="70" r="15" fill="#0B0F19" stroke="#00E5FF" stroke-width="1.5"/>
    <text x="70" y="74" text-anchor="middle" fill="#FFFFFF" font-size="11" font-weight="900" font-family="sans-serif">${type}</text>
  </svg>`;
  function openSpoolSettings(){
    const sp=spools[slot];
    const m=el(`<div class="dlg" style="max-width:620px;width:92%;border:1.5px solid #00E5FF;padding:18px"></div>`);
    let closeModal=null;
    function renderModal(){
      const cn=(PALETTE.find(p=>p[0].toLowerCase()===sp.color.toLowerCase())||[0,'Custom'])[1];
      const wCur=Math.round(sp.weight??1000),wCap=Math.round(sp.cap||1000);
      m.innerHTML=`<div class="row" style="align-items:center;margin-bottom:10px">
        <b style="font-size:16px;color:#FFF">⚙ ${sp.name.toUpperCase()} SETTINGS</b>
        <span class="grow"></span>
        <span class="cmd" style="font-size:12px">${sp.type} • ${cn} • ${sp.nozzle}°C / ${sp.bed}°C • ${wCur}g</span>
        <button class="btn sm" id="sm-x" style="border-radius:50%;width:30px;height:30px;padding:0">✕</button>
      </div>
      <div class="hdr" style="margin:4px 0">FILAMENT MATERIAL (AUTO-SETS NOZZLE & BED TEMPS)</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:10px">
        ${Object.keys(PRESETS_F).map(k=>`<button class="btn sm ${k===sp.type?'pri':''}" data-mtype="${k}" style="font-weight:800">${k}</button>`).join('')}
      </div>
      <div class="hdr" style="margin:4px 0">FILAMENT COLOUR</div>
      <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:8px;justify-items:center;margin-bottom:12px">
        ${PALETTE.map(([h,n])=>`<button class="color-dot" title="${n}" data-mc="${h}" style="width:30px;height:30px;border-radius:15px;background:${h};border:${h.toLowerCase()===sp.color.toLowerCase()?'3px solid #FFF':'1.5px solid rgba(255,255,255,0.28)'}"></button>`).join('')}
      </div>
      <div class="grid2" style="gap:10px;margin-bottom:10px">
        <div class="box row" style="align-items:center;justify-content:space-between;border-color:rgba(255,90,95,0.35)">
          <b style="color:#CBD5E1">Nozzle:</b>
          <button class="btn sm" data-mt="nozzle" data-md="-5">-5°</button>
          <b style="color:#FF5A5F;font-size:15px;min-width:60px;text-align:center">${sp.nozzle} °C</b>
          <button class="btn sm" data-mt="nozzle" data-md="5">+5°</button>
        </div>
        <div class="box row" style="align-items:center;justify-content:space-between;border-color:rgba(0,229,255,0.35)">
          <b style="color:#CBD5E1">Bed:</b>
          <button class="btn sm" data-mt="bed" data-md="-5">-5°</button>
          <b style="color:#00E5FF;font-size:15px;min-width:60px;text-align:center">${sp.bed} °C</b>
          <button class="btn sm" data-mt="bed" data-md="5">+5°</button>
        </div>
      </div>
      <div class="hdr" style="margin:4px 0">REMAINING SPOOL WEIGHT (AUTO-DEDUCTS DURING PRINTS)</div>
      <div class="box row" style="align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn sm" data-wd="-50">-50g</button>
        <b style="color:#34D399;font-size:15px;min-width:110px;text-align:center">${wCur}g / ${wCap}g</b>
        <button class="btn sm" data-wd="50">+50g</button>
        <span class="grow"></span>
        ${[[1000,'Full 1kg'],[750,'750g'],[500,'500g'],[250,'250g']].map(([w,l])=>`<button class="btn sm ${wCur===w?'pri':''}" data-wset="${w}">${l}</button>`).join('')}
      </div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn pri" id="sm-done" style="padding:8px 22px;font-weight:900">✓ Save & Close</button>
      </div>`;
      $('#sm-x',m).onclick=$('#sm-done',m).onclick=()=>{if(closeModal)closeModal();draw()};
      m.querySelectorAll('[data-mtype]').forEach(b=>b.onclick=()=>{
        const t=b.dataset.mtype;sp.type=t;sp.nozzle=PRESETS_F[t][0];sp.bed=PRESETS_F[t][1];save();renderModal();draw();
      });
      m.querySelectorAll('[data-mc]').forEach(b=>b.onclick=()=>{
        sp.color=b.dataset.mc;save();renderModal();draw();
      });
      m.querySelectorAll('[data-mt]').forEach(b=>b.onclick=()=>{
        const k=b.dataset.mt;sp[k]=Math.max(0,Math.min(k==='bed'?150:350,sp[k]+ +b.dataset.md));save();renderModal();draw();
      });
      m.querySelectorAll('[data-wd]').forEach(b=>b.onclick=()=>{
        sp.weight=Math.max(0,Math.min(sp.cap||1000,(sp.weight??1000)+ +b.dataset.wd));save();renderModal();draw();
      });
      m.querySelectorAll('[data-wset]').forEach(b=>b.onclick=()=>{
        sp.weight=+b.dataset.wset;if(sp.weight>sp.cap)sp.cap=sp.weight;save();renderModal();draw();
      });
    }
    renderModal();
    closeModal=modal(m);
  }
  function draw(){
    const sp=spools[slot];const ams=hasAms();
    const cn=(PALETTE.find(p=>p[0].toLowerCase()===sp.color.toLowerCase())||[0,'Custom'])[1];
    const fg=['#FFFFFF','#EAB308'].includes(sp.color.toUpperCase())?'#000':'#fff';
    const wCur=Math.max(0,Math.round(sp.weight??1000)),wCap=Math.max(100,Math.round(sp.cap||1000));
    const wPct=Math.min(100,Math.round((wCur/wCap)*100));
    const metersLeft=Math.round(wCur/2.98);
    const wCol=wCur<100?'#EF4444':wCur<250?'#F59E0B':'#10B981';
    root.innerHTML=`${ams?`<div class="hdr">AMS / MMU DETECTED — SELECT ACTIVE SPOOL</div><div class="row card" style="padding:8px;margin-bottom:8px">${[1,2,3,4].map(i=>`<button class="btn grow ${i===slot?'on':''}" data-s="${i}" style="text-align:left">● ${spools[i].name} (${spools[i].type})</button>`).join('')}</div>`:''}
    <div class="row" style="align-items:center;margin-bottom:4px"><div class="hdr grow">ACTIVE FILAMENT SPOOL</div><span class="pill info" id="slive">● Nozzle: --</span></div>
    <div class="row" style="align-items:stretch;gap:12px;flex-wrap:wrap">
      <div class="card col grow" id="spool-card-tap" style="flex:1.1;min-width:280px;cursor:pointer;border:1.5px solid rgba(0,229,255,0.45);justify-content:space-between;padding:14px">
        <div class="row" style="align-items:center;gap:16px;margin:auto 0">
          ${spoolSvg(sp.color,sp.type)}
          <div class="col grow" style="gap:8px">
            <b style="font-size:19px;color:#FFF">${sp.name}</b>
            <div class="row" style="gap:6px;flex-wrap:wrap">
              <span class="cmd" style="font-size:13px;font-weight:900;padding:3px 10px">${sp.type}</span>
              <span style="background:${sp.color};color:${fg};border-radius:7px;padding:3px 10px;font-size:12px;font-weight:800">● ${cn}</span>
            </div>
            <div class="grid2" style="gap:8px">
              <div class="box" style="background:rgba(255,90,95,0.1);border-color:rgba(255,90,95,0.35);padding:6px 8px">
                <div style="color:#94A3B8;font-size:9px;font-weight:800">NOZZLE PRESET</div>
                <b style="color:#FF5A5F;font-size:15px">${sp.nozzle} °C</b>
              </div>
              <div class="box" style="background:rgba(0,229,255,0.1);border-color:rgba(0,229,255,0.35);padding:6px 8px">
                <div style="color:#94A3B8;font-size:9px;font-weight:800">BED PRESET</div>
                <b style="color:#00E5FF;font-size:15px">${sp.bed} °C</b>
              </div>
            </div>
            <div class="box col" style="padding:6px 9px;gap:4px;background:rgba(15,23,42,.75)">
              <div class="row" style="justify-content:space-between;font-size:11px;font-weight:800">
                <span style="color:#94A3B8">REMAINING FILAMENT</span>
                <span id="sw-lbl" style="color:${wCol}">${wCur}g / ${wCap}g (~${metersLeft}m • ${wPct}%)</span>
              </div>
              <div class="bar" style="height:6px"><i id="sw-bar" style="width:${wPct}%;background:${wCol}"></i></div>
            </div>
          </div>
        </div>
        <div style="background:rgba(0,229,255,0.1);border:1px dashed rgba(0,229,255,0.45);border-radius:8px;padding:7px;text-align:center;color:#7DD3FC;font-size:11.5px;font-weight:800;margin-top:10px">
          ⚙ Tap Spool Card to Change Material, Colour, Temps & Weight
        </div>
      </div>
      <div class="col grow" style="flex:1;min-width:260px;gap:10px">
        <div class="card col" style="gap:8px;padding:12px">
          <div class="hdr" style="margin:0">FILAMENT ACTIONS</div>
          <div class="row" style="gap:8px">
            <button class="btn green grow" id="sload" style="min-height:42px">📥 Load</button>
            <button class="btn slate grow" id="sunl" style="min-height:42px">📤 Unload</button>
          </div>
          <button class="btn orange" id="sheat" style="min-height:38px">🔥 Preheat Nozzle to Spool Temp</button>
        </div>
        <div class="card col" style="gap:8px;padding:12px">
          <div class="hdr" style="margin:0">MANUAL EXTRUDE / RETRACT</div>
          <div class="row" style="gap:6px">${[5,10,25,50].map(d=>`<button class="btn sm grow ${d===dist?'on':''}" data-l="${d}">${d}mm</button>`).join('')}</div>
          <div class="row" style="gap:8px">
            <button class="btn grow" style="border-color:#10B981;color:#34D399;min-height:38px" id="sext">⬇ Extrude +${dist}mm</button>
            <button class="btn grow" style="border-color:#38BDF8;color:#7DD3FC;min-height:38px" id="sret">⬆ Retract -${dist}mm</button>
          </div>
        </div>
      </div>
    </div>
    <div class="sub" id="sstat" style="text-align:center;margin-top:6px">Touch the Spool card to configure filament type, colour, weight, and preset temperatures.</div>`;
    root.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{slot=+b.dataset.s;draw()});
    $('#spool-card-tap',root).onclick=openSpoolSettings;
    root.querySelectorAll('[data-l]').forEach(b=>b.onclick=()=>{dist=+b.dataset.l;draw()});
    $('#sheat').onclick=()=>{MR.setTemp('extruder',sp.nozzle);$('#sstat').textContent=`🔥 Heating nozzle to ${sp.nozzle}°C…`};
    const man=l=>{const cur=stat().extruder?.temperature||0;if(cur<170){MR.setTemp('extruder',sp.nozzle);$('#sstat').textContent='🔥 Heating nozzle first…'}
      MR.extrude(l,l>0?5:10).then(ok=>$('#sstat').textContent=ok?`✓ ${l>0?'Extrude':'Retract'} ${l}mm complete`:'⚠ Rejected (nozzle too cold?)')};
    $('#sext').onclick=()=>man(dist);$('#sret').onclick=()=>man(-dist);
    $('#sload').onclick=()=>filamentDialog('load',sp);$('#sunl').onclick=()=>filamentDialog('unload',sp);
  }
  MR.on('status',s=>{
    const ps=s.print_stats||{};
    const filMm=ps.filament_used||0;
    if(ps.state==='printing'){
      if(lastFilMm!==null&&filMm>lastFilMm){
        const dMm=filMm-lastFilMm;
        const dGrams=dMm*0.00298;
        const sp=spools[slot];
        if(sp){
          sp.weight=Math.max(0,(sp.weight??1000)-dGrams);
          save();
        }
      }
      lastFilMm=filMm;
    }else if(ps.state==='standby'||ps.state==='complete'||ps.state==='cancelled'){
      lastFilMm=null;
    }
    const b=$('#slive');if(!b)return;const e=s.extruder||{},c=e.temperature||0,t=e.target||0;
    if(c>=180){b.className='pill bad';b.textContent=`🔥 Nozzle: ${c.toFixed(1)}°C${t?' / '+Math.round(t)+'°C':''} (HOT)`}
    else if(t>0){b.className='pill';b.textContent=`🔥 Heating Nozzle: ${c.toFixed(1)}°C → ${Math.round(t)}°C`}
    else{b.className='pill info';b.textContent=`● Nozzle: ${c.toFixed(1)}°C (Idle)`}});
  MR.on('config',draw);
  return{show:draw};
})();
function filamentDialog(mode,sp){
  const a=Anim.extruder({mode,color:sp.color});
  let target=sp.nozzle,sent=false,cancelled=false,bypassSensor=false,pushModalClose=null;
  const sensorName=Object.keys(MR.config).concat(MR.objects).find(k=>/^filament_(switch|motion)_sensor\s+/.test(k));
  const ld=mode==='load';
  const root=el(`<div></div>`);
  root.innerHTML=`<div class="row" style="align-items:center"><div class="grow"><h3 style="margin:0">${ld?'Load':'Unload'} Filament — ${sp.name}</h3><div class="sub">Target: ${target}°C • ${sp.type}</div></div><span class="cmd">${ld?'LOAD_FILAMENT':'UNLOAD_FILAMENT'}</span></div>
   <div class="row" style="margin-top:8px;flex-wrap:wrap"><div class="grow" style="min-width:240px" id="fa"></div>
   <div class="box grow col" style="min-width:240px"><b id="fst" style="color:#F59E0B">STEP 1: HEATING NOZZLE</b><div class="box" id="fin">Nozzle is heating up to extrude temperature. Please wait...</div>
    <div class="row" style="justify-content:space-between"><b id="ftemp" style="color:#38BDF8"></b><span class="pill" id="fsens-pill">${sensorName?'SENSOR: CHECKING':'SENSOR: NONE'}</span></div><div class="bar"><i id="fbar"></i></div>
    <div class="h" style="color:#94A3B8;font-size:10px;font-weight:800">PROCEDURAL CHECKLIST</div><div id="fchk" class="col" style="gap:3px;font-size:11px"></div>
    <div class="grid2"><button class="btn sm" data-e="10">⬇ Extrude +10mm</button><button class="btn sm" data-e="25">⬇ Extrude +25mm</button><button class="btn sm" data-e="-10">⬆ Retract -10mm</button><button class="btn sm" data-e="-25">⬆ Retract -25mm</button></div></div></div>
   <div class="row" style="margin-top:8px"><button class="btn danger" id="fcan">⛔ Cancel & Turn Off Heaters</button><span class="grow"></span><button class="btn" id="fact" disabled>Heating...</button></div>`;
  $('#fa',root).append(a.el);
  const closePushModal=()=>{if(pushModalClose){const c=pushModalClose;pushModalClose=null;c()}};
  openSub((ld?'Load':'Unload')+' Filament — '+sp.name,root,()=>{clearInterval(iv);closePushModal();a.stopped=true});
  const chk=(i,t)=>t.map((x,k)=>`<span style="color:${k<i?'#10B981':k===i?'#FBBF24':'#64748B'}">${k<i?'✔':k===i?'●':'○'} ${x}</span>`).join('');
  const steps=ld?['Pre-heating hotend to melting point','Insert filament into extruder drive until sensor triggers','Extruder feeds filament through nozzle meltzone']:['Pre-heating hotend to melting point','Reversing drive gear and retracting filament','Gently pull filament free from toolhead'];

  const openPushModal=()=>{
    if(pushModalClose)return;
    const m=el(`<div class="dlg" style="max-width:440px;border:2px solid #F59E0B;text-align:center;padding:20px">
      <div style="font-size:40px;line-height:1;margin-bottom:8px">📥</div>
      <h3 style="color:#FBBF24;font-size:20px;margin:0 0 8px">PUSH FILAMENT IN</h3>
      <div class="sub" style="font-size:13.5px;color:#E2E8F0;line-height:1.45;margin-bottom:14px">
        Nozzle is at temperature! Push filament firmly into the extruder inlet.<br>
        <b style="color:#38BDF8">Loading will start automatically as soon as the filament sensor detects it.</b>
      </div>
      <div class="box mono" style="color:#F59E0B;font-weight:800;margin-bottom:14px">● WAITING FOR FILAMENT SENSOR…</div>
      <div class="row" style="justify-content:center;gap:10px">
        <button class="btn danger" id="pm-cancel">Cancel</button>
        <button class="btn pri" id="pm-force">Load Anyway ›</button>
      </div>
    </div>`);
    pushModalClose=modal(m);
    $('#pm-cancel',m).onclick=()=>{closePushModal();$('#fcan',root).click()};
    $('#pm-force',m).onclick=()=>{bypassSensor=true;closePushModal();tick()};
  };

  const tick=async()=>{
    if(cancelled)return;
    const st=stat();
    const e=st.extruder||{},cur=e.temperature||0;
    const liveVel=st.motion_report?.live_extruder_velocity||0;
    const sObj=sensorName?st[sensorName]:null;
    const detected=Boolean(sObj&&sObj.filament_detected);

    if(sensorName){
      const spEl=$('#fsens-pill',root);
      if(spEl){
        spEl.textContent=detected?'● SENSOR: DETECTED':'○ SENSOR: EMPTY';
        spEl.className='pill '+(detected?'ok':'bad');
      }
    }

    $('#ftemp',root).textContent=`Nozzle Temp: ${cur.toFixed(1)}°C / ${target}°C`;$('#fbar',root).style.width=Math.min(100,cur/target*100)+'%';
    a.set({temp:cur,target,sensor:detected,liveVel});
    const hot=cur>=target-4||cur>=185;
    if(!hot){a.set({stage:'heating'});$('#fchk',root).innerHTML=chk(0,steps);return}
    if(ld&&sensorName&&!sent&&!bypassSensor){
      if(!detected){
        a.set({stage:'waiting_sensor',sensor:false});
        $('#fst',root).textContent='STEP 2: PUSH FILAMENT INTO EXTRUDER';
        $('#fin',root).textContent='👉 Push filament in until the sensor detects it — loading will start automatically.';
        $('#fchk',root).innerHTML=chk(1,steps);
        openPushModal();
        return;
      }
    }
    closePushModal();
    if(!sent){
      sent=true;const mt=cur>=185?Math.round(cur):target;
      a.set({stage:ld?'extruding':'pulling',sensor:detected||ld});
      $('#fst',root).textContent=ld?'STEP 2: FEEDING & EXTRUDING FILAMENT':'STEP 2: RETRACTING & PULLING FILAMENT';
      $('#fin',root).textContent=ld?'Extruder is gripping and feeding filament into the hotend…':'👉 Gears are retracting. Gently pull filament free.';
      $('#fchk',root).innerHTML=chk(2,steps);
      const b=$('#fact',root);b.textContent='✔ Done';b.disabled=false;b.className='btn green';
      const ok=await MR.gcode(`${ld?'LOAD':'UNLOAD'}_FILAMENT TEMP=${mt}`,120000);
      if(cancelled)return;a.set({stage:'done'});$('#fst',root).textContent=`SUCCESS: FILAMENT ${ld?'LOADED':'UNLOADED'}!`;$('#fst',root).style.color='#10B981';
      $('#fin',root).textContent=ok?(ld?'✔ Loaded! Purge more below or tap Done.':'✔ Filament freed. Remove the spool.'):'⚠ Macro failed — check LOAD_FILAMENT exists in printer.cfg';
      $('#fchk',root).innerHTML=chk(3,steps);
    }
  };
  MR.setTemp('extruder',target);const iv=setInterval(tick,250);tick();
  root.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>{const l=+b.dataset.e;a.set({stage:l>0?'extruding':'pulling'});MR.extrude(l,l>0?5:10).then(ok=>{a.set({stage:'done'});$('#fin',root).textContent=ok?`✔ ${l>0?'Extrude':'Retract'} ${l}mm complete`:'⚠ Failed (check temperature)'})});
  $('#fcan',root).onclick=()=>{cancelled=true;closePushModal();MR.setTemp('extruder',0);MR.setTemp('heater_bed',0);a.set({stage:'cancelled'});$('#fst',root).textContent='OPERATION CANCELLED';setTimeout(closeSub,700)};
  $('#fact',root).onclick=()=>{closePushModal();closeSub()};
}
/* ---- Power ---- */
App.pages.power=(()=>{
  const root=$('#p-power');
  const defs=[['KLIPPER SERVICE & HARDWARE'],['reload','Klipper Restart','Reload Python service & config.','RESTART',()=>MR.restart()],['restart','Firmware Restart','Reload config & reconnect MCU.','FIRMWARE',()=>MR.fwRestart()],
   ['restart','Restart Screen Display','Restart Klipper touchscreen display service (klipper-display).','RESTART SCREEN',()=>MR.post('/machine/services/restart?service=klipper-display')],
   ['HOST SYSTEM (PI)'],['restart','Reboot Host (Pi)','Safely reboot Raspberry Pi system OS.','REBOOT',()=>MR.hostAction('reboot')],['power','Shutdown Host (Pi)','Safely power down Raspberry Pi system OS.','SHUTDOWN',()=>MR.hostAction('shutdown')],
   ['EMERGENCY'],['power','Emergency Stop','Immediately halt all motors & heaters (M112).','M112',async()=>{await MR.estop();setTimeout(()=>MR.fwRestart(),2000)},1]];
  root.innerHTML='<div class="grid2" id="pg"></div>';
  defs.forEach(d=>{const g=$('#pg',root);
    if(d.length===1){g.append(el(`<div class="hdr" style="grid-column:1/3">${d[0]}</div>`));return}
    const [ic,t,s,b,fn,dg]=d;const c=el(`<div class="cc ${dg?'danger':''}">${ICON(ic)}<div><div class="ti">${t}</div><div class="ds">${s}</div><span class="cmd">${b}</span></div><span class="ar">›</span></div>`);
    c.onclick=()=>confirmBox(t,'Are you sure?','Yes',async()=>{const bd=$('.cmd',c);bd.textContent='SENT…';await fn();toast(t+' sent');setTimeout(()=>bd.textContent=b,2500)},dg);g.append(c)});
  return{show(){}};
})();

