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
            <button class="btn pri sm grow fc-print" style="font-weight:800">🚀 Print</button>
            <button class="btn sm fc-info" title="File details">${ICON('info',16)}</button>
            <button class="btn sm fc-del" title="Delete file" style="color:#EF4444">${ICON('trash',16)}</button>
          </div>
        </div>
      </div>
    `);

    $('.fc-print',card).onclick=e=>{
      e.stopPropagation();
      confirmBox('Start Print?',`Begin printing "${it.name}" immediately?`,'Start Print',async()=>{
        toast('Starting print…');
        try{await MR.startPrint(full);go('printing');}catch(err){toast('⚠ Start failed: '+err.message);}
      });
    };
    $('.fc-info',card).onclick=e=>{e.stopPropagation();showDetails(full,it);};
    $('.fc-del',card).onclick=e=>{e.stopPropagation();confirmDelete(it,full);};
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
          <button class="btn pri sm r-print" style="font-weight:800">🚀 Print</button>
          <button class="btn sm r-info" title="File details">${ICON('info',16)}</button>
          <button class="btn sm r-del" title="Delete file" style="color:#EF4444">${ICON('trash',16)}</button>
        </div>
      </div>
    `);

    $('.r-print',row).onclick=e=>{
      e.stopPropagation();
      confirmBox('Start Print?',`Begin printing "${it.name}" immediately?`,'Start Print',async()=>{
        toast('Starting print…');
        try{await MR.startPrint(full);go('printing');}catch(err){toast('⚠ Start failed: '+err.message);}
      });
    };
    $('.r-info',row).onclick=e=>{e.stopPropagation();showDetails(full,it);};
    $('.r-del',row).onclick=e=>{e.stopPropagation();confirmDelete(it,full);};
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

  async function showDetails(full,it){
    const m=metaCache[full]||(await MR.meta(full))||{};
    const t=m.thumbnails?.length?m.thumbnails.sort((a,b)=>b.width-a.width)[0]:null;
    const dir=full.includes('/')?full.slice(0,full.lastIndexOf('/')+1):'';
    const thumbSrc=m.localThumbUrl||(t?MR.thumbURL(dir+t.relative_path):'');
    const filGrams=m.filament_weight_total?m.filament_weight_total.toFixed(1)+' g':m.filament_total?(m.filament_total*0.003).toFixed(1)+' g':'--';
    const filMeters=m.filament_total?(m.filament_total/1000).toFixed(2)+' m':'--';

    const n=el(`<div class="dlg" style="max-width:580px;border:1.5px solid rgba(0,229,255,.4)">
      <div class="row" style="align-items:center;margin-bottom:8px">
        <div style="width:28px;color:#00E5FF">${ICON('cube')}</div>
        <h3 class="grow fn" style="margin:0;font-size:16px" title="${it.name}">${it.name}</h3>
        <button class="x" id="dx">✕</button>
      </div>
      <div class="row" style="gap:14px;margin:12px 0">
        <div style="width:180px;height:180px;background:#070B14;border-radius:12px;border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none">
          ${thumbSrc?`<img src="${thumbSrc}" style="width:100%;height:100%;object-fit:contain">`:`<div style="color:rgba(56,189,248,.35)">${ICON('cube',72)}</div>`}
        </div>
        <div class="box grow" style="display:flex;flex-direction:column;gap:6px;font-size:12.5px">
          ${[
            ['Estimated Print Time',fmtTime(m.estimated_time)],
            ['Filament Length',filMeters],
            ['Filament Weight',filGrams],
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
          <button class="btn pri" id="ds" style="font-weight:800;padding:8px 18px">🚀 START PRINT</button>
        </div>
      </div>
    </div>`);

    const close=modal(n);
    $('#dx',n).onclick=$('#dc',n).onclick=close;
    $('#ddel',n).onclick=()=>{close();confirmDelete(it,full);};
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
  const root=$('#p-printing');let z0=0,babysteps=0,curFileMeta=null;
  root.innerHTML=`<div class="print-grid">
   <div class="print-col">
    <div class="card cam-card"><div class="cam-head"><b class="hico">${CICON('camera')} CAMERA</b><span class="sub" id="camst">connecting…</span><span class="grow"></span><button class="btn sm" id="camfs">⛶ Fullscreen</button><button class="btn sm" id="camset">⚙</button></div>
     <div class="cam-box" id="cambox"><img id="camimg" alt=""><div class="cam-empty" id="camempty">No webcam found.<br><small>Tap ⚙ to enter a stream URL</small></div></div></div>
    <div class="card print-file" style="align-items:flex-start">
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
    <div class="card"><div class="hdr hico" style="margin:0 0 6px">${CICON('offset')} Z ADJUST OFFSET</div><div class="row" style="align-items:baseline"><span class="big" id="pz">+0.000 mm</span><span class="sub grow" id="pbs">Baby steps added: 0</span></div>
     <div class="grid4" style="margin-top:8px"><button class="btn xl" data-z="-0.05">-0.05</button><button class="btn xl" data-z="-0.01">-0.01</button><button class="btn xl" data-z="0.01">+0.01</button><button class="btn xl" data-z="0.05">+0.05</button></div></div>
   </div>
   <div class="print-col">
    <div class="card col">
     <div class="row" style="align-items:center"><span class="pill info pbig" id="pstate">STANDBY</span><span class="grow"></span><span class="pill pbig" id="pzo">Z-Offset --</span></div>
     <div class="ppct" id="ppct">0%</div>
     <div class="pbar big"><i id="pfill"></i><span id="pbt"></span></div>
     <div class="grid3">
      <div class="tile"><div class="tic">${CICON('clock')}</div><div class="k">ELAPSED</div><div class="vv" id="pel">--</div></div>
      <div class="tile"><div class="tic">${CICON('hourglass')}</div><div class="k">REMAINING</div><div class="vv" id="prem">--</div></div>
      <div class="tile"><div class="tic">${CICON('flag')}</div><div class="k">PRINT ETA</div><div class="vv" id="peta">--</div></div>
     </div>
     <div class="grid3">
      <div class="tile"><div class="tic">${CICON('clock')}</div><div class="k">SLICER TOTAL</div><div class="vv" id="psltot" style="color:#38BDF8">--</div></div>
      <div class="tile"><div class="tic">${CICON('hourglass')}</div><div class="k">SLICER LEFT</div><div class="vv" id="pslrem" style="color:#FBBF24">--</div></div>
      <div class="tile"><div class="tic">${CICON('flag')}</div><div class="k">SLICER ETA</div><div class="vv" id="psleta" style="color:#C084FC">--</div></div>
     </div>
    </div>
    <div class="grid3" id="pmet">
     <div class="tile" id="pt-nozzle" title="Tap to adjust Nozzle temperature" style="cursor:pointer;border-color:rgba(255,122,0,.38)"><div class="tic">${CICON('nozzle')}</div><div class="k">NOZZLE <small style="color:#FF7A00;font-size:9px">● TUNE</small></div><div class="vv" id="pm-noz">--</div></div>
     <div class="tile" id="pt-bed" title="Tap to adjust Bed temperature" style="cursor:pointer;border-color:rgba(0,229,255,.38)"><div class="tic">${CICON('bed')}</div><div class="k">BED <small style="color:#00E5FF;font-size:9px">● TUNE</small></div><div class="vv" id="pm-bed">--</div></div>
     <div class="tile"><div class="tic">${CICON('layers')}</div><div class="k">LAYER</div><div class="vv" id="pm-lay" style="color:#C084FC">0/0</div></div>
     <div class="tile"><div class="tic">${CICON('speed')}</div><div class="k">SPEED</div><div class="vv" id="pm-spd">100%</div></div>
     <div class="tile"><div class="tic">${CICON('flow')}</div><div class="k">FLOW</div><div class="vv" id="pm-flw">100%</div></div>
     <div class="tile"><div class="tic">${CICON('fan')}</div><div class="k">FAN</div><div class="vv" id="pm-fan">0%</div></div>
    </div>
    <div class="grid3" id="pbtns"><button class="btn xl pri" id="ppause">⏸ Pause</button><button class="btn xl" id="ptune">${ICON('tune',20)} Fine Tune</button><button class="btn xl danger" id="pcancel">✕ Cancel</button></div>
    <div class="grid2" id="pdone" style="display:none"><button class="btn xl green" id="psave">Save Z-Offset</button><button class="btn xl pri" id="phome">Return Home</button></div>
   </div></div>`;
  $('#pt-nozzle',root).onclick=()=>preheat('nozzle');
  $('#pt-bed',root).onclick=()=>preheat('bed');
  (function cam(){
    const img=$('#camimg'),st=$('#camst'),empty=$('#camempty');let timer=null;
    const absURL=u=>{if(!u)return null;if(/^https?:/.test(u))return u;const b=new URL(MR.base);
      return (u.startsWith('/')?(b.port&&b.port!=='7125'?b.origin:b.protocol+'//'+b.hostname):b.origin)+(u.startsWith('/')?'':'/')+u};
    async function start(){
      clearInterval(timer);let url=localStorage.getItem('webcam_url'),snap=null;
      if(!url&&MR.connected){try{const r=await MR.get('/server/webcams/list');const w=(r.webcams||[]).find(x=>x.enabled!==false);
        if(w){url=absURL(w.stream_url);snap=absURL(w.snapshot_url)}}catch(e){}}
      if(!url){empty.style.display='flex';img.style.display='none';st.textContent='no camera';return}
      empty.style.display='none';img.style.display='block';st.textContent=url.replace(/^https?:\/\//,'');
      img.onerror=()=>{if(snap){st.textContent='snapshot mode';img.onerror=null;const t=()=>img.src=snap+(snap.includes('?')?'&':'?')+'t='+Date.now();t();timer=setInterval(t,1000)}else st.textContent='stream error'};
      img.src=url;
    }
    $('#camfs').onclick=()=>{const b=$('#cambox');(document.fullscreenElement?document.exitFullscreen():b.requestFullscreen?.())};
    $('#camset').onclick=()=>{const n=el(`<div class="dlg" style="max-width:480px"><h3>Webcam URL</h3><div class="sub">MJPEG stream, e.g. http://192.168.0.99/webcam/?action=stream — empty = auto-detect from Moonraker</div><input id="cu" style="width:100%;margin:8px 0" value="${localStorage.getItem('webcam_url')||''}"><div class="row" style="justify-content:flex-end"><button class="btn" id="cc2">Cancel</button><button class="btn pri" id="cs2">Save</button></div></div>`);
      const cl=modal(n);$('#cc2',n).onclick=cl;$('#cs2',n).onclick=()=>{const v=$('#cu',n).value.trim();v?localStorage.setItem('webcam_url',v):localStorage.removeItem('webcam_url');cl();start()}};
    MR.on('connection',ok=>ok&&start());if(MR.connected)start();
    document.addEventListener('visibilitychange',()=>{if(document.hidden){img.removeAttribute('src')}else start()});
    App._camStart=start;
  })();
  const dur=s=>{s=Math.max(0,Math.round(s));return`${Math.floor(s/3600)}h ${String(Math.floor(s%3600/60)).padStart(2,'0')}m`};
  root.querySelectorAll('[data-z]').forEach(b=>b.onclick=()=>{MR.babystep(+b.dataset.z);babysteps++;z0+=+b.dataset.z;upd()});
  const upd=()=>{$('#pz').textContent=(z0>=0?'+':'')+z0.toFixed(3)+' mm';$('#pbs').textContent='Baby steps added: '+babysteps};
  $('#ppause').onclick=()=>{const st=stat().print_stats?.state;st==='paused'?MR.resume():MR.pause()};
  $('#pcancel').onclick=()=>confirmBox('Cancel print?','This will stop the print and turn off the heaters.','Cancel Print',()=>MR.cancel(),true);
  $('#ptune').onclick=fineTune;
  $('#psave').onclick=async()=>{await MR.gcode('Z_OFFSET_APPLY_PROBE');await MR.saveConfig();toast('Z-offset saved')};
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

    if(gm.homing_origin){z0=gm.homing_origin[2];upd();$('#pzo').textContent='Z-Offset '+z0.toFixed(3)}
    $('#pbtns').style.display=done?'none':'grid';$('#pdone').style.display=done?'grid':'none';
    $('#ppause').textContent=state==='paused'?'▶ Resume':'⏸ Pause';
  });
  return{show(){},onState(st){}};
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

