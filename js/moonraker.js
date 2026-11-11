/* Moonraker client: HTTP + WebSocket. Auto-detects base URL. */
class MoonrakerClient{
  constructor(){
    this.connected=false;this.base=null;this.ws=null;this.listeners={};
    this.st={};this.config={};this.objects=[];this.info={};
    this.candidates=this._candidates();
  }
  _candidates(){
    const c=[];const s=localStorage.getItem('moonraker_host');
    if(s)c.push(/^https?:/.test(s)?s:'http://'+s);
    if(location.protocol.startsWith('http')){c.push(location.origin);c.push('http://'+location.hostname+':7125');}
    c.push('http://127.0.0.1:7125','http://192.168.0.99:7125');
    return [...new Set(c)];
  }
  on(e,f){(this.listeners[e]=this.listeners[e]||[]);if(!this.listeners[e].includes(f))this.listeners[e].push(f)}
  emit(e,d){(this.listeners[e]||[]).forEach(f=>{try{f(d)}catch(x){console.error(x)}})}
  async _fetch(path,opt={},timeout=6000,base){
    const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),timeout);
    const host=(base||this.base||'http://192.168.0.99:7125').replace(/\/+$/,'');
    try{const r=await fetch(host+path,{...opt,signal:ctl.signal});
      if(!r.ok)throw new Error(r.status);return r}finally{clearTimeout(t)}
  }
  async get(path,timeout){const r=await this._fetch(path,{},timeout);return (await r.json()).result}
  async post(path,body,timeout){
    const r=await this._fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined},timeout||10000);
    return (await r.json()).result}
  async del(path,timeout){
    const r=await this._fetch(path,{method:'DELETE'},timeout||10000);
    return (await r.json()).result}
  async connect(){
    if(this._connecting)return;
    this._connecting=true;
    try{
      for(const b of this.candidates){
        try{const r=await this._fetch('/server/info',{},2500,b);const j=await r.json();
          this.base=b;this.info=j.result;this.connected=true;this.emit('connection',true);
          await this._init();this._openWS();this._startPoll();return true}catch(e){}
      }
      this.connected=false;this.emit('connection',false);
      clearTimeout(this._reconnTimer);
      this._reconnTimer=setTimeout(()=>this.connect(),3000);return false;
    }finally{
      this._connecting=false;
    }
  }
  whenConnected(timeout=8000){
    if(this.connected&&this.base)return Promise.resolve(true);
    return new Promise((resolve,reject)=>{
      const t=setTimeout(()=>reject(new Error('Connection timeout')),timeout);
      const h=ok=>{if(ok&&this.base){clearTimeout(t);this.listeners['connection']=(this.listeners['connection']||[]).filter(f=>f!==h);resolve(true)}};
      this.on('connection',h);
    });
  }
  async _init(){
    try{const l=await this.get('/printer/objects/list');this.objects=l.objects||[]}catch(e){}
    try{const c=await this.get('/printer/objects/query?configfile');this.config=c.status.configfile.config||{}}catch(e){}
    this.emit('config',this.config);
  }
  _subs(){
    const o={print_stats:null,virtual_sdcard:null,display_status:null,toolhead:null,gcode_move:null,
      extruder:null,heater_bed:null,fan:null,motion_report:null,idle_timeout:null,webhooks:null,
      bed_mesh:null,exclude_object:null,configfile:['save_config_pending'],filament_switch_sensor:null};
    this.objects.forEach(n=>{if(/^(load_cell|load_cell_probe|probe|filament_switch_sensor|filament_motion_sensor|screws_tilt_adjust|manual_probe|exclude_object)/.test(n))o[n]=null});
    return o;
  }
  _openWS(){
    if(!this.base)return;
    const targetUrl=this.base.replace(/^http/,'ws')+'/websocket';
    if(this.ws){
      if(this.ws.url===targetUrl&&(this.ws.readyState===WebSocket.OPEN||this.ws.readyState===WebSocket.CONNECTING)){
        return;
      }
      const old=this.ws;this.ws=null;
      try{old.onopen=null;old.onmessage=null;old.onerror=null;old.onclose=null;old.close()}catch(e){}
    }
    try{
      const ws=new WebSocket(targetUrl);this.ws=ws;
      ws.onopen=()=>{
        if(this.ws!==ws){try{ws.close()}catch(e){}return}
        ws.send(JSON.stringify({jsonrpc:'2.0',method:'printer.objects.subscribe',params:{objects:this._subs()},id:1}))
      };
      ws.onmessage=ev=>{
        if(this.ws!==ws){try{ws.close()}catch(e){}return}
        try{const m=JSON.parse(ev.data);
          if(m.id===1&&m.result){this._merge(m.result.status)}
          else if(m.method==='notify_status_update'){this._merge(m.params[0])}
          else if(m.method==='notify_gcode_response'){this.emit('gcode',m.params[0])}
          else if(m.method==='notify_filelist_changed'){this.emit('filelist_changed',m.params[0])}
        }catch(e){}
      };
      ws.onclose=()=>{
        if(this.ws===ws){
          this.ws=null;
          clearTimeout(this._wsTimer);
          if(this.connected)this._wsTimer=setTimeout(()=>this.connected&&!this.ws&&this._openWS(),2500);
        }
      };
      ws.onerror=()=>{try{ws.close()}catch(e){}};
    }catch(e){}
  }
  _merge(d){
    for(const k in d){this.st[k]=Object.assign(this.st[k]||{},d[k])}
    this.emit('status',this.st);
  }
  _startPoll(){
    if(this._poll)return;
    this._poll=setInterval(async()=>{
      if(this.ws&&this.ws.readyState===1&&this._lastPoll&&Date.now()-this._lastPoll<4000&&this.connected){
        // still poll gently for cross-check
      }
      try{
        const q=Object.keys(this._subs()).map(encodeURIComponent).join('&');
        const r=await this.get('/printer/objects/query?'+q,3000);
        this._merge(r.status);this._lastPoll=Date.now();
        if(!this.connected){this.connected=true;this.emit('connection',true)}
      }catch(e){if(this.connected){this.connected=false;this.emit('connection',false);clearInterval(this._poll);this._poll=null;this.connect()}}
    },1500);
  }
  /* ---------- actions ---------- */
  async gcode(script,timeout){
    try{await this.post('/printer/gcode/script?script='+encodeURIComponent(script),null,timeout||60000);return true}
    catch(e){return false}
  }
  setTemp(heater,t){return this.gcode(heater==='extruder'?`M104 S${t}`:`M140 S${t}`)}
  home(axes){return this.gcode('G28'+(axes?' '+axes:''),120000)}
  jog(axis,dist,speed){
    const f=(speed||(axis==='Z'?600:6000));
    return this.gcode(`G91\nG1 ${axis}${dist} F${f}\nG90`)}
  motorsOff(){return this.gcode('M84')}
  estop(){return this.post('/printer/emergency_stop').catch(()=>{})}
  fwRestart(){return this.post('/printer/firmware_restart').catch(()=>{})}
  restart(){return this.post('/printer/restart').catch(()=>{})}
  extrude(len,speed){return this.gcode(`M83\nG1 E${len} F${(speed||5)*60}`,120000)}
  speed(p){return this.gcode(`M220 S${p}`)}
  flow(p){return this.gcode(`M221 S${p}`)}
  fan(p){return this.gcode(`M106 S${Math.round(p*2.55)}`)}
  babystep(d){return this.gcode(`SET_GCODE_OFFSET Z_ADJUST=${d} MOVE=1`)}
  pause(){return this.post('/printer/print/pause')}
  resume(){return this.post('/printer/print/resume')}
  cancel(){return this.post('/printer/print/cancel')}
  startPrint(f){return this.post('/printer/print/start?filename='+encodeURIComponent(f))}
  async getHistory(limit=100){
    if(!this.connected||!this.base)await this.whenConnected(6000).catch(()=>{});
    return this.get('/server/history/list?limit='+limit+'&order=desc',15000);
  }
  async clearHistory(){
    if(!this.connected||!this.base)await this.whenConnected(6000).catch(()=>{});
    return this.del('/server/history/job?all=true',15000);
  }
  saveConfig(){return this.gcode('SAVE_CONFIG',30000)}
  hasLoadCellProbe(){return Boolean(this.config?.load_cell_probe||this.objects.includes('load_cell_probe'))}
  tareGcode(){return this.hasLoadCellProbe()?'G4 P250\nLOAD_CELL_TARE\nG4 P100\n':''}
  tare(){return this.gcode('LOAD_CELL_TARE',20000)}
  hostAction(a){return this.post('/machine/'+a).catch(()=>false)}
  /* ---------- bed levelling mode (Normal / KAMP / Off) ---------- */
  async checkStartGcodeMesh(){
    try{
      const text=await this.readConfig();
      if(!text)return{mode:'off',configured:false};
      const kampInclude=/^[ \t]*\[include\s+KAMP_Settings\.cfg\]/im.test(text);
      const secRe=/(\[gcode_macro\s+(?:PRINT_START|START_PRINT)\][\s\S]*?)(?=\n\[|$)/gi;
      let hasActiveCalibrate=false,hasActiveProfile=false,foundMacro=false;
      let m;
      while((m=secRe.exec(text))!==null){
        foundMacro=true;
        const body=m[1];
        if(/^[ \t]*BED_MESH_CALIBRATE\b/im.test(body))hasActiveCalibrate=true;
        if(/^[ \t]*BED_MESH_PROFILE\s+LOAD/im.test(body))hasActiveProfile=true;
      }
      if(!foundMacro)return{mode:'off',configured:false};
      let mode='off';
      if((kampInclude&&hasActiveCalibrate)||(hasActiveCalibrate&&!hasActiveProfile))mode='kamp';
      else if(hasActiveProfile)mode='normal';
      return{mode,configured:mode!=='off'};
    }catch(e){
      return{mode:'off',configured:false};
    }
  }
  async setStartGcodeMeshMode(mode){
    mode=(mode||'off').toLowerCase();
    let text=await this.readConfig();
    if(!text)throw new Error('Could not read printer.cfg');
    const kampLineRe=/^[ \t]*#?[ \t]*\[include\s+KAMP_Settings\.cfg\][^\n]*/im;
    if(kampLineRe.test(text)){
      text=text.replace(kampLineRe,'[include KAMP_Settings.cfg]');
    }else if(mode==='kamp'){
      text='[include KAMP_Settings.cfg]\n'+text;
    }
    const macroRe=/(\[gcode_macro\s+(?:PRINT_START|START_PRINT)\]\s*\n)([\s\S]*?)(?=\n\[|$)/i;
    const match=text.match(macroRe);
    if(!match)throw new Error('PRINT_START macro not found in printer.cfg');
    const header=match[1];
    const bodyLines=match[2].split('\n');
    let foundProfile=false,foundCalibrate=false;
    const newLines=[];
    for(const line of bodyLines){
      const stripped=line.trim();
      const indentMatch=line.match(/^(\s*)/);
      const indent=indentMatch&&indentMatch[1]?indentMatch[1]:'    ';
      if(/^#?\s*BED_MESH_PROFILE\s+LOAD/i.test(stripped)){
        foundProfile=true;
        const cleanCmd=stripped.replace(/^#+\s*/,'');
        newLines.push(mode==='normal'?`${indent}${cleanCmd}`:`${indent}# ${cleanCmd}`);
      }else if(/^#?\s*BED_MESH_CALIBRATE\b/i.test(stripped)){
        foundCalibrate=true;
        const cleanCmd=stripped.replace(/^#+\s*/,'');
        newLines.push(mode==='kamp'?`${indent}${cleanCmd}`:`${indent}# ${cleanCmd}`);
      }else{
        newLines.push(line);
      }
    }
    if(mode==='normal'&&!foundProfile){
      const g28Idx=newLines.findIndex(l=>/^\s*G28\b/i.test(l));
      const ins=g28Idx>=0?g28Idx+1:newLines.length;
      newLines.splice(ins,0,'    BED_MESH_PROFILE LOAD=default');
    }else if(mode==='kamp'&&!foundCalibrate){
      let ins=newLines.findIndex(l=>/BED_MESH_PROFILE/i.test(l));
      if(ins<0)ins=newLines.findIndex(l=>/^\s*G28\b/i.test(l));
      ins=ins>=0?ins+1:newLines.length;
      newLines.splice(ins,0,'    BED_MESH_CALIBRATE');
    }
    const updatedText=text.slice(0,match.index)+header+newLines.join('\n')+text.slice(match.index+match[0].length);
    await this.writeConfig(updatedText);
    await this.fwRestart();
    return true;
  }
  /* ---------- files ---------- */
  async listFiles(path=''){
    const dirsR=await this.get('/server/files/directory?path=gcodes'+(path?'/'+encodeURIComponent(path).replace(/%2F/g,'/'):'')+'&extended=true');
    return dirsR}
  async meta(name){try{return await this.get('/server/files/metadata?filename='+encodeURIComponent(name))}catch(e){return null}}
  thumbURL(rel){
    const host=(this.base||'http://192.168.0.99:7125').replace(/\/+$/,'');
    return host+'/server/files/gcodes/'+rel.split('/').map(encodeURIComponent).join('/');
  }
  async readConfig(filename='printer.cfg'){
    if(!this.connected||!this.base)await this.whenConnected().catch(()=>{});
    const clean=String(filename||'printer.cfg').replace(/^\/+/,'');
    const r=await this._fetch('/server/files/config/'+clean.split('/').map(encodeURIComponent).join('/'));return r.text()}
  async listConfigs(){
    if(!this.connected||!this.base)await this.whenConnected().catch(()=>{});
    try{
      const res=await this.get('/server/files/list?root=config',8000);
      if(Array.isArray(res))return res.filter(f=>!String(f.path||'').startsWith('.')&&!String(f.path||'').includes('/.'));
    }catch(e){}
    return [{path:'printer.cfg',size:0,modified:0}];
  }
  async listLogs(){
    if(!this.connected||!this.base)await this.whenConnected().catch(()=>{});
    try{
      const res=await this.get('/server/files/list?root=logs',8000);
      if(Array.isArray(res))return res;
    }catch(e){}
    try{
      const dir=await this.get('/server/files/directory?path=logs&extended=true',8000);
      if(dir&&Array.isArray(dir.files))return dir.files.map(f=>({path:f.filename,size:f.size,modified:f.modified,permissions:f.permissions}));
    }catch(e){}
    return [];
  }
  logDownloadURL(filename){
    const host=(this.base||'http://192.168.0.99:7125').replace(/\/+$/,'');
    const clean=String(filename||'').replace(/^\/+/,'');
    return host+'/server/files/logs/'+clean.split('/').map(encodeURIComponent).join('/');
  }
  async readLog(filename,timeout=25000){
    if(!this.connected||!this.base)await this.whenConnected().catch(()=>{});
    const clean=String(filename||'').replace(/^\/+/,'');
    const r=await this._fetch('/server/files/logs/'+clean.split('/').map(encodeURIComponent).join('/'),{},timeout);
    return r.text();
  }
  async writeConfig(text,filename='printer.cfg'){
    if(!this.connected||!this.base)await this.whenConnected().catch(()=>{});
    const clean=String(filename||'printer.cfg').replace(/^\/+/,'');
    const parts=clean.split('/');
    const baseName=parts.pop();
    const subDir=parts.join('/');
    const fd=new FormData();
    fd.append('file',new Blob([text],{type:'text/plain'}),baseName);
    fd.append('root','config');
    if(subDir)fd.append('path',subDir);
    await this._fetch('/server/files/upload',{method:'POST',body:fd},15000);return true}
  excludeObject(name){
    if(!name)return Promise.resolve(false);
    return this.gcode(`EXCLUDE_OBJECT NAME=${name}`);
  }
  async listTimelapses(){
    if(!this.connected||!this.base)await this.whenConnected().catch(()=>{});
    try{
      const res=await this.get('/server/files/list?root=timelapse',8000);
      if(Array.isArray(res))return res.filter(f=>/\.(mp4|webm|mkv|avi|gif|jpg|png)$/i.test(f.path||''));
    }catch(e){}
    try{
      const dir=await this.get('/server/files/directory?path=timelapse&extended=true',8000);
      if(dir&&Array.isArray(dir.files))return dir.files.map(f=>({path:f.filename,size:f.size,modified:f.modified}));
    }catch(e){}
    return [];
  }
  timelapseURL(rel){
    const host=(this.base||'http://192.168.0.99:7125').replace(/\/+$/,'');
    const clean=String(rel||'').replace(/^\/+/,'');
    return host+'/server/files/timelapse/'+clean.split('/').map(encodeURIComponent).join('/');
  }
  async deleteTimelapse(rel){
    const b=this.base||'http://192.168.0.99:7125';
    const clean=String(rel||'').replace(/^\/+/,'');
    const r=await this._fetch('/server/files/timelapse/'+clean.split('/').map(encodeURIComponent).join('/'),{method:'DELETE'},8000,b);
    return r.ok;
  }
  async backupConfigsZip(){
    const list=await this.listConfigs();
    const files=list.filter(f=>/\.(cfg|conf|ini|json|txt|sh|py|md)$/i.test(f.path||'')&&(f.size||0)<5*1024*1024);
    if(!files.length)files.push({path:'printer.cfg'});
    const entries=[];
    const enc=new TextEncoder();
    for(const f of files){
      try{
        const txt=await this.readConfig(f.path);
        entries.push({name:f.path,data:enc.encode(txt)});
      }catch(e){}
    }
    if(!entries.length)throw new Error('No config files could be read');
    return MoonrakerClient.createZipBlob(entries);
  }
  static createZipBlob(entries){
    const crcTable=new Uint32Array(256);
    for(let n=0;n<256;n++){
      let c=n;
      for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
      crcTable[n]=c>>>0;
    }
    const crc32=buf=>{
      let c=0xFFFFFFFF;
      for(let i=0;i<buf.length;i++)c=crcTable[(c^buf[i])&0xFF]^(c>>>8);
      return (c^0xFFFFFFFF)>>>0;
    };
    const enc=new TextEncoder();
    const localParts=[];
    const centralParts=[];
    let offset=0;
    for(const item of entries){
      const nameBytes=enc.encode(item.name);
      const data=item.data;
      const crc=crc32(data);
      const localHdr=new Uint8Array(30+nameBytes.length);
      const lv=new DataView(localHdr.buffer);
      lv.setUint32(0,0x04034b50,true);
      lv.setUint16(4,20,true);
      lv.setUint16(6,0,true);
      lv.setUint16(8,0,true);
      lv.setUint16(10,0,true);
      lv.setUint16(12,0,true);
      lv.setUint32(14,crc,true);
      lv.setUint32(18,data.length,true);
      lv.setUint32(22,data.length,true);
      lv.setUint16(26,nameBytes.length,true);
      lv.setUint16(28,0,true);
      localHdr.set(nameBytes,30);
      localParts.push(localHdr,data);

      const centHdr=new Uint8Array(46+nameBytes.length);
      const cv=new DataView(centHdr.buffer);
      cv.setUint32(0,0x02014b50,true);
      cv.setUint16(4,20,true);
      cv.setUint16(6,20,true);
      cv.setUint16(8,0,true);
      cv.setUint16(10,0,true);
      cv.setUint16(12,0,true);
      cv.setUint16(14,0,true);
      cv.setUint32(16,crc,true);
      cv.setUint32(20,data.length,true);
      cv.setUint32(24,data.length,true);
      cv.setUint16(28,nameBytes.length,true);
      cv.setUint16(30,0,true);
      cv.setUint16(32,0,true);
      cv.setUint16(34,0,true);
      cv.setUint16(36,0,true);
      cv.setUint32(38,0,true);
      cv.setUint32(42,offset,true);
      centHdr.set(nameBytes,46);
      centralParts.push(centHdr);
      offset+=localHdr.length+data.length;
    }
    const centralSize=centralParts.reduce((s,b)=>s+b.length,0);
    const eocd=new Uint8Array(22);
    const ev=new DataView(eocd.buffer);
    ev.setUint32(0,0x06054b50,true);
    ev.setUint16(4,0,true);
    ev.setUint16(6,0,true);
    ev.setUint16(8,entries.length,true);
    ev.setUint16(10,entries.length,true);
    ev.setUint32(12,centralSize,true);
    ev.setUint32(16,offset,true);
    ev.setUint16(20,0,true);
    return new Blob([...localParts,...centralParts,eocd],{type:'application/zip'});
  }
  uploadFile(file,subPath='',autoPrint=false,onProgress=null){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      const b=this.base||'http://192.168.0.99:7125';
      const url=b.replace(/\/+$/,'')+'/server/files/upload';
      xhr.open('POST',url,true);
      if(onProgress&&xhr.upload){
        xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total)};
      }
      xhr.onload=()=>{
        if(xhr.status>=200&&xhr.status<300){
          try{resolve(JSON.parse(xhr.responseText))}catch(e){resolve({ok:true})}
        }else{
          reject(new Error('Upload failed with HTTP '+xhr.status));
        }
      };
      xhr.onerror=()=>reject(new Error('Network error during upload'));
      const fd=new FormData();
      fd.append('file',file,file.name);
      fd.append('root','gcodes');
      const cleanPath=(subPath||'').replace(/^\/+|\/+$/g,'');
      if(cleanPath)fd.append('path',cleanPath);
      if(autoPrint)fd.append('print','true');
      xhr.send(fd);
    });
  }
  async deleteFile(relPath){
    const b=this.base||'http://192.168.0.99:7125';
    const r=await this._fetch('/server/files/gcodes/'+relPath.split('/').map(encodeURIComponent).join('/'),{method:'DELETE'},8000,b);
    return r.ok;
  }
  async createDirectory(dirPath){
    return await this.post('/server/files/directory',{root:'gcodes',path:dirPath});
  }
  async systemLoads(){
    const out={};
    try{const p=await this.get('/machine/proc_stats');out.proc=p}catch(e){}
    try{const s=await this.get('/machine/system_info');out.sys=s.system_info}catch(e){}
    try{const m=await this.get('/printer/objects/query?mcu&system_stats');out.mcu=m.status}catch(e){}
    return out}
  async gcodeStore(count=10){try{return (await this.get('/server/gcode_store?count='+count)).gcode_store}catch(e){return[]}}
  /* ---------- PRINT_START health check ---------- */
  static analyzeConfig(text){
    const issues=[];
    const ps=text.match(/\[gcode_macro PRINT_START\][\s\S]*?(?=\n\[|$)/i);
    if(ps){
      const lines=ps[0].split('\n');
      const iM109=lines.findIndex(l=>/M109/i.test(l)&&!l.trim().startsWith('#'));
      const iTare=lines.findIndex((l,i)=>i>iM109&&/^\s*LOAD_CELL_TARE\b/i.test(l));
      const iG28=lines.findIndex((l,i)=>i>iM109&&/^\s*G28\b/i.test(l));
      if(iM109>=0&&iTare>=0&&(iG28<0||iTare<iG28))
        issues.push({id:'tare',msg:'Standalone LOAD_CELL_TARE after M109 (HX711 may be asleep after long heat-up; failure cancels the print).'});
    }
    return issues}
  static fixConfig(text){
    return text.replace(/(\[gcode_macro PRINT_START\][\s\S]*?)\n(\s*)LOAD_CELL_TARE[^\n]*(?=\n)/i,(m,a,sp)=>a+'\n'+sp+'; (removed standalone LOAD_CELL_TARE - G28 tares automatically)')}
}
window.MR=new MoonrakerClient();

