/* Files page, file details, Printing page, fine tune */
App.pages.files=(()=>{
  const root=$('#p-files');
  let currentPath='';
  let viewMode=localStorage.getItem('files_view')||'grid'; // 'grid' or 'list'
  let sortMode=localStorage.getItem('files_sort')||'date_desc'; // 'date_desc', 'name_asc', 'size_desc'
  let searchQuery='';
  let cachedItems=[];
  const metaCache={};
  let diskStats={total:0,used:0,free:0};

  root.innerHTML=`
    <div class="files-toolbar">
      <div class="files-breadcrumbs" id="f-breadcrumbs"></div>
      <div class="files-search">
        ${ICON('search')}
        <input type="text" id="f-search-input" placeholder="Search gcode or 3mf files…" autocomplete="off">
        <button class="clear-btn" id="f-search-clear" style="display:none">✕</button>
      </div>
      <div class="files-actions">
        <select id="f-sort">
          <option value="date_desc">🕒 Newest First</option>
          <option value="name_asc">🔤 Name (A–Z)</option>
          <option value="size_desc">📏 Size (Largest)</option>
        </select>
        <button class="btn sm" id="f-view-toggle" title="Toggle Grid / List View">
          ${viewMode==='grid'?ICON('list',16)+' List':ICON('grid',16)+' Grid'}
        </button>
        <button class="btn sm" id="f-history-btn" title="View Print History" style="border-color:rgba(0,229,255,.45);color:#7DD3FC;font-weight:800">${ICON('history',16)} History</button>
        <button class="btn sm" id="f-timelapse-btn" title="View & Download Timelapses" style="border-color:rgba(192,132,252,.4);color:#E9D5FF">🎬 Timelapses</button>
        <button class="btn sm" id="f-mkdir-btn" title="Create New Folder">${ICON('folderadd',16)} New Folder</button>
        <button class="btn sm" id="f-refresh-btn" title="Refresh files">${ICON('reload',16)||'⟳'}</button>
        <button class="btn sm pri" id="f-upload-btn" style="font-weight:800">
          ${ICON('upload',16)} Upload
        </button>
      </div>
    </div>

    <div class="file-drop-hero" id="fdrop">
      <div class="dz-left">
        <div class="dz-icon-box">${ICON('upload')}</div>
        <div>
          <div class="dz-hero-title">DRAG & DROP G-CODE / 3MF FILES HERE</div>
          <div class="dz-hero-sub">
            Target folder: <span class="dz-hero-dest" id="f-drop-dest">/</span> • or click anywhere in this box to browse
          </div>
        </div>
      </div>
      <div class="dz-hero-btns">
        <button class="btn pri sm" style="pointer-events:none;font-weight:800;padding:8px 16px">
          📁 Browse Computer
        </button>
      </div>
      <input type="file" id="f-file-input" accept=".gcode,.gco,.g,.3mf" multiple style="display:none">
    </div>

    <div id="flist" class="filegrid"></div>
    <div class="files-footer" id="f-footer">
      <span id="f-count-info">0 files</span>
      <span id="f-disk-info">Ready</span>
    </div>
  `;

  const fmtSize=n=>{
    if(!n||n<=0)return '0 B';
    if(n<1024)return n+' B';
    if(n<1048576)return (n/1024).toFixed(1)+' KB';
    if(n<1073741824)return (n/1048576).toFixed(1)+' MB';
    return (n/1073741824).toFixed(2)+' GB';
  };
  const fmtTime=s=>{
    if(!s||s<=0)return '--';
    s=Math.round(s);
    const h=Math.floor(s/3600), m=Math.floor((s%3600)/60);
    return h>0?`${h}h ${m}m`:`${m}m`;
  };
  const fmtDate=ts=>{
    if(!ts)return '--';
    const d=new Date(ts*1000);
    const now=new Date();
    if(d.toDateString()===now.toDateString()){
      return 'Today '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    }
    return d.toLocaleDateString([],{month:'short',day:'numeric'})+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  };

  const DEFAULT_ITEMS=[
    {name:'New Tests',dir:1,size:0,mod:Date.now()/1000-3600},
    {name:'cubetest.gcode.3mf',dir:0,size:2840000,mod:Date.now()/1000-7200,time:1620,fil:4.2,slicer:'OrcaSlicer'},
    {name:'CURAREPETIER.gcode',dir:0,size:15400000,mod:Date.now()/1000-86400,time:5400,fil:28.4,slicer:'Cura'},
    {name:'50mmflatsquare_PLA_8m50s.gcode',dir:0,size:1240000,mod:Date.now()/1000-14400,time:530,fil:1.8,slicer:'PrusaSlicer'},
    {name:'50mmflatsquare_PLA_8m49s.gcode',dir:0,size:1230000,mod:Date.now()/1000-28800,time:529,fil:1.8,slicer:'PrusaSlicer'},
    {name:'50mmflatsquare_PLA_cOLDbED.gcode',dir:0,size:1250000,mod:Date.now()/1000-43200,time:540,fil:1.8,slicer:'PrusaSlicer'}
  ];

  function renderBreadcrumbs(){
    const elBread=$('#f-breadcrumbs');
    if(!elBread)return;
    elBread.innerHTML='';
    const rootChip=el(`<button class="crumb-chip ${!currentPath?'active':''}">${ICON('folder')} gcodes</button>`);
    rootChip.onclick=()=>{if(currentPath){currentPath='';load();}};
    elBread.append(rootChip);

    if(currentPath){
      const parts=currentPath.split('/').filter(Boolean);
      let acc='';
      parts.forEach((p,idx)=>{
        acc+=(acc?'/':'')+p;
        const currentAcc=acc;
        const sep=el(`<span class="crumb-sep">/</span>`);
        const chip=el(`<button class="crumb-chip ${idx===parts.length-1?'active':''}">${p}</button>`);
        chip.onclick=()=>{if(currentPath!==currentAcc){currentPath=currentAcc;load();}};
        elBread.append(sep,chip);
      });
    }
    const destEl=$('#f-drop-dest');
    if(destEl)destEl.textContent='/'+(currentPath?currentPath+'/':'');
    const dfoDest=$('#dfo-dest');
    if(dfoDest)dfoDest.textContent='/'+(currentPath?currentPath+'/':'');
  }

  function filterAndRender(){
    renderBreadcrumbs();
    let items=[...cachedItems];
    if(searchQuery){
      items=items.filter(it=>it.name.toLowerCase().includes(searchQuery));
    }

    items.sort((a,b)=>{
      if(a.dir&&!b.dir)return -1;
      if(!a.dir&&b.dir)return 1;
      if(sortMode==='name_asc')return a.name.localeCompare(b.name);
      if(sortMode==='size_desc')return (b.size||0)-(a.size||0);
      return (b.mod||0)-(a.mod||0);
    });

    const box=$('#flist');
    box.innerHTML='';
    box.className=viewMode==='grid'?'filegrid':'filelist';

    if(!items.length){
      box.innerHTML=`<div class="col" style="align-items:center;justify-content:center;padding:48px 20px;grid-column:1/-1;color:var(--muted)">
        <div style="width:48px;height:48px;margin-bottom:8px;opacity:.5">${ICON('files')}</div>
        <div style="font-size:14.5px;font-weight:700">${searchQuery?'No files match "'+searchQuery+'"':'This folder is empty'}</div>
        <div class="sub" style="margin-top:4px">Drag and drop files here to upload into /${currentPath}</div>
      </div>`;
    }else if(viewMode==='grid'){
      items.forEach(it=>box.append(createGridCard(it)));
    }else{
      items.forEach(it=>box.append(createListRow(it)));
    }

    const fileCount=items.filter(i=>!i.dir).length;
    const dirCount=items.filter(i=>i.dir).length;
    const totalBytes=items.filter(i=>!i.dir).reduce((sum,i)=>sum+(i.size||0),0);
    $('#f-count-info').textContent=`${fileCount} file${fileCount===1?'':'s'}${dirCount?` • ${dirCount} folder${dirCount===1?'':'s'}`:''} (${fmtSize(totalBytes)})`;
  }

  function createGridCard(it){
    const full=(currentPath?currentPath+'/':'')+it.name;
    if(it.dir){
      const card=el(`
        <div class="fcard is-dir">
          <div class="fcard-thumb-wrap">
            ${ICON('folder',52)}
          </div>
          <div class="fcard-body">
            <div class="fcard-title" title="${it.name}">${it.name}</div>
            <div class="fcard-meta">
              <span style="font-weight:700">Folder</span>
              <span style="color:#00E5FF;font-weight:800">Open ›</span>
            </div>
          </div>
        </div>
      `);
      card.onclick=()=>{currentPath=full;load();};
      return card;
    }

    const is3mf=/\.3mf$/i.test(it.name);
    const card=el(`
      <div class="fcard">
        <div class="fcard-thumb-wrap">
          <div class="fcard-thumb-fallback">${ICON('cube',56)}</div>
          <img class="fcard-img" style="display:none" alt="">
          <span class="fcard-badge-type ${is3mf?'mf':''}">${is3mf?'.3MF':'.GCODE'}</span>
          <span class="fcard-badge-size">${fmtSize(it.size)}</span>
        </div>
        <div class="fcard-body">
          <div class="fcard-title" title="${it.name}">${it.name}</div>
          <div class="fcard-chips">
            <span class="fcard-chip fc-time">${ICON('clock',12)} <span class="time-val">${fmtTime(it.time)}</span></span>
            <span class="fcard-chip fc-fil">🧵 <span class="fil-val">${it.fil?it.fil+'m':'--'}</span></span>
          </div>
          <div class="fcard-meta">
            <span class="fc-slicer">${it.slicer||'--'}</span>
            <span>${fmtDate(it.mod)}</span>
          </div>
          <div class="fcard-actions">
            <div class="fcard-sub-actions">
              <button class="btn sm fc-info" title="File details">${ICON('info',14)} Info</button>
              <button class="btn sm fc-save" title="Save / Download G-code to computer">${ICON('download',14)} Save</button>
              <button class="btn sm fc-del" title="Delete file" style="color:#EF4444">${ICON('trash',14)} Delete</button>
            </div>
            <div class="fcard-main-actions">
              <button class="btn sm fc-load" style="border-color:rgba(0,229,255,.5);color:#00E5FF;font-weight:800" title="Load file ready to print & preview in 3D">📥 Load</button>
              <button class="btn pri sm fc-print" style="font-weight:800" title="Start print immediately">🚀 Print</button>
            </div>
          </div>
        </div>
      </div>
    `);

    $('.fc-info',card).onclick=e=>{e.stopPropagation();showDetails(full,it);};
    $('.fc-save',card).onclick=e=>{
      e.stopPropagation();
      const a=document.createElement('a');
      a.href=(MR.base||'')+'/server/files/gcodes/'+encodeURI(full);
      a.download=it.name;
      a.click();
      toast(`💾 Downloading ${it.name}…`);
    };
    $('.fc-del',card).onclick=e=>{e.stopPropagation();confirmDelete(it,full);};
    $('.fc-load',card).onclick=e=>{e.stopPropagation();loadFileForPrint(full,it);};
    $('.fc-print',card).onclick=e=>{
      e.stopPropagation();
      confirmBox('Start Print?',`Begin printing "${it.name}" immediately?`,'Start Print',async()=>{
        toast('Starting print…');
        try{await MR.startPrint(full);go('printing');}catch(err){toast('⚠ Start failed: '+err.message);}
      });
    };
    card.onclick=()=>showDetails(full,it);

    loadThumbAndMeta(full,card);
    return card;
  }

  function createListRow(it){
    const full=(currentPath?currentPath+'/':'')+it.name;
    if(it.dir){
      const row=el(`
        <div class="frow">
          <div class="frow-thumb" style="color:#00E5FF">${ICON('folder',26)}</div>
          <div class="frow-main">
            <div class="frow-title">${it.name}</div>
            <div class="frow-sub"><span>Folder</span></div>
          </div>
          <div class="frow-actions">
            <button class="btn sm pri" style="font-weight:700">Open ›</button>
          </div>
        </div>
      `);
      row.onclick=()=>{currentPath=full;load();};
      return row;
    }

    const is3mf=/\.3mf$/i.test(it.name);
    const row=el(`
      <div class="frow">
        <div class="frow-thumb">
          <div class="row-thumb-fallback">${ICON('cube',24)}</div>
          <img class="row-thumb-img" style="display:none" alt="">
        </div>
        <div class="frow-main">
          <div class="frow-title" title="${it.name}">${it.name}</div>
          <div class="frow-sub">
            <span class="mono" style="color:${is3mf?'#C084FC':'#00E5FF'};font-weight:700">${is3mf?'.3MF':'.GCODE'}</span>
            <span>•</span>
            <span class="frow-slicer">${it.slicer||'--'}</span>
            <span>•</span>
            <span>${fmtDate(it.mod)}</span>
          </div>
        </div>
        <div class="frow-chips">
          <span class="fcard-chip r-time">${ICON('clock',12)} <span class="time-val">${fmtTime(it.time)}</span></span>
          <span class="fcard-chip r-fil">🧵 <span class="fil-val">${it.fil?it.fil+'m':'--'}</span></span>
          <span class="mono" style="font-weight:700">${fmtSize(it.size)}</span>
        </div>
        <div class="frow-actions">
          <button class="btn sm r-info" title="File details">${ICON('info',16)}</button>
          <button class="btn sm r-save" title="Save / Download G-code to computer">${ICON('download',16)}</button>
          <button class="btn sm r-del" title="Delete file" style="color:#EF4444">${ICON('trash',16)}</button>
          <button class="btn sm r-load" style="border-color:rgba(0,229,255,.5);color:#00E5FF;font-weight:800;padding:6px 12px;font-size:12.5px" title="Load file ready to print & preview in 3D">📥 Load</button>
          <button class="btn pri sm r-print" style="font-weight:800;padding:6px 14px;font-size:12.5px" title="Start print immediately">🚀 Print</button>
        </div>
      </div>
    `);

    $('.r-info',row).onclick=e=>{e.stopPropagation();showDetails(full,it);};
    $('.r-save',row).onclick=e=>{
      e.stopPropagation();
      const a=document.createElement('a');
      a.href=(MR.base||'')+'/server/files/gcodes/'+encodeURI(full);
      a.download=it.name;
      a.click();
      toast(`💾 Downloading ${it.name}…`);
    };
    $('.r-del',row).onclick=e=>{e.stopPropagation();confirmDelete(it,full);};
    $('.r-load',row).onclick=e=>{e.stopPropagation();loadFileForPrint(full,it);};
    $('.r-print',row).onclick=e=>{
      e.stopPropagation();
      confirmBox('Start Print?',`Begin printing "${it.name}" immediately?`,'Start Print',async()=>{
        toast('Starting print…');
        try{await MR.startPrint(full);go('printing');}catch(err){toast('⚠ Start failed: '+err.message);}
      });
    };
    row.onclick=()=>showDetails(full,it);

    loadThumbAndMeta(full,row);
    return row;
  }

  async function loadThumbAndMeta(full,container){
    let m=metaCache[full];
    if(!m){
      try{
        m=await MR.meta(full);
        if(m)metaCache[full]=m;
      }catch(e){}
    }
    if(!m)return;

    if(m.estimated_time){
      const tEls=container.querySelectorAll('.time-val');
      tEls.forEach(el=>el.textContent=fmtTime(m.estimated_time));
    }
    if(m.filament_total){
      const fEls=container.querySelectorAll('.fil-val');
      fEls.forEach(el=>el.textContent=(m.filament_total/1000).toFixed(1)+'m');
    }
    if(m.slicer){
      const sEls=container.querySelectorAll('.fc-slicer, .frow-slicer');
      sEls.forEach(el=>el.textContent=m.slicer);
    }

    if(m.localThumbUrl){
      const img=container.querySelector('.fcard-img, .row-thumb-img');
      const fallback=container.querySelector('.fcard-thumb-fallback, .row-thumb-fallback');
      if(img){
        img.src=m.localThumbUrl;
        img.style.display='block';
        if(fallback)fallback.style.display='none';
      }
    }else if(m.thumbnails?.length){
      const t=m.thumbnails.sort((a,b)=>b.width-a.width)[0];
      const dir=full.includes('/')?full.slice(0,full.lastIndexOf('/')+1):'';
      const url=MR.thumbURL(dir+t.relative_path);
      const img=container.querySelector('.fcard-img, .row-thumb-img');
      const fallback=container.querySelector('.fcard-thumb-fallback, .row-thumb-fallback');
      if(img){
        img.src=url;
        img.onload=()=>{
          img.style.display='block';
          if(fallback)fallback.style.display='none';
        };
      }
    }
  }

  function checkPrePrintWarnings(m,it){
    const warnings=[];
    const sp=App.getActiveSpool?.();
    if(!sp)return {warnings,sp:null};
    const reqGrams=m.filament_weight_total||(m.filament_total?m.filament_total*0.00298:0);
    let fileMat=(m.filament_type||'').toUpperCase();
    if(!fileMat&&it?.name){
      const match=it.name.toUpperCase().match(/\b(PLA|PETG|ABS|TPU|ASA|NYLON)\b/);
      if(match)fileMat=match[1];
    }
    const spoolMat=(sp.type||'PLA').toUpperCase();
    if(fileMat&&!fileMat.includes(spoolMat)&&!spoolMat.includes(fileMat)){
      warnings.push(`Material mismatch: File sliced for <b>${fileMat}</b>, but active spool is <b>${sp.name} (${spoolMat})</b>.`);
    }
    const flNoz=Number(m.first_layer_extr_temp)||0;
    if(flNoz>0&&Math.abs(flNoz-(sp.nozzle||205))>18){
      warnings.push(`Nozzle temp notice: File first layer is <b>${Math.round(flNoz)}°C</b> vs spool preset <b>${sp.nozzle}°C</b>.`);
    }
    const remG=sp.weight!==undefined?Number(sp.weight):1000;
    if(reqGrams>0&&reqGrams>remG){
      warnings.push(`Low filament warning: Print needs <b>${reqGrams.toFixed(1)} g</b>, but active spool only has <b>${Math.round(remG)} g</b> left.`);
    }
    return {warnings,sp,reqGrams,fileMat};
  }

  async function showDetails(full,it){
    const m=metaCache[full]||(await MR.meta(full))||{};
    const t=m.thumbnails?.length?m.thumbnails.sort((a,b)=>b.width-a.width)[0]:null;
    const dir=full.includes('/')?full.slice(0,full.lastIndexOf('/')+1):'';
    const thumbSrc=m.localThumbUrl||(t?MR.thumbURL(dir+t.relative_path):'');
    const filGrams=m.filament_weight_total?m.filament_weight_total.toFixed(1)+' g':m.filament_total?(m.filament_total*0.00298).toFixed(1)+' g':'--';
    const filMeters=m.filament_total?(m.filament_total/1000).toFixed(2)+' m':'--';
    const check=checkPrePrintWarnings(m,it);

    const warnBanner=check.warnings.length
      ?`<div class="box" style="margin:8px 0;background:rgba(245,158,11,.12);border:1.5px solid rgba(251,191,36,.5);color:#FDE68A;font-size:12px;line-height:1.45">
         <div style="font-weight:900;color:#FBBF24;margin-bottom:3px">⚠ PRE-PRINT HEALTH CHECK WARNING</div>
         ${check.warnings.map(w=>`<div>• ${w}</div>`).join('')}
       </div>`
      :(check.sp?`<div class="box row" style="margin:8px 0;padding:7px 12px;background:rgba(16,185,129,.1);border:1px solid rgba(52,211,153,.35);color:#6EE7B7;font-size:12px;align-items:center;justify-content:space-between">
         <span>✓ <b>Pre-Print Check Passed</b> — Ready for active spool <b>${check.sp.name} (${check.sp.type})</b></span>
         <span class="mono" style="font-weight:800">${Math.round(check.sp.weight??1000)}g avail</span>
       </div>`:'');

    const n=el(`<div class="dlg" style="max-width:580px;border:1.5px solid rgba(0,229,255,.4)">
      <div class="row" style="align-items:center;margin-bottom:8px">
        <div style="width:28px;color:#00E5FF">${ICON('cube')}</div>
        <h3 class="grow fn" style="margin:0;font-size:16px" title="${it.name}">${it.name}</h3>
        <button class="x" id="dx">✕</button>
      </div>
      ${warnBanner}
      <div class="row" style="gap:14px;margin:10px 0">
        <div style="width:180px;height:180px;background:#070B14;border-radius:12px;border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none">
          ${thumbSrc?`<img src="${thumbSrc}" style="width:100%;height:100%;object-fit:contain">`:`<div style="color:rgba(56,189,248,.35)">${ICON('cube',72)}</div>`}
        </div>
        <div class="box grow" style="display:flex;flex-direction:column;gap:6px;font-size:12.5px">
          ${[
            ['Estimated Print Time',fmtTime(m.estimated_time)],
            ['Filament Length',filMeters],
            ['Filament Weight',filGrams],
            ['Filament Type',m.filament_type||check.fileMat||'--'],
            ['Layer Height',m.layer_height?m.layer_height+' mm':'--'],
            ['First Layer Height',m.first_layer_height?m.first_layer_height+' mm':'--'],
            ['Object Height',m.object_height?m.object_height+' mm':'--'],
            ['Slicer',m.slicer||'--'],
            ['File Size',fmtSize(it.size)],
            ['Last Modified',fmtDate(it.mod)]
          ].map(([k,v])=>`<div class="row" style="justify-content:space-between"><span style="color:var(--muted)">${k}:</span><b style="color:#F8FAFC">${v}</b></div>`).join('')}
        </div>
      </div>
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:12px">
        <button class="btn danger sm" id="ddel" style="gap:4px">${ICON('trash')} Delete File</button>
        <div class="row" style="gap:8px">
          <button class="btn" id="dc">Close</button>
          <button class="btn sm" id="dsave" title="Save / Download G-code to computer">${ICON('download')} Save</button>
          <button class="btn sm" id="dload" style="border-color:rgba(0,229,255,.45);color:#00E5FF;font-weight:800;padding:8px 16px" title="Load file ready to print and preview in 3D">📥 LOAD FILE</button>
          <button class="btn pri" id="ds" style="font-weight:800;padding:8px 18px">🚀 START PRINT</button>
        </div>
      </div>
    </div>`);

    const close=modal(n);
    $('#dx',n).onclick=$('#dc',n).onclick=close;
    $('#ddel',n).onclick=()=>{close();confirmDelete(it,full);};
    $('#dsave',n).onclick=()=>{
      const a=document.createElement('a');
      a.href=(MR.base||'')+'/server/files/gcodes/'+encodeURI(full);
      a.download=it.name;
      a.click();
      toast(`💾 Downloading ${it.name}…`);
    };
    $('#dload',n).onclick=()=>{close();loadFileForPrint(full,it);};
    $('#ds',n).onclick=async()=>{
      close();
      toast('Starting print…');
      try{
        await MR.startPrint(full);
        go('printing');
      }catch(e){
        toast('⚠ Start print failed: '+e.message);
      }
    };
  }

  async function loadFileForPrint(full,it){
    const name=it?.name||full.split('/').pop();
    toast(`Loading "${name}"…`);
    App.loadedFile={
      filename:full,
      name:name,
      size:it?.size||0,
      mod:it?.mod||(Date.now()/1000),
      loadedAt:Date.now()
    };
    try{localStorage.setItem('klipper_loaded_file',JSON.stringify(App.loadedFile));}catch(e){}

    try{await MR.gcode('M23 '+full);}catch(e){console.warn('M23 load:',e);}

    if(window.GCodeViewer&&full.toLowerCase().endsWith('.gcode')){
      const gcodeUrl=(MR.base||'')+'/server/files/gcodes/'+encodeURI(full);
      window.GCodeViewer.loadFromUrl(gcodeUrl,name);
    }

    if(typeof App.updateLoadedUI==='function'){
      App.updateLoadedUI();
    }

    toast(`📥 Loaded: ${name} (ready to print)`);
    go('printing');
  }
  App.loadFileForPrint=loadFileForPrint;

  async function openTimelapsesModal(){
    const n=el(`<div class="dlg" style="max-width:680px;border:1.5px solid rgba(192,132,252,.45)">
      <div class="row" style="align-items:center;margin-bottom:10px">
        <span style="font-size:20px">🎬</span>
        <div class="grow">
          <h3 style="margin:0;font-size:16px">Moonraker Timelapse Videos</h3>
          <div class="sub">Recorded print timelapses from /server/files/timelapse</div>
        </div>
        <button class="btn sm" id="tl-ref">⟳ Refresh</button>
        <button class="x" id="tl-x">✕</button>
      </div>
      <div id="tl-player-wrap" style="display:none;margin-bottom:10px;background:#050811;border:1px solid rgba(192,132,252,.35);border-radius:12px;padding:8px">
        <video id="tl-video" controls style="width:100%;max-height:280px;border-radius:8px;background:#000"></video>
        <div class="row" style="justify-content:space-between;align-items:center;margin-top:6px">
          <span class="mono" id="tl-now" style="font-size:12px;color:#E9D5FF;font-weight:700"></span>
          <a class="btn sm pri" id="tl-dl-active" download style="text-decoration:none">⬇ Download Video</a>
        </div>
      </div>
      <div id="tl-list" class="col" style="max-height:290px;overflow-y:auto;gap:6px">
        <div class="sub" style="padding:20px;text-align:center">Loading timelapse files…</div>
      </div>
    </div>`);
    const close=modal(n);
    $('#tl-x',n).onclick=close;
    const loadTL=async()=>{
      const box=$('#tl-list',n);
      box.innerHTML='<div class="sub" style="padding:20px;text-align:center">Scanning timelapse directory…</div>';
      const files=await MR.listTimelapses();
      const vids=(files||[]).filter(f=>/\.(mp4|webm|mkv|avi|gif)$/i.test(f.path||f.filename||'')).sort((a,b)=>(b.modified||0)-(a.modified||0));
      if(!vids.length){
        box.innerHTML=`<div class="box col" style="align-items:center;padding:24px;text-align:center;color:var(--muted)">
          <div style="font-size:28px;margin-bottom:6px">🎬</div>
          <b style="color:#E2E8F0">No Timelapse Videos Found Yet</b>
          <div class="sub" style="max-width:440px;margin-top:4px">When <code>[timelapse]</code> is active in Moonraker, recorded <code>.mp4</code> print videos appear here automatically for playback and download.</div>
        </div>`;
        return;
      }
      box.innerHTML='';
      vids.forEach(v=>{
        const name=v.path||v.filename;
        const url=MR.timelapseURL(name);
        const r=el(`<div class="row box" style="align-items:center;justify-content:space-between;padding:8px 12px">
          <div class="col" style="min-width:0">
            <b class="fn" style="color:#F8FAFC;font-size:13px">${name}</b>
            <span class="sub" style="font-size:11px">${fmtSize(v.size)} • ${fmtDate(v.modified)}</span>
          </div>
          <div class="row" style="gap:6px">
            <button class="btn sm pri tl-play">▶ Play</button>
            <a class="btn sm" href="${url}" download="${name}" style="text-decoration:none">⬇</a>
            <button class="btn sm danger tl-del">${ICON('trash',14)}</button>
          </div>
        </div>`);
        $('.tl-play',r).onclick=()=>{
          const pw=$('#tl-player-wrap',n),vid=$('#tl-video',n);
          pw.style.display='block';
          vid.src=url;
          vid.play().catch(()=>{});
          $('#tl-now',n).textContent=name;
          $('#tl-dl-active',n).href=url;
          $('#tl-dl-active',n).setAttribute('download',name);
        };
        $('.tl-del',r).onclick=()=>confirmBox('Delete Timelapse?',`Delete "${name}" permanently?`,'Delete',async()=>{
          await MR.deleteTimelapse(name);
          toast('Deleted '+name);
          loadTL();
        },true);
        box.append(r);
      });
    };
    $('#tl-ref',n).onclick=loadTL;
    loadTL();
  }

  function confirmDelete(it,full){
    confirmBox('Delete File?',`Are you sure you want to permanently delete "${it.name}"?`,'Delete',async()=>{
      try{
        await MR.deleteFile(full);
        toast(`✓ Deleted ${it.name}`);
        load();
      }catch(err){
        toast('⚠ Delete failed: '+err.message);
      }
    },true);
  }

  function promptNewFolder(){
    const n=el(`<div class="dlg" style="max-width:400px">
      <h3>Create New Folder</h3>
      <div class="sub">Target: /${currentPath?currentPath+'/':''}</div>
      <input id="new-folder-name" placeholder="Folder name" style="width:100%;margin:12px 0;padding:8px 10px;border-radius:8px">
      <div class="row" style="justify-content:flex-end;gap:8px">
        <button class="btn" id="nfc">Cancel</button>
        <button class="btn pri" id="nfs">Create Folder</button>
      </div>
    </div>`);
    const close=modal(n);
    $('#nfc',n).onclick=close;
    $('#nfs',n).onclick=async()=>{
      const name=$('#new-folder-name',n).value.trim();
      if(!name)return;
      const targetPath=(currentPath?currentPath+'/':'')+name;
      try{
        await MR.createDirectory(targetPath);
        close();
        toast('✓ Created folder '+name);
        load();
      }catch(err){
        toast('⚠ Failed to create folder');
      }
    };
  }

  // Fast client-side thumbnail & meta extractor for .gcode and .3mf
  async function extractThumbnailFromFile(file){
    if(!file)return null;
    const name=(file.name||'').toLowerCase();

    // 1. G-CODE file thumbnail extraction
    if(/\.(gcode|gco|g)$/i.test(name)){
      return new Promise(resolve=>{
        const reader=new FileReader();
        const slice=file.slice(0,Math.min(file.size,1024*1024));
        reader.onload=e=>{
          const text=e.target.result;
          if(!text)return resolve(null);
          const matches=[...text.matchAll(/;\s*thumbnail(?:_JPG)?\s+begin\s+(\d+)x(\d+)\s+\d+[\r\n]+([\s\S]*?)[\r\n]+;\s*thumbnail(?:_JPG)?\s+end/gi)];
          if(!matches.length)return resolve(null);
          matches.sort((a,b)=>(+b[1]*+b[2])-(+a[1]*+a[2]));
          const best=matches[0];
          const isJpg=/_JPG/i.test(best[0]);
          const b64=best[3].replace(/[;\r\n\s]/g,'');
          if(!b64)return resolve(null);
          resolve({
            url:`data:image/${isJpg?'jpeg':'png'};base64,${b64}`,
            width:+best[1],
            height:+best[2]
          });
        };
        reader.onerror=()=>resolve(null);
        reader.readAsText(slice);
      });
    }

    // 2. 3MF file thumbnail extraction
    if(/\.3mf$/i.test(name)){
      return new Promise(resolve=>{
        const reader=new FileReader();
        const slice=file.slice(0,Math.min(file.size,2*1024*1024));
        reader.onload=e=>{
          try{
            const buf=new Uint8Array(e.target.result);
            let pngStart=-1;
            for(let i=0;i<buf.length-8;i++){
              if(buf[i]===0x89&&buf[i+1]===0x50&&buf[i+2]===0x4E&&buf[i+3]===0x47&&
                 buf[i+4]===0x0D&&buf[i+5]===0x0A&&buf[i+6]===0x1A&&buf[i+7]===0x0A){
                pngStart=i;
                break;
              }
            }
            if(pngStart===-1)return resolve(null);
            let pngEnd=-1;
            for(let i=pngStart;i<buf.length-4;i++){
              if(buf[i]===0x49&&buf[i+1]===0x45&&buf[i+2]===0x4E&&buf[i+3]===0x44){
                pngEnd=i+8;
                break;
              }
            }
            if(pngEnd===-1)return resolve(null);
            const pngSlice=buf.subarray(pngStart,pngEnd);
            let binary='';
            const chunkSize=8192;
            for(let i=0;i<pngSlice.length;i+=chunkSize){
              binary+=String.fromCharCode.apply(null,pngSlice.subarray(i,i+chunkSize));
            }
            resolve({
              url:`data:image/png;base64,${btoa(binary)}`,
              width:300,
              height:300
            });
          }catch(err){
            resolve(null);
          }
        };
        reader.onerror=()=>resolve(null);
        reader.readAsArrayBuffer(slice);
      });
    }

    return null;
  }

  async function extractMetaFromFile(file){
    if(!file||!/\.(gcode|gco|g)$/i.test(file.name||''))return {};
    return new Promise(resolve=>{
      const reader=new FileReader();
      const slice=file.slice(0,Math.min(file.size,256*1024));
      reader.onload=e=>{
        const text=e.target.result||'';
        const meta={};
        const slMatch=text.match(/;\s*(?:generated by|Generated with)\s+([^\r\n]+)/i);
        if(slMatch)meta.slicer=slMatch[1].trim();
        const timeMatch=text.match(/;\s*(?:estimated printing time \(normal mode\)|TIME)\s*[:=]\s*([^\r\n]+)/i);
        if(timeMatch)meta.time=timeMatch[1].trim();
        const filMatch=text.match(/;\s*(?:filament used \[(?:mm|m)\]|Filament used)\s*[:=]\s*([^\r\n]+)/i);
        if(filMatch)meta.filament=filMatch[1].trim();
        resolve(meta);
      };
      reader.onerror=()=>resolve({});
      reader.readAsText(slice);
    });
  }

  function promptUpload(fileList){
    const isSingle=fileList.length===1;
    const firstFile=fileList[0];
    const totalBytes=fileList.reduce((acc,f)=>acc+(f.size||0),0);
    const title=isSingle?`Upload ${firstFile.name}`:`Upload ${fileList.length} Files`;
    const destPath='/'+(currentPath?currentPath+'/':'');
    const is3mf=/\.3mf$/i.test(firstFile.name);

    let extractedThumb=null;
    let extractedInfo={};

    const n=el(`<div class="dlg" style="max-width:580px;border:2px solid var(--cyan);box-shadow:0 0 40px rgba(0,229,255,.35)">
      <div class="row" style="align-items:center;margin-bottom:12px">
        <div style="width:34px;height:34px;border-radius:10px;background:rgba(0,229,255,.15);display:flex;align-items:center;justify-content:center;color:#00E5FF;margin-right:10px">
          ${ICON('upload',22)}
        </div>
        <h3 class="grow fn" style="margin:0;font-size:16px">${title}</h3>
        <button class="x" id="ux">✕</button>
      </div>

      <!-- Thumbnail & File Info Box -->
      <div class="row box" style="gap:14px;margin-bottom:14px;background:rgba(15,23,42,.75);border:1px solid rgba(255,255,255,.1);align-items:center">
        <div id="u-thumb-box" style="width:130px;height:130px;background:#070B14;border-radius:12px;border:1px solid rgba(0,229,255,.25);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none;position:relative">
          <div id="u-thumb-placeholder" style="color:rgba(56,189,248,.35)">
            ${ICON('cube',52)}
          </div>
          <img id="u-thumb-img" style="width:100%;height:100%;object-fit:contain;display:none" alt="Model Preview">
          <span id="u-thumb-badge" class="fcard-badge-type ${is3mf?'mf':''}" style="position:absolute;top:6px;left:6px;font-size:9.5px">${is3mf?'.3MF':'.GCODE'}</span>
        </div>

        <div class="col grow" style="gap:5px;font-size:12.5px;min-width:0">
          <div class="fn" style="font-size:14.5px;color:#F8FAFC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${firstFile.name}">
            ${firstFile.name}
          </div>
          <div class="row" style="margin-top:2px;font-size:12.5px">
            <span style="color:var(--muted);min-width:92px">Target folder:</span>
            <span class="mono" style="color:#00E5FF;font-weight:800;background:rgba(0,229,255,.1);padding:2px 8px;border-radius:6px">${destPath}</span>
          </div>
          <div class="row" style="font-size:12.5px">
            <span style="color:var(--muted);min-width:92px">File size:</span>
            <b style="color:#F8FAFC">${fmtSize(totalBytes)}</b>
          </div>
          <div id="u-meta-row" class="row" style="gap:6px;margin-top:4px;flex-wrap:wrap">
            <span class="fcard-chip" id="u-chip-fmt" style="color:#00E5FF">${is3mf?'3D Manufacturing Format':'.gcode sliced model'}</span>
          </div>
          ${!isSingle?`<div class="sub mono" style="font-size:11px;max-height:50px;overflow-y:auto;border-top:1px solid rgba(255,255,255,.08);padding-top:4px;margin-top:4px">+ ${fileList.length-1} other file(s) in batch</div>`:''}
        </div>
      </div>

      <div class="upload-pbar" id="u-pbar" style="display:none;margin-bottom:8px">
        <div class="upload-pbar-fill" id="u-fill"></div>
      </div>
      <div class="row" id="u-status-row" style="display:none;justify-content:space-between;margin-bottom:12px;font-size:12px;font-weight:700">
        <span id="u-status-text" style="color:var(--cyan)">Uploading…</span>
        <span id="u-status-pct" class="mono" style="color:#F8FAFC">0%</span>
      </div>

      <div class="sub" style="margin-bottom:16px;font-size:12.5px;line-height:1.4">
        Choose whether to <b>save to printer folder</b> or <b>upload and begin printing immediately</b>:
      </div>

      <div class="row" style="justify-content:flex-end;gap:10px" id="u-btns">
        <button class="btn" id="u-cancel">Cancel</button>
        <button class="btn" id="u-just-upload" style="font-weight:800;border-color:rgba(255,255,255,.18)">
          ⬆ Just Upload
        </button>
        <button class="btn pri" id="u-upload-print" style="font-weight:900;font-size:13.5px;padding:8px 18px">
          🚀 Upload & Print
        </button>
      </div>
    </div>`);

    const close=modal(n);
    $('#ux',n).onclick=$('#u-cancel',n).onclick=close;

    // Trigger asynchronous thumbnail & meta preview
    if(firstFile.previewUrl){
      // Pre-provided preview (e.g. from test)
      extractedThumb={url:firstFile.previewUrl};
      const img=$('#u-thumb-img',n);
      img.src=firstFile.previewUrl;
      img.style.display='block';
      $('#u-thumb-placeholder',n).style.display='none';
    } else if(firstFile instanceof Blob){
      extractThumbnailFromFile(firstFile).then(thumb=>{
        if(thumb?.url){
          extractedThumb=thumb;
          const img=$('#u-thumb-img',n);
          img.src=thumb.url;
          img.style.display='block';
          $('#u-thumb-placeholder',n).style.display='none';
        }
      });
      extractMetaFromFile(firstFile).then(meta=>{
        extractedInfo=meta;
        const metaRow=$('#u-meta-row',n);
        if(meta.slicer){
          const sChip=el(`<span class="fcard-chip">${meta.slicer}</span>`);
          metaRow.append(sChip);
        }
        if(meta.time){
          const tChip=el(`<span class="fcard-chip">${ICON('clock',12)} ${meta.time}</span>`);
          metaRow.append(tChip);
        }
        if(meta.filament){
          const fChip=el(`<span class="fcard-chip">🧵 ${meta.filament}</span>`);
          metaRow.append(fChip);
        }
      });
    }

    const startUpload=async autoPrint=>{
      $('#u-cancel',n).disabled=true;
      $('#u-just-upload',n).disabled=true;
      $('#u-upload-print',n).disabled=true;
      $('#u-pbar',n).style.display='block';
      $('#u-status-row',n).style.display='flex';
      const statusText=$('#u-status-text',n);
      const statusPct=$('#u-status-pct',n);
      const fillEl=$('#u-fill',n);

      try{
        for(let i=0;i<fileList.length;i++){
          const file=fileList[i];
          const shouldPrint=autoPrint&&(i===fileList.length-1);
          statusText.textContent=`Uploading (${i+1}/${fileList.length}): ${file.name}`;
          await MR.uploadFile(file,currentPath,shouldPrint,pct=>{
            const p=Math.round(pct*100);
            fillEl.style.width=p+'%';
            statusPct.textContent=p+'%';
          });

          // Optimistically insert file into current directory cache immediately
          const full=(currentPath?currentPath+'/':'')+file.name;
          const newItem={
            dir:0,
            name:file.name,
            size:file.size||0,
            mod:Math.floor(Date.now()/1000),
            time:extractedInfo?.time||0,
            fil:extractedInfo?.filament||0,
            slicer:extractedInfo?.slicer||''
          };
          if(extractedThumb?.url){
            metaCache[full]={
              localThumbUrl:extractedThumb.url,
              thumbnails:[{relative_path:''}],
              slicer:extractedInfo?.slicer||''
            };
          }
          const exIdx=cachedItems.findIndex(x=>x.name===file.name);
          if(exIdx!==-1){
            cachedItems[exIdx]=newItem;
          }else{
            const firstNonDir=cachedItems.findIndex(x=>!x.dir);
            if(firstNonDir!==-1)cachedItems.splice(firstNonDir,0,newItem);
            else cachedItems.push(newItem);
          }
          filterAndRender();
        }

        close();
        if(autoPrint){
          toast(`🚀 Uploaded & started: ${fileList[0].name}`);
          go('printing');
        }else{
          toast(`✓ Uploaded ${fileList.length===1?fileList[0].name:fileList.length+' files'}`);
        }
        // Sync with Moonraker in background
        setTimeout(load,500);
        setTimeout(load,2000);
      }catch(err){
        fillEl.style.background='#EF4444';
        statusText.style.color='#EF4444';
        statusText.textContent='⚠ Upload failed: '+(err.message||'Server error');
        $('#u-cancel',n).disabled=false;
        $('#u-cancel',n).textContent='Close';
      }
    };

    $('#u-just-upload',n).onclick=()=>startUpload(false);
    $('#u-upload-print',n).onclick=()=>startUpload(true);
  }

  // Bind controls
  const dropzone=$('#fdrop');
  const fileInput=$('#f-file-input');
  const uploadBtn=$('#f-upload-btn');

  dropzone.onclick=e=>{if(e.target!==fileInput)fileInput.click();};
  uploadBtn.onclick=()=>fileInput.click();

  fileInput.onchange=e=>{
    if(e.target.files?.length){
      promptUpload(Array.from(e.target.files));
      fileInput.value='';
    }
  };

  ['dragenter','dragover'].forEach(evt=>{
    dropzone.addEventListener(evt,e=>{
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave','dragend'].forEach(evt=>{
    dropzone.addEventListener(evt,e=>{
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop',e=>{
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
    if(e.dataTransfer?.files?.length){
      promptUpload(Array.from(e.dataTransfer.files));
    }
  });

  // Window drag overlay
  const overlay=$('#drag-fullscreen-overlay');
  let dragCounter=0;
  window.addEventListener('dragenter',e=>{
    if(e.dataTransfer?.types?.includes('Files')){
      dragCounter++;
      if(overlay)overlay.classList.add('active');
    }
  });
  window.addEventListener('dragleave',e=>{
    dragCounter=Math.max(0,dragCounter-1);
    if(dragCounter===0&&overlay)overlay.classList.remove('active');
  });
  window.addEventListener('dragover',e=>{
    if(e.dataTransfer?.types?.includes('Files')){
      e.preventDefault();
    }
  });
  window.addEventListener('drop',e=>{
    dragCounter=0;
    if(overlay)overlay.classList.remove('active');
    if(e.dataTransfer?.files?.length){
      e.preventDefault();
      promptUpload(Array.from(e.dataTransfer.files));
    }
  });

  const searchInput=$('#f-search-input');
  const searchClear=$('#f-search-clear');
  searchInput.oninput=()=>{
    searchQuery=searchInput.value.trim().toLowerCase();
    searchClear.style.display=searchQuery?'inline-block':'none';
    filterAndRender();
  };
  searchClear.onclick=()=>{
    searchInput.value='';
    searchQuery='';
    searchClear.style.display='none';
    filterAndRender();
    searchInput.focus();
  };

  const sortSelect=$('#f-sort');
  sortSelect.value=sortMode;
  sortSelect.onchange=()=>{
    sortMode=sortSelect.value;
    localStorage.setItem('files_sort',sortMode);
    filterAndRender();
  };

  const viewToggle=$('#f-view-toggle');
  viewToggle.onclick=()=>{
    viewMode=viewMode==='grid'?'list':'grid';
    localStorage.setItem('files_view',viewMode);
    viewToggle.innerHTML=viewMode==='grid'?ICON('list',16)+' List':ICON('grid',16)+' Grid';
    filterAndRender();
  };

  $('#f-history-btn').onclick=()=>go('history');
  $('#f-timelapse-btn').onclick=openTimelapsesModal;
  $('#f-mkdir-btn').onclick=promptNewFolder;
  $('#f-refresh-btn').onclick=load;

  async function load(){
    viewMode=localStorage.getItem('files_view')||viewMode;
    const vt=$('#f-view-toggle');
    if(vt)vt.innerHTML=viewMode==='grid'?ICON('list',16)+' List':ICON('grid',16)+' Grid';
    renderBreadcrumbs();
    if(!cachedItems.length){
      cachedItems=DEFAULT_ITEMS;
      filterAndRender();
    }

    try{
      const r=await MR.listFiles(currentPath);
      if(r&&r.files){
        const dirs=(r.dirs||[]).filter(d=>!d.dirname.startsWith('.')).map(d=>({dir:1,name:d.dirname,size:0,mod:d.modified||0}));
        const files=(r.files||[]).filter(f=>/\.(gcode|g|gco|3mf)$/i.test(f.filename)).map(f=>({
          dir:0,
          name:f.filename,
          size:f.size,
          mod:f.modified,
          time:f.estimated_time||0,
          fil:f.filament_total?(f.filament_total/1000).toFixed(1):0,
          slicer:f.slicer||''
        }));
        cachedItems=dirs.concat(files);
        if(r.disk_usage){
          diskStats=r.disk_usage;
          $('#f-disk-info').textContent=`Disk: ${fmtSize(diskStats.free)} free of ${fmtSize(diskStats.total)}`;
        }
        filterAndRender();
      }
    }catch(err){
      $('#f-disk-info').textContent='Printer offline (cached view)';
    }
  }

  MR.on('connection',ok=>ok&&load());
  MR.on('filelist_changed',()=>load());
  window._testPrompt=promptUpload;
  return {show:load};
})();

/* ---- Printing ---- */
App.pages.printing=(()=>{
  const root=$('#p-printing');let z0=0,babysteps=0,printBabystep=0,curFileMeta=null;
  root.innerHTML=`
   <div class="print-custom-bar">
     <div style="display:flex;align-items:center;gap:8px;color:#94A3B8;font-weight:700">
       <span class="drag-grip" style="color:#00E5FF;font-size:16px">⠿</span>
       <span>Customizable Print Layout: drag card headers to rearrange</span>
     </div>
     <button class="btn sm" id="btn-reset-layout" style="font-size:11.5px;padding:4px 10px;border-color:rgba(255,255,255,0.15)">↺ Reset Layout</button>
   </div>

   <div class="print-grid">
    <div class="print-col" id="print-col-1">
      <!-- 3D G-Code Visualizer Card (collapsed by default) -->
      <div class="card print-card gcode-card is-collapsed" id="card-visualizer" data-card-id="visualizer">
        <div class="card-top-handle" title="Drag to rearrange card">
          <span class="drag-grip">⠿</span>
          <b class="card-drag-title">${CICON('speed')} 3D G-CODE VISUALIZER & NOZZLE</b>
          <span class="grow"></span>
          <span class="sub" style="font-size:11px;color:#38BDF8;font-weight:700">ROTATABLE 3D VIEW</span>
          <button class="card-collapse-btn" title="Collapse / Expand card">▶</button>
        </div>
        <div class="card-content">
          <div id="gcode-container" style="width:100%;height:380px;position:relative"></div>
        </div>
      </div>

      <!-- Print Job & Toolhead Info -->
      <div class="card print-card" id="card-fileinfo" data-card-id="fileinfo" style="display:flex;flex-direction:column;align-items:stretch">
        <div class="card-top-handle" title="Drag to rearrange card">
          <span class="drag-grip">⠿</span>
          <b class="card-drag-title">${CICON('file')} CURRENT PRINT JOB & TOOLHEAD</b>
          <span class="grow"></span>
          <button class="card-collapse-btn" title="Collapse / Expand card">▼</button>
        </div>
        <div class="card-content">
          <div class="print-file" style="width:100%;align-items:flex-start;gap:14px">
            <img id="pthumb" class="thumb" alt="" style="width:110px;height:110px;border-radius:12px;background:#070B14;border:1px solid rgba(0,229,255,.25);object-fit:contain;flex:none">
            <div class="fico">${CICON('file')}</div>
            <div class="grow col" style="min-width:0;gap:3px">
              <div class="fn pf" id="pfile" style="font-size:16.5px;font-weight:800;color:#F8FAFC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">No print</div>
              <div class="mono" id="p-layer-line" style="font-size:14.5px;font-weight:800;color:#38BDF8">Layer: 0 / 0</div>
              <div class="mono" id="p-z-line" style="font-size:14px;font-weight:700;color:#E2E8F0">Z: 0.00 mm</div>
              <div class="mono" id="p-xy-line" style="font-size:14px;font-weight:700;color:#E2E8F0">X: 0.0   Y: 0.0 mm</div>
              <div class="mono" id="p-spd-line" style="font-size:14px;font-weight:800;color:#34D399">Speed: 0 mm/s</div>
              <div class="sub pa" id="pact" style="font-size:12.5px!important;color:#94A3B8;margin-top:1px">Idle</div>
            </div>
          </div>
          <div id="ploaded-bar" style="display:none;margin-top:12px;padding:8px 12px;background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.3);border-radius:10px;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              <span style="color:#00E5FF;font-weight:900;font-size:16px;flex:none">📥</span>
              <div style="min-width:0">
                <div style="font-size:11px;font-weight:800;color:#00E5FF;text-transform:uppercase;letter-spacing:.5px">File Loaded Ready To Print</div>
                <div id="ploaded-name" style="font-size:13.5px;font-weight:700;color:#F8FAFC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
              </div>
            </div>
            <div style="display:flex;gap:6px;flex:none">
              <button class="btn sm" id="btn-unload-file" style="border-color:rgba(239,68,68,.3);color:#EF4444" title="Unload file">✕ Unload</button>
              <button class="btn pri sm" id="btn-start-loaded" style="font-weight:800;background:linear-gradient(135deg,#00E5FF,#2563EB);border:none;padding:6px 16px;box-shadow:0 0 12px rgba(0,229,255,.4)">🚀 START PRINT</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Z Adjust Offset Card -->
      <div class="card print-card" id="card-zoffset" data-card-id="zoffset">
        <div class="card-top-handle" title="Drag to rearrange card">
          <span class="drag-grip">⠿</span>
          <b class="card-drag-title">${CICON('offset')} LIVE Z-OFFSET / BABYSTEPS</b>
          <span class="grow"></span>
          <button class="card-collapse-btn" title="Collapse / Expand card">▼</button>
        </div>
        <div class="card-content">
          <div class="row" style="align-items:baseline">
            <span class="big" id="pz">+0.000 mm</span>
            <span class="sub grow" id="pbs">Baby steps added: 0</span>
          </div>
          <div class="grid4" style="margin-top:8px">
            <button class="btn xl" data-z="-0.05">-0.05</button>
            <button class="btn xl" data-z="-0.01">-0.01</button>
            <button class="btn xl" data-z="0.01">+0.01</button>
            <button class="btn xl" data-z="0.05">+0.05</button>
          </div>
        </div>
      </div>
    </div>

    <div class="print-col" id="print-col-2">
      <!-- Print Progress Card -->
      <div class="card print-card col" id="card-progress" data-card-id="progress">
        <div class="card-top-handle" title="Drag to rearrange card">
          <span class="drag-grip">⠿</span>
          <b class="card-drag-title">${CICON('hourglass')} PRINT PROGRESS & ESTIMATES</b>
          <span class="grow"></span>
          <span class="pill info pbig" id="pstate">STANDBY</span>
          <button class="card-collapse-btn" title="Collapse / Expand card">▼</button>
        </div>
        <div class="card-content col" style="gap:8px">
          <div class="row" style="align-items:center">
            <div class="ppct" id="ppct">0%</div>
            <span class="grow"></span>
            <span class="pill pbig" id="pzo">Z-Offset --</span>
          </div>
          <div class="pbar big"><i id="pfill"></i><span id="pbt"></span></div>
          <div class="grid3">
            <div class="tile"><div class="tic">${CICON('clock')}</div><div class="k">ELAPSED</div><div class="vv" id="pel">--</div></div>
            <div class="tile"><div class="tic">${CICON('hourglass')}</div><div class="k">REMAINING</div><div class="vv" id="prem">--</div></div>
            <div class="tile"><div class="tic">${CICON('flag')}</div><div class="k">PRINT ETA</div><div class="vv" id="peta">--</div></div>
          </div>
          <div class="grid3" style="margin-top:8px">
            <div class="tile"><div class="tic">${CICON('clock')}</div><div class="k">SLICER TOTAL</div><div class="vv" id="psltot" style="color:#38BDF8">--</div></div>
            <div class="tile"><div class="tic">${CICON('hourglass')}</div><div class="k">SLICER LEFT</div><div class="vv" id="pslrem" style="color:#FBBF24">--</div></div>
            <div class="tile"><div class="tic">${CICON('flag')}</div><div class="k">SLICER ETA</div><div class="vv" id="psleta" style="color:#C084FC">--</div></div>
          </div>
        </div>
      </div>

      <!-- Temperatures & Overrides Card -->
      <div class="card print-card" id="card-metrics" data-card-id="metrics">
        <div class="card-top-handle" title="Drag to rearrange card">
          <span class="drag-grip">⠿</span>
          <b class="card-drag-title">${CICON('tune')} TEMPERATURES & PRINT OVERRIDES</b>
          <span class="grow"></span>
          <span class="sub" style="font-size:11px">TAP TO TUNE</span>
          <button class="card-collapse-btn" title="Collapse / Expand card">▼</button>
        </div>
        <div class="card-content">
          <div class="grid3" id="pmet">
            <div class="tile" id="pt-nozzle" title="Tap to adjust Nozzle temperature" style="cursor:pointer;border-color:rgba(255,122,0,.38)"><div class="tic">${CICON('nozzle')}</div><div class="k">NOZZLE <small style="color:#FF7A00;font-size:9px">● TUNE</small></div><div class="vv" id="pm-noz">--</div></div>
            <div class="tile" id="pt-bed" title="Tap to adjust Bed temperature" style="cursor:pointer;border-color:rgba(0,229,255,.38)"><div class="tic">${CICON('bed')}</div><div class="k">BED <small style="color:#00E5FF;font-size:9px">● TUNE</small></div><div class="vv" id="pm-bed">--</div></div>
            <div class="tile"><div class="tic">${CICON('layers')}</div><div class="k">LAYER</div><div class="vv" id="pm-lay" style="color:#C084FC">0/0</div></div>
            <div class="tile"><div class="tic">${CICON('speed')}</div><div class="k">SPEED</div><div class="vv" id="pm-spd">100%</div></div>
            <div class="tile"><div class="tic">${CICON('flow')}</div><div class="k">FLOW</div><div class="vv" id="pm-flw">100%</div></div>
            <div class="tile"><div class="tic">${CICON('fan')}</div><div class="k">FAN</div><div class="vv" id="pm-fan">0%</div></div>
          </div>
        </div>
      </div>

      <!-- Print Actions Card -->
      <div class="card print-card" id="card-controls" data-card-id="controls">
        <div class="card-top-handle" title="Drag to rearrange card">
          <span class="drag-grip">⠿</span>
          <b class="card-drag-title">${CICON('power')} PRINT ACTIONS & CONTROLS</b>
          <span class="grow"></span>
          <button class="card-collapse-btn" title="Collapse / Expand card">▼</button>
        </div>
        <div class="card-content">
          <div id="ploaded-ctrls" style="display:none;margin-bottom:10px">
            <button class="btn xl pri" id="pstart-loaded" style="width:100%;font-weight:900;font-size:15px;background:linear-gradient(135deg,#00E5FF,#2563EB);border:none;box-shadow:0 0 16px rgba(0,229,255,.45);padding:14px;display:flex;align-items:center;justify-content:center;gap:8px">
              <span>🚀 START PRINT:</span> <span id="pstart-loaded-lbl" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
            </button>
          </div>
          <div class="grid4" id="pbtns">
            <button class="btn xl pri" id="ppause">⏸ Pause</button>
            <button class="btn xl" id="pexclude" style="border-color:rgba(251,191,36,.45);color:#FBBF24" title="Cancel individual failed object during print">🎯 Exclude</button>
            <button class="btn xl" id="ptune">${ICON('tune',20)} Fine Tune</button>
            <button class="btn xl danger" id="pcancel">✕ Cancel</button>
          </div>
          <div class="grid2" id="pdone" style="display:none">
            <button class="btn xl green" id="psave">Save Z-Offset</button>
            <button class="btn xl pri" id="phome">Return Home</button>
          </div>
        </div>
      </div>

      <!-- Camera Monitor Card -->
      <div class="card print-card cam-card" id="card-camera" data-card-id="camera">
        <div class="card-top-handle" title="Drag to rearrange card">
          <span class="drag-grip">⠿</span>
          <b class="card-drag-title">${CICON('camera')} WEBCAM MONITOR</b>
          <span class="sub" id="camst">connecting…</span>
          <span class="grow"></span>
          <button class="btn sm" id="camsnap" title="Save Camera Snapshot">📸 Snap</button>
          <button class="btn sm" id="camfs" title="Fullscreen & Flip/Rotate">⛶ Expand</button>
          <button class="btn sm" id="camset">⚙</button>
          <button class="card-collapse-btn" title="Collapse / Expand card">▼</button>
        </div>
        <div class="card-content">
          <div class="cam-box" id="cambox" style="cursor:pointer">
            <img id="camimg" alt="" crossorigin="anonymous">
            <div class="cam-empty" id="camempty">No webcam found.<br><small>Tap ⚙ to enter a stream URL</small></div>
          </div>
        </div>
      </div>
    </div>
   </div>`;

  // Initialize drag & drop and card ordering
  function initCardDnD() {
    const col1 = $('#print-col-1', root);
    const col2 = $('#print-col-2', root);
    const cards = root.querySelectorAll('.print-card');

    function saveLayout() {
      const c1 = Array.from(col1.children).filter(c=>c.dataset?.cardId).map(c=>c.dataset.cardId);
      const c2 = Array.from(col2.children).filter(c=>c.dataset?.cardId).map(c=>c.dataset.cardId);
      localStorage.setItem('klipper_print_layout_v2', JSON.stringify({ col1: c1, col2: c2 }));
    }

    function applySavedLayout() {
      let layout = null;
      try {
        const raw = localStorage.getItem('klipper_print_layout_v2');
        if (raw) layout = JSON.parse(raw);
      } catch (e) {}

      if (!layout || !layout.col1 || !layout.col2) {
        layout = {
          col1: ['visualizer', 'fileinfo', 'zoffset'],
          col2: ['progress', 'metrics', 'controls', 'camera']
        };
      }

      const cardMap = {};
      cards.forEach(c => cardMap[c.dataset.cardId] = c);

      layout.col1.forEach(id => { if (cardMap[id]) col1.appendChild(cardMap[id]); });
      layout.col2.forEach(id => { if (cardMap[id]) col2.appendChild(cardMap[id]); });
      cards.forEach(c => {
        if (!c.parentElement) col1.appendChild(c);
      });
    }

    applySavedLayout();

    $('#btn-reset-layout', root).onclick = () => {
      localStorage.removeItem('klipper_print_layout_v2');
      applySavedLayout();
      toast('Print layout reset to default');
    };

    let draggedCard = null;

    cards.forEach(card => {
      const handle = card.querySelector('.card-top-handle');
      if (!handle) return;

      handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('.card-collapse-btn') || e.target.closest('button')) return;
        card.setAttribute('draggable', 'true');
      });
      handle.addEventListener('mouseup', () => {
        card.setAttribute('draggable', 'false');
      });

      card.addEventListener('dragstart', (e) => {
        draggedCard = card;
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.cardId);
      });

      card.addEventListener('dragend', () => {
        card.setAttribute('draggable', 'false');
        card.classList.remove('is-dragging');
        cards.forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
        col1.classList.remove('col-drag-over');
        col2.classList.remove('col-drag-over');
        draggedCard = null;
        saveLayout();
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedCard || draggedCard === card) return;
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          card.classList.add('drag-over-top');
          card.classList.remove('drag-over-bottom');
        } else {
          card.classList.add('drag-over-bottom');
          card.classList.remove('drag-over-top');
        }
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggedCard || draggedCard === card) return;
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          card.parentNode.insertBefore(draggedCard, card);
        } else {
          card.parentNode.insertBefore(draggedCard, card.nextSibling);
        }
        card.classList.remove('drag-over-top', 'drag-over-bottom');
        saveLayout();
      });

      // Touch / pointer drag support for tablets & touchscreens
      let touchStartY = 0;
      let isTouching = false;
      handle.addEventListener('touchstart', (e) => {
        if (e.target.closest('.card-collapse-btn') || e.target.closest('button')) return;
        if (e.touches.length !== 1) return;
        touchStartY = e.touches[0].clientY;
        isTouching = true;
      }, { passive: true });

      handle.addEventListener('touchmove', (e) => {
        if (!isTouching || e.touches.length !== 1) return;
        const cy = e.touches[0].clientY;
        const cx = e.touches[0].clientX;
        if (Math.abs(cy - touchStartY) > 15) {
          card.classList.add('is-dragging');
          const target = document.elementFromPoint(cx, cy)?.closest('.print-card');
          cards.forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
          if (target && target !== card) {
            const rect = target.getBoundingClientRect();
            if (cy < rect.top + rect.height / 2) {
              target.classList.add('drag-over-top');
            } else {
              target.classList.add('drag-over-bottom');
            }
          }
        }
      }, { passive: true });

      handle.addEventListener('touchend', (e) => {
        if (!isTouching) return;
        isTouching = false;
        card.classList.remove('is-dragging');
        const touch = e.changedTouches[0];
        if (touch) {
          const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.print-card');
          if (target && target !== card) {
            const rect = target.getBoundingClientRect();
            if (touch.clientY < rect.top + rect.height / 2) {
              target.parentNode.insertBefore(card, target);
            } else {
              target.parentNode.insertBefore(card, target.nextSibling);
            }
            saveLayout();
          }
        }
        cards.forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
      });
    });

    [col1, col2].forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('col-drag-over');
      });
      col.addEventListener('dragleave', (e) => {
        if (!col.contains(e.relatedTarget)) {
          col.classList.remove('col-drag-over');
        }
      });
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('col-drag-over');
        if (draggedCard && !col.contains(draggedCard)) {
          col.appendChild(draggedCard);
          saveLayout();
        }
      });
    });
  }

  initCardDnD();

  // Collapsible cards support with visualizer collapsed by default
  function initCollapsibleCards() {
    let collapsedCards = {};
    try {
      const raw = localStorage.getItem('klipper_print_collapsed_cards');
      if (raw) collapsedCards = JSON.parse(raw);
    } catch (e) {}

    // Visualizer card is collapsed by default unless explicitly expanded by user
    if (collapsedCards.visualizer === undefined) {
      collapsedCards.visualizer = true;
    }

    root.querySelectorAll('.print-card').forEach(card => {
      const id = card.dataset.cardId;
      const btn = card.querySelector('.card-collapse-btn');
      const isCollapsed = !!collapsedCards[id];
      card.classList.toggle('is-collapsed', isCollapsed);
      if (btn) btn.textContent = isCollapsed ? '▶' : '▼';

      if (btn) {
        btn.onclick = (e) => {
          e.stopPropagation();
          const nowCollapsed = !card.classList.contains('is-collapsed');
          card.classList.toggle('is-collapsed', nowCollapsed);
          btn.textContent = nowCollapsed ? '▶' : '▼';
          collapsedCards[id] = nowCollapsed;
          try {
            localStorage.setItem('klipper_print_collapsed_cards', JSON.stringify(collapsedCards));
          } catch(err) {}

          if (!nowCollapsed && id === 'visualizer' && window.GCodeViewer) {
            setTimeout(() => window.GCodeViewer.fitBed(), 80);
          }
        };
      }
    });
  }
  initCollapsibleCards();

  // Loaded File State & Controls
  try {
    const _savedLf = localStorage.getItem('klipper_loaded_file');
    if (_savedLf) App.loadedFile = JSON.parse(_savedLf);
  } catch(e) {}

  function updateLoadedUI(currState) {
    const s = stat();
    const ps = s.print_stats || {};
    const state = currState || ps.state || 'standby';
    const isPrinting = (state === 'printing' || state === 'paused');
    const loaded = App.loadedFile;

    const bar = $('#ploaded-bar', root);
    const barName = $('#ploaded-name', root);
    const ctrls = $('#ploaded-ctrls', root);
    const ctrlLbl = $('#pstart-loaded-lbl', root);

    if (loaded && !isPrinting) {
      if (bar) {
        bar.style.display = 'flex';
        if (barName) barName.textContent = loaded.name;
      }
      if (ctrls) {
        ctrls.style.display = 'block';
        if (ctrlLbl) ctrlLbl.textContent = loaded.name;
      }
      if (!ps.filename || ps.filename === 'No print') {
        const pfile = $('#pfile', root);
        if (pfile) pfile.textContent = `[Loaded] ${loaded.name}`;
        const pact = $('#pact', root);
        if (pact) pact.textContent = 'File loaded — Ready to start';
        if (loaded.filename) {
          MR.meta(loaded.filename).then(m => {
            if (!m) return;
            const t = m?.thumbnails?.sort((a,b)=>b.width-a.width)[0];
            if (t) {
              const d = loaded.filename.includes('/') ? loaded.filename.slice(0, loaded.filename.lastIndexOf('/') + 1) : '';
              $('#pthumb', root).src = MR.thumbURL(d + t.relative_path);
            }
          });
        }
      }
    } else {
      if (bar) bar.style.display = 'none';
      if (ctrls) ctrls.style.display = 'none';
      if (isPrinting && loaded) {
        App.loadedFile = null;
        try { localStorage.removeItem('klipper_loaded_file'); } catch(e) {}
      }
    }
  }
  App.updateLoadedUI = updateLoadedUI;

  const btnStartLoaded = $('#btn-start-loaded', root);
  if (btnStartLoaded) {
    btnStartLoaded.onclick = () => {
      if (!App.loadedFile) return;
      confirmBox('Start Print?', `Begin printing "${App.loadedFile.name}" now?`, 'Start Print', async () => {
        toast('Starting print…');
        try {
          await MR.startPrint(App.loadedFile.filename);
        } catch(e) {
          toast('⚠ Start failed: ' + e.message);
        }
      });
    };
  }
  const pstartLoaded = $('#pstart-loaded', root);
  if (pstartLoaded) {
    pstartLoaded.onclick = () => btnStartLoaded?.click();
  }
  const btnUnloadFile = $('#btn-unload-file', root);
  if (btnUnloadFile) {
    btnUnloadFile.onclick = async () => {
      try {
        await MR.gcode('SDCARD_RESET_FILE');
      } catch(e) {}
      App.loadedFile = null;
      try { localStorage.removeItem('klipper_loaded_file'); } catch(e) {}
      $('#pfile', root).textContent = 'No print';
      $('#pact', root).textContent = 'Idle';
      $('#pthumb', root).removeAttribute('src');
      updateLoadedUI();
      toast('File unloaded');
    };
  }

  // Initialize G-Code 3D Visualizer
  if (window.GCodeViewer) {
    const gcBox = $('#gcode-container', root);
    if (gcBox) window.GCodeViewer.init(gcBox);
  }
  $('#pt-nozzle',root).onclick=()=>preheat('nozzle');
  $('#pt-bed',root).onclick=()=>preheat('bed');
  (function cam(){
    const img=$('#camimg'),st=$('#camst'),empty=$('#camempty');let timer=null,curSnapUrl=null,curStreamUrl=null;

    const getCamTf = () => {
      const fh = localStorage.getItem('cam_fliph') === '1';
      const fv = localStorage.getItem('cam_flipv') === '1';
      const rot = +(localStorage.getItem('cam_rot') ?? (localStorage.getItem('cam_rot180') === '1' ? 180 : 0));
      const sx = fh ? -1 : 1;
      const sy = fv ? -1 : 1;
      return `rotate(${rot}deg) scale(${sx}, ${sy})`;
    };

    const getCamFilter = () => {
      const b = +(localStorage.getItem('cam_bright') ?? 100);
      const c = +(localStorage.getItem('cam_contrast') ?? 100);
      const s = +(localStorage.getItem('cam_saturate') ?? 100);
      const inv = localStorage.getItem('cam_invert') === '1' ? 100 : 0;
      const sharp = localStorage.getItem('cam_sharp') || '0';
      let extra = '';
      if (sharp === '1') extra = ' contrast(120%)';
      if (sharp === '2') extra = ' contrast(140%) saturate(125%)';
      if (sharp === '3') extra = ' grayscale(100%) contrast(125%)';
      return `brightness(${b}%) contrast(${c}%) saturate(${s}%) invert(${inv}%)${extra}`;
    };

    const getCamFit = () => localStorage.getItem('cam_fit') || 'contain';

    const applyCamStyles = (targetEl) => {
      if (!targetEl) return;
      targetEl.style.transform = getCamTf();
      targetEl.style.filter = getCamFilter();
      targetEl.style.objectFit = getCamFit();
    };

    const absURL = u => {
      if (!u) return null;
      if (/^https?:/.test(u)) return u;
      const b = new URL(MR.base);
      return (u.startsWith('/') ? (b.port && b.port !== '7125' ? b.origin : b.protocol + '//' + b.hostname) : b.origin) + (u.startsWith('/') ? '' : '/') + u;
    };

    async function start() {
      clearInterval(timer);
      let url = localStorage.getItem('webcam_url'), snap = localStorage.getItem('webcam_snap_url');
      if (!url && MR.connected) {
        try {
          const r = await MR.get('/server/webcams/list');
          const w = (r.webcams || []).find(x => x.enabled !== false);
          if (w) {
            url = absURL(w.stream_url);
            snap = absURL(w.snapshot_url);
          }
        } catch (e) {}
      }
      curStreamUrl = url;
      curSnapUrl = snap || (url ? url.replace('action=stream', 'action=snapshot') : null);
      if (!url && !snap) {
        empty.style.display = 'flex';
        img.style.display = 'none';
        st.textContent = 'no camera';
        return;
      }
      empty.style.display = 'none';
      img.style.display = 'block';
      applyCamStyles(img);

      const mode = localStorage.getItem('cam_fps_mode') || 'stream';
      if (mode !== 'stream' && curSnapUrl) {
        const delay = mode === 'snap1' ? 1000 : mode === 'snap2' ? 2000 : 5000;
        st.textContent = `snapshot (${delay / 1000}s)`;
        const loadSnap = () => {
          img.src = curSnapUrl + (curSnapUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
        };
        loadSnap();
        timer = setInterval(loadSnap, delay);
      } else {
        st.textContent = (url || snap).replace(/^https?:\/\//, '');
        img.onerror = () => {
          if (curSnapUrl) {
            st.textContent = 'fallback 1s';
            img.onerror = null;
            const t = () => { img.src = curSnapUrl + (curSnapUrl.includes('?') ? '&' : '?') + 't=' + Date.now(); };
            t();
            timer = setInterval(t, 1000);
          } else {
            st.textContent = 'stream error';
          }
        };
        img.src = url || curSnapUrl;
      }
    }

    const takeSnapshot = () => {
      if (img && img.naturalWidth > 0) {
        try {
          const cv = document.createElement('canvas');
          const rot = +(localStorage.getItem('cam_rot') ?? (localStorage.getItem('cam_rot180') === '1' ? 180 : 0));
          const fh = localStorage.getItem('cam_fliph') === '1';
          const fv = localStorage.getItem('cam_flipv') === '1';
          const isSwapped = rot === 90 || rot === 270;
          cv.width = isSwapped ? img.naturalHeight : img.naturalWidth;
          cv.height = isSwapped ? img.naturalWidth : img.naturalHeight;
          const ctx = cv.getContext('2d');
          try { ctx.filter = getCamFilter(); } catch(e){}
          ctx.translate(cv.width / 2, cv.height / 2);
          ctx.rotate((rot * Math.PI) / 180);
          ctx.scale(fh ? -1 : 1, fv ? -1 : 1);
          ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
          cv.toBlob(b => {
            if (!b) return;
            const u = URL.createObjectURL(b);
            const a = document.createElement('a');
            a.href = u;
            a.download = `klipper-cam-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(u), 2000);
            toast('📸 Snapshot saved (with tuning & rotation)');
          });
          return;
        } catch (e) {
          console.warn('Canvas capture fallback:', e);
        }
      }
      if (curSnapUrl) {
        window.open(curSnapUrl, '_blank');
        toast('📸 Opened camera snapshot');
      } else {
        toast('⚠ No active camera frame to capture');
      }
    };

    const openCamStudio = (initialTab = 'tune') => {
      let activeTab = initialTab;
      let fh = localStorage.getItem('cam_fliph') === '1';
      let fv = localStorage.getItem('cam_flipv') === '1';
      let rot = +(localStorage.getItem('cam_rot') ?? (localStorage.getItem('cam_rot180') === '1' ? 180 : 0));
      let fit = getCamFit();
      let bright = +(localStorage.getItem('cam_bright') ?? 100);
      let contrast = +(localStorage.getItem('cam_contrast') ?? 100);
      let saturate = +(localStorage.getItem('cam_saturate') ?? 100);
      let invert = localStorage.getItem('cam_invert') === '1';
      let sharp = localStorage.getItem('cam_sharp') || '0';
      let fpsMode = localStorage.getItem('cam_fps_mode') || 'stream';

      const n = el(`<div class="dlg" style="max-width:760px;width:95vw;border:1.5px solid rgba(0,229,255,.45);padding:14px 18px">
        <div class="row" style="align-items:center;margin-bottom:8px">
          <b class="hico" style="color:#00E5FF;font-size:15px">${CICON('camera')} WEBCAM STUDIO & CONTROLS</b>
          <span class="grow"></span>
          <button class="btn sm pri" id="cs-snap">📸 Snap</button>
          <button class="btn sm" id="cs-native-fs">⛶ Fullscreen</button>
          <button class="x" id="cs-x">✕</button>
        </div>
        
        <!-- Live Preview Stage -->
        <div id="cs-view" style="height:320px;background:#050811;border-radius:12px;border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative">
          ${img && img.src && img.style.display !== 'none' ? `<img id="cs-img" src="${img.src}" style="max-width:100%;max-height:100%;object-fit:${fit}">` : `<div class="sub">No active webcam stream (${st.textContent})</div>`}
          <div style="position:absolute;bottom:8px;left:10px;background:rgba(0,0,0,.65);padding:3px 8px;border-radius:6px;font-size:11px;color:#A0AEC0;backdrop-filter:blur(4px)" id="cs-overlay-badge">
            ROT: ${rot}° | ${fh ? 'FLIP-H ' : ''}${fv ? 'FLIP-V ' : ''}| FIT: ${fit.toUpperCase()}
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="row" style="gap:6px;margin:12px 0 8px 0;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:8px;flex-wrap:wrap">
          <button class="btn sm ${activeTab === 'tune' ? 'on' : ''}" data-tab="tune" style="font-weight:800">🎨 Picture Tuning</button>
          <button class="btn sm ${activeTab === 'orient' ? 'on' : ''}" data-tab="orient" style="font-weight:800">🔄 Flip & Rotate</button>
          <button class="btn sm ${activeTab === 'res' ? 'on' : ''}" data-tab="res" style="font-weight:800">📐 Sizing & FPS</button>
          <button class="btn sm ${activeTab === 'url' ? 'on' : ''}" data-tab="url" style="font-weight:800">⚙ Stream URL</button>
        </div>

        <!-- Tab 1: Picture Tuning -->
        <div id="tab-tune" style="display:${activeTab === 'tune' ? 'block' : 'none'};margin-top:6px">
          <div class="grid2" style="gap:12px">
            <div class="box" style="padding:10px">
              <div class="row" style="justify-content:space-between;margin-bottom:4px">
                <span style="font-size:12.5px;font-weight:700">☀️ Brightness</span>
                <span class="sub" id="lbl-bright" style="font-weight:800;color:#00E5FF">${bright}%</span>
              </div>
              <input type="range" id="rng-bright" min="50" max="150" value="${bright}" style="width:100%">
            </div>
            <div class="box" style="padding:10px">
              <div class="row" style="justify-content:space-between;margin-bottom:4px">
                <span style="font-size:12.5px;font-weight:700">🌓 Contrast</span>
                <span class="sub" id="lbl-contrast" style="font-weight:800;color:#00E5FF">${contrast}%</span>
              </div>
              <input type="range" id="rng-contrast" min="50" max="150" value="${contrast}" style="width:100%">
            </div>
            <div class="box" style="padding:10px">
              <div class="row" style="justify-content:space-between;margin-bottom:4px">
                <span style="font-size:12.5px;font-weight:700">🌈 Saturation</span>
                <span class="sub" id="lbl-saturate" style="font-weight:800;color:#00E5FF">${saturate}%</span>
              </div>
              <input type="range" id="rng-saturate" min="0" max="200" value="${saturate}" style="width:100%">
            </div>
            <div class="box" style="padding:10px;display:flex;align-items:center;justify-content:space-between">
              <div>
                <b style="font-size:12.5px">🌙 Invert / Night View</b>
                <div class="sub" style="font-size:11px">Negative color profile for dark areas</div>
              </div>
              <button class="btn sm ${invert ? 'on' : ''}" id="btn-invert" style="min-width:70px;font-weight:800">${invert ? 'ON' : 'OFF'}</button>
            </div>
          </div>
          <div class="row" style="align-items:center;gap:6px;margin-top:10px;flex-wrap:wrap">
            <span class="sub" style="font-weight:800;font-size:11.5px">PRESETS:</span>
            <button class="btn sm ${sharp === '0' && !invert && bright === 100 && contrast === 100 && saturate === 100 ? 'on' : ''}" id="pre-def">Normal</button>
            <button class="btn sm ${sharp === '1' ? 'on' : ''}" id="pre-crisp">Crisp Detail</button>
            <button class="btn sm ${sharp === '2' ? 'on' : ''}" id="pre-vivid">Vivid Color</button>
            <button class="btn sm ${sharp === '3' ? 'on' : ''}" id="pre-mono">Monochrome B&W</button>
            <span class="grow"></span>
            <button class="btn sm" id="btn-reset-tune" style="color:#F87171">↺ Reset to Default</button>
          </div>
        </div>

        <!-- Tab 2: Flip & Rotate -->
        <div id="tab-orient" style="display:${activeTab === 'orient' ? 'block' : 'none'};margin-top:6px">
          <div class="col" style="gap:10px">
            <div class="box" style="padding:10px">
              <div style="font-weight:800;font-size:12px;color:#A0AEC0;margin-bottom:8px">ROTATION ANGLE:</div>
              <div class="row" style="gap:8px;flex-wrap:wrap">
                <button class="btn ${rot === 0 ? 'on' : ''}" data-rot="0" style="flex:1;min-width:65px">0° (Upright)</button>
                <button class="btn ${rot === 90 ? 'on' : ''}" data-rot="90" style="flex:1;min-width:65px">90° CW</button>
                <button class="btn ${rot === 180 ? 'on' : ''}" data-rot="180" style="flex:1;min-width:65px">180° Inverted</button>
                <button class="btn ${rot === 270 ? 'on' : ''}" data-rot="270" style="flex:1;min-width:65px">270° CCW</button>
                <button class="btn" id="btn-rot-step" title="Rotate +90 degrees">⟳ +90°</button>
              </div>
            </div>
            <div class="box" style="padding:10px">
              <div style="font-weight:800;font-size:12px;color:#A0AEC0;margin-bottom:8px">MIRRORING & FLIPPING:</div>
              <div class="row" style="gap:10px">
                <button class="btn ${fh ? 'on' : ''}" id="btn-fh" style="flex:1;font-weight:800">↔ Flip Horizontal (Mirror X)</button>
                <button class="btn ${fv ? 'on' : ''}" id="btn-fv" style="flex:1;font-weight:800">↕ Flip Vertical (Mirror Y)</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 3: Sizing & FPS -->
        <div id="tab-res" style="display:${activeTab === 'res' ? 'block' : 'none'};margin-top:6px">
          <div class="col" style="gap:10px">
            <div class="box" style="padding:10px">
              <div style="font-weight:800;font-size:12px;color:#A0AEC0;margin-bottom:8px">FRAME SIZING & FIT:</div>
              <div class="row" style="gap:8px">
                <button class="btn ${fit === 'contain' ? 'on' : ''}" data-fit="contain" style="flex:1">⏹ Contain (1:1 Ratio)</button>
                <button class="btn ${fit === 'cover' ? 'on' : ''}" data-fit="cover" style="flex:1">⛶ Cover (Fill Box)</button>
                <button class="btn ${fit === 'fill' ? 'on' : ''}" data-fit="fill" style="flex:1">↔ Stretch Full</button>
              </div>
            </div>
            <div class="box" style="padding:10px">
              <div style="font-weight:800;font-size:12px;color:#A0AEC0;margin-bottom:8px">STREAM MODE & BANDWIDTH:</div>
              <div class="row" style="gap:8px">
                <button class="btn ${fpsMode === 'stream' ? 'on' : ''}" data-fps="stream" style="flex:1">⚡ Full Video (MJPEG)</button>
                <button class="btn ${fpsMode === 'snap1' ? 'on' : ''}" data-fps="snap1" style="flex:1">🍃 Eco (1 FPS)</button>
                <button class="btn ${fpsMode === 'snap2' ? 'on' : ''}" data-fps="snap2" style="flex:1">⏱ 2 Sec Interval</button>
                <button class="btn ${fpsMode === 'snap5' ? 'on' : ''}" data-fps="snap5" style="flex:1">🐢 5 Sec Saver</button>
              </div>
            </div>
            <div class="box" style="padding:10px;background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.2)">
              <div style="font-weight:800;font-size:12px;color:#00E5FF;margin-bottom:4px">CAMERA SENSOR & RESOLUTION INFO:</div>
              <div class="sub" style="font-size:12px;line-height:1.5">
                • <b>Sensor:</b> Raspberry Pi Camera Module (OV5647 5-Megapixel CSI)<br>
                • <b>Native Formats:</b> 2592×1944 (Full 5MP) • 1296×972 (4:3 Stream Default) • 1280×720 (16:9 HD)<br>
                • <b>Streamer Daemon:</b> camera-streamer on port 8080 (Hardware YUYV capture)
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 4: Stream URL -->
        <div id="tab-url" style="display:${activeTab === 'url' ? 'block' : 'none'};margin-top:6px">
          <div class="col" style="gap:8px">
            <div class="sub">Primary Video Stream URL (MJPEG / H264):</div>
            <input id="in-stream-url" style="width:100%" value="${localStorage.getItem('webcam_url') || ''}" placeholder="e.g. /webcam/?action=stream or http://192.168.0.99:8080/?action=stream">
            <div class="sub">Direct Snapshot URL (Optional fallback):</div>
            <input id="in-snap-url" style="width:100%" value="${localStorage.getItem('webcam_snap_url') || ''}" placeholder="e.g. /webcam/?action=snapshot or http://192.168.0.99:8080/?action=snapshot">
            <div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap">
              <button class="btn sm" id="btn-pre-proxy">Use /webcam/ Proxy</button>
              <button class="btn sm" id="btn-pre-8080">Use Port 8080 Direct</button>
              <button class="btn sm" id="btn-auto-moonraker">🔍 Auto-Detect Moonraker</button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="row" style="justify-content:flex-end;margin-top:14px;gap:8px;border-top:1px solid rgba(255,255,255,.1);padding-top:10px">
          <button class="btn" id="cs-close">Close</button>
          <button class="btn pri" id="cs-save" style="font-weight:800">✓ Apply & Save</button>
        </div>
      </div>`);

      const cl = modal(n);
      const mImg = $('#cs-img', n);

      const syncUI = () => {
        localStorage.setItem('cam_fliph', fh ? '1' : '0');
        localStorage.setItem('cam_flipv', fv ? '1' : '0');
        localStorage.setItem('cam_rot', String(rot));
        localStorage.setItem('cam_rot180', rot === 180 ? '1' : '0');
        localStorage.setItem('cam_fit', fit);
        localStorage.setItem('cam_bright', String(bright));
        localStorage.setItem('cam_contrast', String(contrast));
        localStorage.setItem('cam_saturate', String(saturate));
        localStorage.setItem('cam_invert', invert ? '1' : '0');
        localStorage.setItem('cam_sharp', sharp);
        localStorage.setItem('cam_fps_mode', fpsMode);

        applyCamStyles(img);
        applyCamStyles(mImg);

        const badge = $('#cs-overlay-badge', n);
        if (badge) badge.textContent = `ROT: ${rot}° | ${fh ? 'FLIP-H ' : ''}${fv ? 'FLIP-V ' : ''}| FIT: ${fit.toUpperCase()}`;

        const lb = $('#lbl-bright', n); if (lb) lb.textContent = `${bright}%`;
        const lc = $('#lbl-contrast', n); if (lc) lc.textContent = `${contrast}%`;
        const ls = $('#lbl-saturate', n); if (ls) ls.textContent = `${saturate}%`;

        $('#btn-fh', n)?.classList.toggle('on', fh);
        $('#btn-fv', n)?.classList.toggle('on', fv);
        $('#btn-invert', n)?.classList.toggle('on', invert);
        if ($('#btn-invert', n)) $('#btn-invert', n).textContent = invert ? 'ON' : 'OFF';

        n.querySelectorAll('[data-rot]').forEach(b => b.classList.toggle('on', +b.dataset.rot === rot));
        n.querySelectorAll('[data-fit]').forEach(b => b.classList.toggle('on', b.dataset.fit === fit));
        n.querySelectorAll('[data-fps]').forEach(b => b.classList.toggle('on', b.dataset.fps === fpsMode));
      };

      syncUI();

      n.querySelectorAll('[data-tab]').forEach(btn => {
        btn.onclick = () => {
          activeTab = btn.dataset.tab;
          n.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b === btn));
          $('#tab-tune', n).style.display = activeTab === 'tune' ? 'block' : 'none';
          $('#tab-orient', n).style.display = activeTab === 'orient' ? 'block' : 'none';
          $('#tab-res', n).style.display = activeTab === 'res' ? 'block' : 'none';
          $('#tab-url', n).style.display = activeTab === 'url' ? 'block' : 'none';
        };
      });

      $('#cs-x', n).onclick = $('#cs-close', n).onclick = cl;
      $('#cs-snap', n).onclick = takeSnapshot;
      $('#cs-native-fs', n).onclick = () => $('#cs-view', n).requestFullscreen?.();

      $('#rng-bright', n).oninput = e => { bright = +e.target.value; syncUI(); };
      $('#rng-contrast', n).oninput = e => { contrast = +e.target.value; syncUI(); };
      $('#rng-saturate', n).oninput = e => { saturate = +e.target.value; syncUI(); };
      $('#btn-invert', n).onclick = () => { invert = !invert; syncUI(); };

      $('#pre-def', n).onclick = () => { bright = 100; contrast = 100; saturate = 100; invert = false; sharp = '0'; $('#rng-bright', n).value = 100; $('#rng-contrast', n).value = 100; $('#rng-saturate', n).value = 100; syncUI(); };
      $('#pre-crisp', n).onclick = () => { sharp = '1'; contrast = Math.max(contrast, 115); syncUI(); };
      $('#pre-vivid', n).onclick = () => { sharp = '2'; saturate = 135; contrast = 115; $('#rng-saturate', n).value = 135; $('#rng-contrast', n).value = 115; syncUI(); };
      $('#pre-mono', n).onclick = () => { sharp = '3'; saturate = 0; $('#rng-saturate', n).value = 0; syncUI(); };
      $('#btn-reset-tune', n).onclick = () => { bright = 100; contrast = 100; saturate = 100; invert = false; sharp = '0'; $('#rng-bright', n).value = 100; $('#rng-contrast', n).value = 100; $('#rng-saturate', n).value = 100; syncUI(); toast('Tuning reset to defaults'); };

      n.querySelectorAll('[data-rot]').forEach(b => {
        b.onclick = () => { rot = +b.dataset.rot; syncUI(); };
      });
      $('#btn-rot-step', n).onclick = () => { rot = (rot + 90) % 360; syncUI(); };
      $('#btn-fh', n).onclick = () => { fh = !fh; syncUI(); };
      $('#btn-fv', n).onclick = () => { fv = !fv; syncUI(); };

      n.querySelectorAll('[data-fit]').forEach(b => {
        b.onclick = () => { fit = b.dataset.fit; syncUI(); };
      });
      n.querySelectorAll('[data-fps]').forEach(b => {
        b.onclick = () => { fpsMode = b.dataset.fps; syncUI(); start(); };
      });

      $('#btn-pre-proxy', n).onclick = () => {
        $('#in-stream-url', n).value = '/webcam/?action=stream';
        $('#in-snap-url', n).value = '/webcam/?action=snapshot';
      };
      $('#btn-pre-8080', n).onclick = () => {
        const host = location.hostname || '192.168.0.99';
        $('#in-stream-url', n).value = `http://${host}:8080/?action=stream`;
        $('#in-snap-url', n).value = `http://${host}:8080/?action=snapshot`;
      };
      $('#btn-auto-moonraker', n).onclick = async () => {
        toast('🔍 Scanning Moonraker webcams…');
        try {
          const r = await MR.get('/server/webcams/list');
          const w = (r.webcams || []).find(x => x.enabled !== false);
          if (w) {
            $('#in-stream-url', n).value = absURL(w.stream_url) || '';
            $('#in-snap-url', n).value = absURL(w.snapshot_url) || '';
            toast('✓ Found webcam: ' + (w.name || 'default'));
          } else {
            toast('No active webcam reported by Moonraker');
          }
        } catch (e) {
          toast('Failed to query Moonraker webcams');
        }
      };

      $('#cs-save', n).onclick = () => {
        const u = $('#in-stream-url', n).value.trim();
        const su = $('#in-snap-url', n).value.trim();
        u ? localStorage.setItem('webcam_url', u) : localStorage.removeItem('webcam_url');
        su ? localStorage.setItem('webcam_snap_url', su) : localStorage.removeItem('webcam_snap_url');
        syncUI();
        start();
        cl();
        toast('✓ Camera settings saved');
      };
    };

    $('#camsnap').onclick = takeSnapshot;
    $('#camfs').onclick = () => openCamStudio('orient');
    $('#cambox').onclick = () => openCamStudio('orient');
    $('#camset').onclick = () => openCamStudio('tune');

    App.openCamStudio = openCamStudio;
    window.openCamStudio = openCamStudio;

    MR.on('connection', ok => ok && start());
    if (MR.connected) start();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { img.removeAttribute('src'); } else start();
    });
    App._camStart = start;
  })();
  const dur=s=>{s=Math.max(0,Math.round(s));return`${Math.floor(s/3600)}h ${String(Math.floor(s%3600/60)).padStart(2,'0')}m`};
  root.querySelectorAll('[data-z]').forEach(b=>b.onclick=()=>{MR.babystep(+b.dataset.z);babysteps++;z0+=+b.dataset.z;printBabystep=z0;upd()});
  const upd=()=>{$('#pz').textContent=(z0>=0?'+':'')+z0.toFixed(3)+' mm';$('#pbs').textContent='Baby steps added: '+babysteps};
  $('#ppause').onclick=()=>{const st=stat().print_stats?.state;st==='paused'?MR.resume():MR.pause()};
  $('#pexclude').onclick=excludeObjectModal;
  $('#pcancel').onclick=()=>confirmBox('Cancel print?','This will stop the print and turn off the heaters.','Cancel Print',()=>MR.cancel(),true);
  $('#ptune').onclick=fineTune;
  $('#psave').onclick=async()=>{
    const delta = Math.abs(z0) > 0.0001 ? z0 : printBabystep;
    if (Math.abs(delta) < 0.0001) {
      toast('No Z-offset babystep to save');
      return;
    }
    $('#psave').disabled = true;
    $('#psave').textContent = 'Saving & Restarting…';
    try {
      await MR.gcode(`SET_GCODE_OFFSET Z=${delta >= 0 ? '+' : ''}${delta.toFixed(4)} MOVE=0`);
      await MR.gcode('Z_OFFSET_APPLY_PROBE');
      await MR.saveConfig();
      toast(`Z-Offset (${(delta >= 0 ? '+' : '') + delta.toFixed(3)}mm) saved to printer.cfg!`);
      printBabystep = 0;
      z0 = 0;
      $('#psave').textContent = '✅ Saved to Config';
    } catch (e) {
      toast('Save failed: ' + (e.message || e));
      $('#psave').disabled = false;
      $('#psave').textContent = 'Save Z-Offset';
    }
  };
  $('#phome').onclick=()=>{MR.gcode('SDCARD_RESET_FILE');go('home')};
  let lastFile=null;
  MR.on('status',s=>{
    const ps=s.print_stats||{},vs=s.virtual_sdcard||{},ds=s.display_status||{};
    const state=ps.state||'standby';const prog=state==='complete'?1:(vs.progress||0);
    const done=state==='complete'||state==='cancelled'||state==='error';
    $('#pstate').textContent=state.toUpperCase();$('#pstate').className='pill pbig '+(state==='printing'?'ok':state==='paused'?'':state==='error'?'bad':'info');
    $('#ppct').textContent=Math.round(prog*100)+'%';$('#pfill').style.width=prog*100+'%';
    if(ps.filename!==lastFile){
      lastFile=ps.filename;
      curFileMeta=null;
      $('#pfile').textContent=ps.filename||'No print';
      if(ps.filename){
        MR.meta(ps.filename).then(m=>{
          if(!m)return;
          curFileMeta=m;
          const t=m?.thumbnails?.sort((a,b)=>b.width-a.width)[0];
          if(t){
            const d=ps.filename.includes('/')?ps.filename.slice(0,ps.filename.lastIndexOf('/')+1):'';
            $('#pthumb').src=MR.thumbURL(d+t.relative_path);
          }
        });
      }
    }
    const el_=ps.print_duration||0;$('#pel').textContent=dur(el_);
    const rem=prog>0.01&&(state==='printing'||state==='paused')?el_/prog-el_:null;
    $('#prem').textContent=rem!==null?dur(rem):'--';
    $('#peta').textContent=rem!==null?new Date(Date.now()+rem*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'--';

    const slicerEst=curFileMeta?.estimated_time||0;
    if(slicerEst>0){
      $('#psltot').textContent=dur(slicerEst);
      const slRem=Math.max(0,slicerEst-el_);
      $('#pslrem').textContent=dur(slRem);
      $('#psleta').textContent=state==='printing'||state==='paused'?new Date(Date.now()+slRem*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'--';
    }else{
      $('#psltot').textContent='--';$('#pslrem').textContent='--';$('#psleta').textContent='--';
    }

    const e=s.extruder||{},b=s.heater_bed||{},gm=s.gcode_move||{},tp=s.toolhead||{},fan=s.fan||{};
    const pos=(gm.gcode_position&&gm.gcode_position.length>=3)?gm.gcode_position:(tp.position||[0,0,0]);
    const xPos=pos[0]||0,yPos=pos[1]||0,zPos=pos[2]||0;
    const liveVel=Math.max(0,s.motion_report?.live_velocity||0);

    const l=ps.info||{};
    let curLayer=l.current_layer||0,totLayer=l.total_layer||0;
    if(!totLayer&&curFileMeta){
      const lh=curFileMeta.layer_height||0,flh=curFileMeta.first_layer_height||lh,oh=curFileMeta.object_height||0;
      if(lh>0&&oh>0){
        totLayer=Math.max(1,Math.round((oh-flh)/lh)+1);
        if(zPos>0&&(state==='printing'||state==='paused')){
          curLayer=Math.min(totLayer,Math.max(1,Math.round((zPos-flh)/lh)+1));
        }
      }
    }

    $('#p-layer-line').textContent=`Layer: ${curLayer} / ${totLayer}`;
    $('#p-z-line').textContent=`Z: ${zPos.toFixed(2)} mm`;
    $('#p-xy-line').textContent=`X: ${xPos.toFixed(1)}   Y: ${yPos.toFixed(1)} mm`;
    $('#p-spd-line').textContent=`Speed: ${liveVel.toFixed(0)} mm/s`;
    $('#pact').textContent=ds.message||(state==='printing'?`Printing — ${(prog*100).toFixed(1)}% complete`:state.charAt(0).toUpperCase()+state.slice(1));

    $('#pm-noz').innerHTML=`${(e.temperature||0).toFixed(0)}° <small>/ ${Math.round(e.target||0)}°C</small>`;
    $('#pm-bed').innerHTML=`${(b.temperature||0).toFixed(0)}° <small>/ ${Math.round(b.target||0)}°C</small>`;
    $('#pm-lay').textContent=`${curLayer}/${totLayer}`;
    $('#pm-spd').textContent=Math.round((gm.speed_factor||1)*100)+'%';
    $('#pm-flw').textContent=Math.round((gm.extrude_factor||1)*100)+'%';
    $('#pm-fan').textContent=Math.round((fan.speed||0)*100)+'%';

    if(gm.homing_origin){
      const liveZ = gm.homing_origin[2] || 0;
      if (Math.abs(liveZ) > 0.0001) { z0 = liveZ; printBabystep = liveZ; }
      else if (state === 'printing' || state === 'paused') { z0 = liveZ; }
      upd();
      $('#pzo').textContent='Z-Offset '+z0.toFixed(3);
    }
    if (state === 'starting') { printBabystep = 0; z0 = 0; babysteps = 0; }
    $('#pbtns').style.display=done?'none':'grid';
    $('#pdone').style.display=done?'grid':'none';
    if (done) {
      const eff = Math.abs(z0) > 0.0001 ? z0 : printBabystep;
      if (Math.abs(eff) > 0.0001) {
        $('#psave').textContent = `Save Z-Offset (${eff >= 0 ? '+' : ''}${eff.toFixed(3)}mm)`;
        $('#psave').disabled = false;
        $('#psave').className = 'btn xl green';
      } else {
        $('#psave').textContent = 'Z-Offset Unchanged';
        $('#psave').disabled = true;
        $('#psave').className = 'btn xl';
      }
    }
    $('#ppause').textContent=state==='paused'?'▶ Resume':'⏸ Pause';

    const isExt = (state === 'printing') && ((gm.extrude_factor || 1) > 0);
    if (window.GCodeViewer) {
      window.GCodeViewer.setPrinting(state === 'printing');
      window.GCodeViewer.updatePosition(xPos, yPos, zPos, liveVel, isExt, curLayer, totLayer);
    }
    updateLoadedUI(state);
  });
  return{
    show(){
      if (window.GCodeViewer) window.GCodeViewer.fitBed();
      updateLoadedUI();
    },
    onState(st){}
  };
})();
function fineTune(){
  const s=stat(),gm=s.gcode_move||{};
  let sp=Math.round((gm.speed_factor||1)*100),fl=Math.round((gm.extrude_factor||1)*100),fn=Math.round((s.fan?.speed||0)*100),zo=gm.homing_origin?gm.homing_origin[2]:0;
  const zs=[.005,.01,.025,.05],ps=[1,5,10,25];let si=1;
  const n=el(`<div class="dlg" style="max-width:680px;border:2px solid #00E5FF"><div class="row" style="align-items:center"><div style="width:24px">${ICON('tune')}</div><div class="grow"><b style="color:#00E5FF;font-size:14px;letter-spacing:.6px">FINE TUNE PRINT</b><div class="sub">Select Step Size • Tap readout to reset</div></div><button class="x" id="fx">✕</button></div>
   <div class="row box" style="margin:8px 0;align-items:center" id="fsteps"><b style="color:#00E5FF">STEP:</b></div><div class="row" id="fcols"></div>
   <button class="btn pri" style="width:100%;margin-top:10px" id="fdone">DONE / RETURN TO PRINT</button></div>`);
  const close=modal(n);
  ['0.005 mm / 1%','0.01 mm / 5%','0.025 mm / 10%','0.05 mm / 25%'].forEach((t,i)=>{const b=el(`<button class="btn sm grow ${i===si?'on':''}">${t}</button>`);b.onclick=()=>{si=i;$('#fsteps',n).querySelectorAll('.btn').forEach((x,k)=>x.classList.toggle('on',k===i));cols.forEach(c=>c.lbl())};$('#fsteps',n).append(b)});
  const cols=[];
  const col=(title,color,get,fmtv,stepTxt,up,down,reset)=>{
    const d=el(`<div class="box grow col" style="align-items:stretch;text-align:center"><b style="color:${color}">${title}</b><div class="sub st"></div><button class="btn" style="color:${color}">▲</button><div class="mono v" style="cursor:pointer;border:1.5px solid ${color};border-radius:6px;padding:8px;font-weight:900;background:rgba(0,0,0,.4)"></div><button class="btn">▼</button></div>`);
    const [u,dn]=d.querySelectorAll('.btn'),v=$('.v',d);
    const r=()=>{v.textContent=fmtv(get())};const lbl=()=>{$('.st',d).textContent='Step: '+stepTxt();};
    u.onclick=()=>{up();r()};dn.onclick=()=>{down();r()};v.onclick=()=>{reset();r()};r();lbl();$('#fcols',n).append(d);cols.push({lbl});
  };
  col('Z-OFFSET','#00E5FF',()=>zo,v=>(v>=0?'+':'')+v.toFixed(3)+' mm',()=>zs[si]+' mm',()=>{zo+=zs[si];MR.babystep(zs[si])},()=>{zo-=zs[si];MR.babystep(-zs[si])},()=>{MR.babystep(-zo);zo=0});
  col('SPEED','#38BDF8',()=>sp,v=>v+'%',()=>ps[si]+'%',()=>{sp=Math.min(500,sp+ps[si]);MR.speed(sp)},()=>{sp=Math.max(10,sp-ps[si]);MR.speed(sp)},()=>{sp=100;MR.speed(100)});
  col('FLOW','#34D399',()=>fl,v=>v+'%',()=>ps[si]+'%',()=>{fl=Math.min(300,fl+ps[si]);MR.flow(fl)},()=>{fl=Math.max(10,fl-ps[si]);MR.flow(fl)},()=>{fl=100;MR.flow(100)});
  col('FAN','#C084FC',()=>fn,v=>v+'%',()=>ps[si]+'%',()=>{fn=Math.min(100,fn+ps[si]);MR.fan(fn)},()=>{fn=Math.max(0,fn-ps[si]);MR.fan(fn)},()=>{fn=fn>0?0:100;MR.fan(fn)});
  $('#fx',n).onclick=$('#fdone',n).onclick=close;
}
function excludeObjectModal(){
  const getEO=()=>{
    const eo=stat().exclude_object||{};
    return {
      objects:Array.isArray(eo.objects)?eo.objects:[],
      excluded:Array.isArray(eo.excluded_objects)?eo.excluded_objects:[],
      current:eo.current_object||null
    };
  };
  const n=el(`<div class="dlg" style="max-width:680px;border:2px solid #FBBF24">
    <div class="row" style="align-items:center;margin-bottom:8px">
      <span style="font-size:20px">🎯</span>
      <div class="grow">
        <b style="color:#FBBF24;font-size:15px;letter-spacing:.5px">EXCLUDE OBJECT ([exclude_object])</b>
        <div class="sub">Tap an object on the 2D build plate or in the list to cancel only that failed part</div>
      </div>
      <button class="x" id="eo-x">✕</button>
    </div>
    <div class="grid2" style="gap:12px;align-items:stretch">
      <div class="box col" style="align-items:center;justify-content:center;background:#070B14;padding:10px">
        <canvas id="eo-canvas" width="270" height="270" style="width:270px;height:270px;border-radius:10px;border:1px solid rgba(255,255,255,.12);cursor:pointer;background:#050811"></canvas>
        <div class="row" style="gap:10px;margin-top:6px;font-size:11px;font-weight:700">
          <span style="color:#34D399">● Active</span>
          <span style="color:#00E5FF">● Current</span>
          <span style="color:#EF4444">✕ Excluded</span>
        </div>
      </div>
      <div class="col" style="gap:8px;max-height:310px;overflow-y:auto" id="eo-list"></div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:10px">
      <button class="btn pri" id="eo-close">Done</button>
    </div>
  </div>`);
  const close=modal(n);
  $('#eo-x',n).onclick=$('#eo-close',n).onclick=close;

  const hitBoxes=[];
  const render=()=>{
    if(!n.isConnected)return;
    const {objects,excluded,current}=getEO();
    const cv=$('#eo-canvas',n),ctx=cv.getContext('2d');
    const W=cv.width,H=cv.height;
    ctx.clearRect(0,0,W,H);
    // Grid lines (220x220mm bed)
    const bedSize=220;
    ctx.strokeStyle='rgba(148,163,184,0.12)';
    ctx.lineWidth=1;
    for(let g=0;g<=bedSize;g+=20){
      const px=(g/bedSize)*(W-24)+12;
      ctx.beginPath();ctx.moveTo(px,12);ctx.lineTo(px,H-12);ctx.stroke();
      ctx.beginPath();ctx.moveTo(12,px);ctx.lineTo(W-12,px);ctx.stroke();
    }
    const toScreen=(x,y)=>[12+(x/bedSize)*(W-24),H-12-(y/bedSize)*(H-24)];
    hitBoxes.length=0;

    const listBox=$('#eo-list',n);
    listBox.innerHTML='';

    if(!objects.length){
      ctx.fillStyle='#64748B';
      ctx.font='bold 12px system-ui, sans-serif';
      ctx.textAlign='center';
      ctx.fillText('No multi-object metadata in current print',W/2,H/2-8);
      ctx.font='11px system-ui, sans-serif';
      ctx.fillText('Enable "Label Objects" in Orca/Prusa/Cura',W/2,H/2+12);
      listBox.innerHTML=`<div class="box col" style="gap:6px;padding:14px;color:var(--muted)">
        <b style="color:#F8FAFC">No [exclude_object] parts loaded</b>
        <div class="sub">When printing a G-code sliced with <b>Label Objects / Exclude Objects</b> enabled, all individual parts appear on the 2D build plate and here for one-tap cancellation.</div>
      </div>`;
      return;
    }

    objects.forEach((obj,idx)=>{
      const name=obj.name||('Object_'+(idx+1));
      const isEx=excluded.includes(name);
      const isCur=current===name;
      const col=isEx?'#EF4444':isCur?'#00E5FF':'#34D399';
      const poly=Array.isArray(obj.polygon)&&obj.polygon.length?obj.polygon:null;
      const center=Array.isArray(obj.center)&&obj.center.length===2?obj.center:[110,110];
      let minX=W,maxX=0,minY=H,maxY=0;

      if(poly){
        ctx.beginPath();
        poly.forEach(([px,py],i)=>{
          const [sx,sy]=toScreen(px,py);
          if(sx<minX)minX=sx;if(sx>maxX)maxX=sx;
          if(sy<minY)minY=sy;if(sy>maxY)maxY=sy;
          i===0?ctx.moveTo(sx,sy):ctx.lineTo(sx,sy);
        });
        ctx.closePath();
        ctx.fillStyle=isEx?'rgba(239,68,68,0.18)':isCur?'rgba(0,229,255,0.28)':'rgba(52,211,153,0.22)';
        ctx.fill();
        ctx.strokeStyle=col;
        ctx.lineWidth=isCur?2.5:1.8;
        ctx.stroke();
      }else{
        const [cx,cy]=toScreen(center[0],center[1]);
        minX=cx-18;maxX=cx+18;minY=cy-18;maxY=cy+18;
        ctx.fillStyle=isEx?'rgba(239,68,68,0.2)':isCur?'rgba(0,229,255,0.3)':'rgba(52,211,153,0.24)';
        ctx.strokeStyle=col;
        ctx.lineWidth=2;
        ctx.beginPath();ctx.rect(minX,minY,36,36);ctx.fill();ctx.stroke();
      }
      const [cx,cy]=toScreen(center[0],center[1]);
      ctx.fillStyle='#F8FAFC';
      ctx.font='bold 10px monospace';
      ctx.textAlign='center';
      ctx.fillText(name.slice(0,14),cx,cy+3);
      hitBoxes.push({name,isEx,minX:minX-4,maxX:maxX+4,minY:minY-4,maxY:maxY+4});

      const row=el(`<div class="row box" style="align-items:center;justify-content:space-between;padding:8px 10px;border-color:${isCur?'#00E5FF':isEx?'rgba(239,68,68,.35)':'rgba(255,255,255,.1)'}">
        <div class="col" style="min-width:0">
          <b class="fn" style="font-size:12.5px;color:${isEx?'#94A3B8':'#F8FAFC'};${isEx?'text-decoration:line-through':''}">${name}</b>
          <span class="sub" style="font-size:10.5px;color:${col};font-weight:800">${isEx?'✕ EXCLUDED':isCur?'● PRINTING NOW':'● ACTIVE'}</span>
        </div>
        ${isEx?`<span class="pill bad">Skipped</span>`:`<button class="btn sm danger eo-btn">Exclude</button>`}
      </div>`);
      const btn=$('.eo-btn',row);
      if(btn){
        btn.onclick=()=>confirmBox('Exclude Object?',`Skip printing "${name}" for the remainder of this print?`,'Exclude Object',async()=>{
          await MR.excludeObject(name);
          toast(`🎯 Excluded ${name}`);
          setTimeout(render,400);
        },true);
      }
      listBox.append(row);
    });
  };

  $('#eo-canvas',n).onclick=e=>{
    const rect=e.target.getBoundingClientRect();
    const x=(e.clientX-rect.left)*(e.target.width/rect.width);
    const y=(e.clientY-rect.top)*(e.target.height/rect.height);
    const hit=hitBoxes.find(b=>!b.isEx&&x>=b.minX&&x<=b.maxX&&y>=b.minY&&y<=b.maxY);
    if(hit){
      confirmBox('Exclude Object?',`Skip printing "${hit.name}" for the remainder of this print?`,'Exclude Object',async()=>{
        await MR.excludeObject(hit.name);
        toast(`🎯 Excluded ${hit.name}`);
        setTimeout(render,400);
      },true);
    }
  };
  render();
}


