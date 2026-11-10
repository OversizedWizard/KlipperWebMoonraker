/* Core: helpers, navigation, top bar, Home page, preheat dialog */
const $=(s,r=document)=>r.querySelector(s);
const el=(html)=>{const t=document.createElement('div');t.innerHTML=html.trim();return t.firstElementChild};
function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(toast._t);toast._t=setTimeout(()=>t.style.display='none',2600)}
const App={pages:{},cur:'',history:[],subStack:null,homedAxes:'',mr:MR}; window.App=App;
const NAV_TOP=[['home','Home'],['files','Files'],['printing','Print'],['spool','Spool'],['calibrate','Calibrate']];
const NAV_BOTTOM=[['config','Printer.cfg'],['logs','Logs'],['settings','Settings'],['power','Power']];
const NAV=[...NAV_TOP,...NAV_BOTTOM];
const TITLES={home:'Home',files:'Files',printing:'Printing',spool:'Spool',calibrate:'Calibrate',config:'Printer.cfg',logs:'System Logs',settings:'Settings',power:'Power'};
function stat(){return MR.st}
function updateTopBack(){
  const b=$('#topback');if(!b)return;
  const isSub=$('#sub')?.classList.contains('show');
  const isModal=$('#overlay')?.classList.contains('show');
  const hasHist=App.history.length>0;
  const notHome=App.cur!=='home';
  b.style.display=(isSub||isModal||hasHist||notHome)?'inline-flex':'none';
}
function go(page,isBack=false){
  if(page===App.cur && !$('#sub').classList.contains('show')){
    if(page==='logs' && App.pages.logs?.isDetailOpen?.()){
      App.pages.logs.closeDetail();
    }
    return;
  }
  if($('#sub').classList.contains('show')){
    closeSub(true);
  }
  if(!isBack && App.cur && App.cur!==page){
    App.history.push({type:'page',page:App.cur});
    if(App.history.length>50)App.history.shift();
  }
  App.cur=page;
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='p-'+page));
  document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.p===page));
  $('#title').textContent=TITLES[page]||'Home';
  if(window.location.hash.slice(1)!==page){
    try{history.replaceState(null,'','#'+page)}catch(e){window.location.hash=page}
  }
  App.pages[page]?.show?.();
  updateTopBack();
}
function openSub(title,node,onClose){
  const s=$('#sub');s.innerHTML='';
  const hd=el(`<div class="subhead"><button class="btn sm" id="subback">‹ Back</button><h3 style="margin:0;font-size:17px">${title}</h3></div>`);
  s.append(hd,node);s.classList.add('show');App.subClose=onClose;
  App.history.push({type:'sub',fromPage:App.cur,title});
  $('#subback').onclick=()=>App.back();$('#title').textContent=title;
  updateTopBack();
}
function closeSub(isBack=false){
  const s=$('#sub');if(!s.classList.contains('show'))return;
  s.classList.remove('show');s.innerHTML='';
  try{App.subClose?.()}catch(e){console.error(e)}
  App.subClose=null;
  let targetPage=null;
  if(App.history.length>0 && App.history[App.history.length-1].type==='sub'){
    const subEntry=App.history.pop();
    if(subEntry.fromPage)targetPage=subEntry.fromPage;
  }
  if(!isBack && targetPage && targetPage!==App.cur){
    go(targetPage,true);
    return;
  }
  $('#title').textContent=TITLES[App.cur]||'Home';
  updateTopBack();
}
App.back=function(){
  const o=$('#overlay');
  if(o&&o.classList.contains('show')){
    if(App._modalClose){const c=App._modalClose;App._modalClose=null;c()}
    else{o.classList.remove('show');o.innerHTML=''}
    updateTopBack();
    return;
  }
  const s=$('#sub');
  if(s&&s.classList.contains('show')){
    closeSub(false);
    return;
  }
  if(App.cur==='logs' && App.pages.logs?.isDetailOpen?.()){
    App.pages.logs.closeDetail();
    return;
  }
  while(App.history.length>0){
    const prev=App.history.pop();
    if(prev.type==='page'&&prev.page&&prev.page!==App.cur){
      go(prev.page,true);
      return;
    }
  }
  if(App.cur!=='home'){
    go('home',true);
  }else{
    updateTopBack();
  }
};
function modal(node){
  const o=$('#overlay');o.innerHTML='';o.append(node);o.classList.add('show');
  const close=()=>{
    o.classList.remove('show');o.innerHTML='';
    if(App._modalClose===close)App._modalClose=null;
    updateTopBack();
  };
  App._modalClose=close;
  updateTopBack();
  return close;
}
function confirmBox(title,msg,okText,onOk,danger){
  const n=el(`<div class="dlg" style="max-width:380px"><h3>${title}</h3><p class="sub" style="font-size:13px">${msg}</p>
   <div class="row" style="justify-content:flex-end"><button class="btn" id="c-no">Cancel</button><button class="btn ${danger?'danger':'pri'}" id="c-ok">${okText}</button></div></div>`);
  const close=modal(n);$('#c-no',n).onclick=close;$('#c-ok',n).onclick=()=>{close();onOk()};
}
/* ---- Sidebar / top bar ---- */
function buildShell(){
  const makeBtn=([k,l])=>`<button class="nav ${k==='power'?'danger':''}" data-p="${k}">${ICON(k)}<span>${l}</span></button>`;
  $('#sidebar').innerHTML=`
    <div class="nav-group nav-top">${NAV_TOP.map(makeBtn).join('')}</div>
    <div class="nav-divider"></div>
    <div class="nav-group nav-bottom">${NAV_BOTTOM.map(makeBtn).join('')}</div>
  `;
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>go(b.dataset.p));
  $('#topback').onclick=()=>App.back();
  $('#estop').onclick=()=>confirmBox('Emergency Stop','Immediately halt all motors & heaters (M112)?','STOP',()=>{MR.estop();toast('M112 sent')},true);
  setInterval(()=>{const d=new Date();$('#clock').textContent=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')},1000);
  $('#probe-pill').onclick=()=>{MR.tare().then(()=>toast('Load cell tared'))};
}
const STEPS=[0.1,1,5,10,50,100];
/* ---- Preheat ---- */
const PRE={nozzle:[['PLA',205],['PETG',240],['ABS',250],['TPU',220],['Nylon',260]],bed:[['PLA',60],['PETG',75],['ABS',100],['TPU',50],['Nylon',90]]};
function preheat(kind,onSet){
  const s=stat(),h=kind==='nozzle'?s.extruder:s.heater_bed;const cur=h?.temperature||0,tg=h?.target||0;
  let t=tg>0?Math.round(tg):(kind==='nozzle'?205:60),step=5;const max=kind==='nozzle'?300:130;
  const col=kind==='nozzle'?'#FF7A00':'#00E5FF';
  const n=el(`<div class="dlg" style="max-width:480px;border-color:${kind==='nozzle'?'rgba(255,122,0,.55)':'rgba(0,229,255,.55)'}">
   <div class="row" style="align-items:center"><div style="width:40px">${ICON(kind)}</div><div class="grow"><h3>${kind==='nozzle'?'Nozzle':'Bed'} Temperature</h3>
   <div class="sub">Current: ${cur.toFixed(1)}°C • ${tg>0?'Active Target: '+Math.round(tg)+'°C':'Heater Idle / Off'}</div></div><button class="x" id="px">✕</button></div>
   <div class="row box" style="margin:10px 0;align-items:center;gap:10px">
    <button class="btn xl" id="p-minus" style="min-width:64px;font-size:22px;font-weight:900">−</button>
    <div class="grow big" id="pt" style="text-align:center;border:1.5px solid ${col};border-radius:10px;padding:8px;color:${col}"></div>
    <button class="btn xl" id="p-plus" style="min-width:64px;font-size:22px;font-weight:900">+</button></div>
   <div class="row" style="align-items:center;margin-bottom:8px"><span class="sub" style="font-weight:800;min-width:52px">STEP:</span>
    ${[1,5,10].map(st=>`<button class="btn sm grow ${st===step?'on':''}" data-step="${st}">${st}°C</button>`).join('')}
   </div>
   <div class="hdr">MATERIAL PRESETS</div><div class="row" id="pp"></div>
   <div class="row" style="margin-top:12px"><button class="btn pri grow" style="background:linear-gradient(135deg,rgba(0,229,255,.2),rgba(37,99,235,.3));color:#67E8F9;border:1px solid #00E5FF" id="pc">❄ Cooldown (Off)</button>
   <button class="btn" id="pcan">Cancel</button><button class="btn ${kind==='nozzle'?'orange':'pri'} grow" id="pa"></button></div></div>`);
  const close=modal(n);
  const upd=()=>{$('#pt',n).textContent=t+' °C';$('#pa',n).textContent=t?`🔥 Set to ${t}°C`:'❄ Turn Off (0°C)';
    n.querySelectorAll('#pp .btn').forEach(b=>b.classList.toggle('on',+b.dataset.t===t))};
  PRE[kind].forEach(([m,v])=>{const b=el(`<button class="btn grow" data-t="${v}">${m}<br>${v}°C</button>`);b.onclick=()=>{t=v;upd()};$('#pp',n).append(b)});
  n.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{step=+b.dataset.step;n.querySelectorAll('[data-step]').forEach(x=>x.classList.toggle('on',x===b))});
  const apply=v=>{(onSet?onSet(v):MR.setTemp(kind==='nozzle'?'extruder':'heater_bed',v));toast(`✓ ${kind==='nozzle'?'Nozzle':'Bed'} target → ${v}°C`);close()};
  $('#p-minus',n).onclick=()=>{t=Math.max(0,t-step);MR.setTemp(kind==='nozzle'?'extruder':'heater_bed',t);upd()};
  $('#p-plus',n).onclick=()=>{t=Math.min(max,t+step);MR.setTemp(kind==='nozzle'?'extruder':'heater_bed',t);upd()};
  $('#px',n).onclick=$('#pcan',n).onclick=close;$('#pc',n).onclick=()=>apply(0);$('#pa',n).onclick=()=>apply(t);upd();
}
/* ---- Audio Chime, Push Notifications & Screen Sleep Timer ---- */
App.playAlertChime=function(kind='complete'){
  if(localStorage.getItem('chime_enabled')==='0')return;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return;
    const ctx=new Ctx();
    const notes=kind==='error'?[330,262,220]:kind==='paused'?[440,554]:[523.25,659.25,783.99,1046.5];
    notes.forEach((freq,i)=>{
      const osc=ctx.createOscillator(),g=ctx.createGain();
      osc.type=kind==='error'?'sawtooth':'sine';
      osc.frequency.value=freq;
      g.gain.setValueAtTime(0.001,ctx.currentTime+i*0.13);
      g.gain.exponentialRampToValueAtTime(0.18,ctx.currentTime+i*0.13+0.03);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.13+0.28);
      osc.connect(g);g.connect(ctx.destination);
      osc.start(ctx.currentTime+i*0.13);
      osc.stop(ctx.currentTime+i*0.13+0.3);
    });
  }catch(e){}
};
App.sendPushAlert=function(title,body){
  if(localStorage.getItem('notif_enabled')==='0')return;
  try{
    if('Notification' in window && Notification.permission==='granted'){
      new Notification(title,{body});
    }
  }catch(e){}
};
(function initSleepTimer(){
  let sleepTimer=null,sleeping=false,sleepEl=null;
  const updateSleepStats=()=>{
    if(!sleeping||!sleepEl)return;
    const d=new Date();
    const clk=$('#slp-clock',sleepEl);
    if(clk)clk.textContent=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    const s=stat();
    const noz=Math.round(s.extruder?.temperature||0),bed=Math.round(s.heater_bed?.temperature||0);
    const ps=s.print_stats||{},vs=s.virtual_sdcard||{};
    const st=(ps.state||'standby').toUpperCase();
    const pct=Math.round((vs.progress||0)*100);
    const inf=$('#slp-info',sleepEl);
    if(inf)inf.innerHTML=`<span>🔥 Nozzle ${noz}°C</span><span>•</span><span>🛏 Bed ${bed}°C</span><span>•</span><span style="color:#00E5FF">${st}${ps.state==='printing'?` (${pct}%)`:''}</span>`;
  };
  App.enterSleep=()=>{
    if(sleeping)return;
    sleeping=true;
    if(!sleepEl){
      sleepEl=el(`<div id="sleep-overlay" style="position:fixed;inset:0;z-index:99999;background:#020409;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;user-select:none">
        <div id="slp-clock" class="mono" style="font-size:74px;font-weight:900;color:rgba(248,250,252,.28);letter-spacing:4px">--:--</div>
        <div id="slp-info" class="row mono" style="gap:14px;font-size:16px;font-weight:700;color:rgba(148,163,184,.45);margin-top:10px"></div>
        <div style="margin-top:28px;font-size:12px;font-weight:700;color:rgba(100,116,139,.35);letter-spacing:1.5px">🌙 LOW-POWER SLEEP MODE • TAP ANYWHERE TO WAKE</div>
      </div>`);
      sleepEl.onclick=e=>{e.stopPropagation();App.wakeSleep();};
      document.body.appendChild(sleepEl);
    }
    sleepEl.style.display='flex';
    updateSleepStats();
  };
  App.wakeSleep=()=>{
    if(sleeping){
      sleeping=false;
      if(sleepEl)sleepEl.style.display='none';
    }
    App.resetSleepTimer();
  };
  App.resetSleepTimer=()=>{
    clearTimeout(sleepTimer);
    const mins=+(localStorage.getItem('sleep_timeout_min')??10);
    if(mins>0){
      sleepTimer=setTimeout(()=>App.enterSleep(),mins*60*1000);
    }
  };
  ['pointerdown','keydown','wheel','touchstart'].forEach(ev=>{
    window.addEventListener(ev,()=>{if(sleeping)App.wakeSleep();else App.resetSleepTimer();},{passive:true});
  });
  setInterval(updateSleepStats,2000);
  setTimeout(()=>App.resetSleepTimer(),1000);
})();

/* ---- Connection / boot ---- */
MR.on('connection',ok=>{const c=$('#conn');c.className='pill '+(ok?'ok':'bad');c.textContent=ok?'● '+(MR.base||'').replace(/^https?:\/\//,''):'● Offline'});
MR.on('status',s=>{
  const lc=s.load_cell_probe||s.load_cell;const p=$('#probe-pill');
  if(lc&&lc.force_g!==undefined){
    p.textContent='⚖ '+(lc.force_g>=0?'+':'')+lc.force_g.toFixed(1)+' g';
    const trig=Boolean(lc.last_query===true||lc.last_query==='TRIGGERED'||s.probe?.last_query===true||s.query_endstops?.last_query?.stepper_z===1);
    p.classList.toggle('alert',trig);
  }
  const ps=s.print_stats;
  if(ps&&ps.state!==App._lastState){const prev=App._lastState;App._lastState=ps.state;
    if(prev!==undefined){
      App.wakeSleep?.();
      if(ps.state==='printing'||ps.state==='paused')go('printing');
      if(ps.state==='complete'){
        App.playAlertChime('complete');
        App.sendPushAlert('✅ Print Complete!',`${ps.filename||'Your print'} has finished printing.`);
        toast('✅ Print Complete!');
      }else if(ps.state==='error'){
        App.playAlertChime('error');
        App.sendPushAlert('⚠ Printer Error',ps.message||'A print error occurred.');
      }else if(ps.state==='paused'&&prev==='printing'){
        App.playAlertChime('paused');
        App.sendPushAlert('⏸ Print Paused',`${ps.filename||'Print'} is paused.`);
      }
    }
    App.pages.printing?.onState?.(ps.state)}
});
const SUB_ROUTES = {
  'files-test-prompt': () => {
    go('files');
    const dummy = [
      {
        name: 'benchy_speed_0.2mm.gcode',
        size: 4423680,
        previewUrl: 'http://192.168.0.99:7125/server/files/gcodes/.thumbs/CURAREPETIER-300x300.png'
      }
    ];
    setTimeout(() => {
      if (window._testPrompt) window._testPrompt(dummy);
    }, 150);
  },
  'files-list-view': () => {
    localStorage.setItem('files_view', 'list');
    go('files');
    setTimeout(() => localStorage.setItem('files_view', 'grid'), 1000);
  },
  'home-rearrange': () => { go('home'); setTimeout(() => $('#h-rearrange')?.click(), 50); },
  'home-test-collapse': () => {
    go('home');
    setTimeout(() => {
      $('#t-bed')?.classList.add('collapsed');
      $('#c-console-card')?.classList.add('collapsed');
      $('#c-macros-card')?.classList.add('collapsed');
    }, 50);
  },
  'sub-dualz': () => dualZTrim(),
  'sub-screws': () => bedScrews(),
  'sub-mesh': () => bedMesh(),
  'sub-mesh-rot': () => {
    bedMesh();
    setTimeout(() => {
      const c = document.querySelector('.canvas-mesh');
      if (c) {
        c.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 200, pointerId: 1 }));
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: 440, clientY: 140, pointerId: 1 }));
        c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      }
    }, 60);
  },
  'sub-zoff': () => zOffset(),
  'sub-probe-cal': () => probeCal(),
  'sub-load-cell-cal': () => loadCellCal(),
  'sub-ztilt': () => zTiltSub(),
  'sub-qgl': () => quadGantrySub(),
  'sub-shaper': () => inputShaperSub(),
  'sub-twist': () => axisTwistSub(),
  'sub-phase': () => endstopPhaseSub(),
  'sub-delta': () => deltaCalSub(),
  'sub-acc': () => probeAccuracy(),
  'sub-lcw': () => loadCellTest(),
  'sub-pid': () => pidTune(),
  'sub-log-klippy': () => {
    go('logs');
    setTimeout(() => App.pages.logs?.openLog?.({ path: 'klippy.log', size: 158181, modified: Math.floor(Date.now() / 1000) }), 350);
  }
};
window.addEventListener('load',()=>{
  buildShell();
  const h=window.location.hash.slice(1);
  if (h && SUB_ROUTES[h]) {
    go('calibrate');
    SUB_ROUTES[h]();
  } else {
    go(h&&TITLES[h]?h:'home');
  }
  updateTopBack();
  MR.connect();
});
window.addEventListener('popstate',()=>{
  App.back();
});
window.addEventListener('hashchange',()=>{
  const h=window.location.hash.slice(1);
  if (h && SUB_ROUTES[h]) {
    go('calibrate');
    SUB_ROUTES[h]();
  } else if (h&&TITLES[h]&&App.cur!==h) {
    if(App.history.length>0 && App.history[App.history.length-1].type==='page' && App.history[App.history.length-1].page===h){
      App.history.pop();
      go(h,true);
    }else{
      go(h);
    }
  }
});

