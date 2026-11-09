/* Canvas animations. Each factory returns {el, ...api}; runs rAF only while attached to DOM. */
const Anim={
 make(h=220,maxW=480){
  const c=document.createElement('canvas');
  c.height=h;c.style.height=h+'px';
  if(maxW)c.style.maxWidth=maxW+'px';
  c.style.width='100%';
  return c;
 },
 fit(c){
  const r=c.getBoundingClientRect();const d=devicePixelRatio||1;
  const w=Math.max(100,r.width||c.parentElement?.clientWidth||300);
  if(c.width!==Math.round(w*d)){c.width=Math.round(w*d);c.height=Math.round(parseInt(c.style.height)*d)}
  const x=c.getContext('2d');x.setTransform(d,0,0,d,0,0);
  return{x,w:r.width||w,h:parseInt(c.style.height)};
 },
 loop(c,draw){
  let on=true,t0=performance.now();
  const f=t=>{if(!on)return;if(!c.isConnected){requestAnimationFrame(f);return}
   const {x,w,h}=Anim.fit(c);x.clearRect(0,0,w,h);draw(x,w,h,(t-t0)/1000);requestAnimationFrame(f)};
  requestAnimationFrame(f);return()=>{on=false}}
};

/* Extruder load/unload synced with live_extruder_velocity */
Anim.extruder=function(o){
 const c=Anim.make(230,360);
 const s={mode:o.mode||'load',color:o.color||'#3B82F6',temp:25,target:210,stage:'heating',sensor:false,liveVel:0,pos:0,lastT:0};
 Anim.loop(c,(x,w,h,t)=>{
  const dt=s.lastT?Math.min(0.1,t-s.lastT):0.016;s.lastT=t;
  const cx=w/2,cy=h/2;const hot=Math.min(1,s.temp/Math.max(1,s.target));
  let run=['extruding','pulling'].includes(s.stage);
  let dir=s.stage==='pulling'?-1:1;
  let speedMult=1.0;
  if(Math.abs(s.liveVel)>0.05){
   run=true;
   dir=s.liveVel>0?1:-1;
   speedMult=Math.max(0.3,Math.min(3.5,Math.abs(s.liveVel)/8.0));
  }
  if(run)s.pos=(s.pos+dt*3.2*dir*speedMult);

  // Filament guide tube
  x.strokeStyle='rgba(148,163,184,.25)';x.lineWidth=10;x.lineCap='round';
  x.beginPath();x.moveTo(cx,8);x.lineTo(cx,h-62);x.stroke();

  // Filament strand tip position depending on stage
  let tipY=h-56;
  if(s.stage==='waiting_sensor')tipY=cy-52+Math.sin(t*5)*6;
  else if(s.stage==='heating'&&s.mode==='load'&&!s.sensor)tipY=cy-35;
  else if(s.stage==='done'&&s.mode==='unload')tipY=26;

  x.strokeStyle=s.color;x.lineWidth=6;x.lineCap='round';
  x.beginPath();x.moveTo(cx,8);x.lineTo(cx,tipY);x.stroke();
  if(run){
   const off=(s.pos*18)%20;
   x.strokeStyle='rgba(255,255,255,.45)';x.lineWidth=2;x.setLineDash([4,14]);x.lineDashOffset=-off;
   x.beginPath();x.moveTo(cx,8);x.lineTo(cx,tipY);x.stroke();x.setLineDash([]);
  }

  // Dual drive gears
  const ang=s.pos;
  [[-26,1],[26,-1]].forEach(([dx,sg])=>{x.save();x.translate(cx+dx,cy-20);x.rotate(ang*sg);
   x.fillStyle='#334155';x.strokeStyle=run?'#34D399':'#00E5FF';x.lineWidth=1.8;x.beginPath();x.arc(0,0,20,0,7);x.fill();x.stroke();
   for(let i=0;i<10;i++){x.rotate(Math.PI/5);x.fillStyle='#64748B';x.fillRect(-3,-25,6,7)}x.restore()});

  // Filament runout sensor indicator
  const sCol=s.sensor?'#34D399':(s.stage==='waiting_sensor'?(Math.sin(t*7)>0?'#F59E0B':'#EF4444'):'#475569');
  x.fillStyle=sCol;x.beginPath();x.arc(cx+56,cy-64,6.5,0,7);x.fill();
  x.fillStyle='#94A3B8';x.font='bold 9.5px sans-serif';x.textAlign='left';
  x.fillText(s.sensor?'SENSOR: DETECTED':'SENSOR: EMPTY',cx+67,cy-61);

  // Heater block & nozzle
  x.fillStyle=`rgb(${71+Math.round(160*hot)},${85-Math.round(40*hot)},${105-Math.round(70*hot)})`;
  x.fillRect(cx-22,h-62,44,28);
  x.fillStyle='#D4A017';x.beginPath();x.moveTo(cx-12,h-34);x.lineTo(cx+12,h-34);x.lineTo(cx,h-16);x.fill();
  if(run&&dir>0){x.fillStyle=s.color;x.beginPath();x.arc(cx,h-12+((s.pos*8)%9),3.2,0,7);x.fill()}
  if(hot>.6){const g=x.createRadialGradient(cx,h-48,2,cx,h-48,50);g.addColorStop(0,`rgba(255,100,0,${hot*.4})`);g.addColorStop(1,'rgba(255,100,0,0)');x.fillStyle=g;x.fillRect(cx-60,h-100,120,100)}
  x.fillStyle='#E2E8F0';x.font='bold 11px sans-serif';x.textAlign='center';
  const velTxt=Math.abs(s.liveVel)>0.05?` • ${s.liveVel>0?'+':''}${s.liveVel.toFixed(1)} mm/s`:'';
  x.fillText(`${s.temp.toFixed(0)}°C / ${s.target}°C • ${s.stage.replace('_',' ').toUpperCase()}${velTxt}`,cx,h-2);
 });
 return{el:c,set:p=>Object.assign(s,p)};
};

/* Dual Z trim: gantry tilt, constrained span without horizontal stretch */
Anim.dualZ=function(){
 const c=Anim.make(220,440);const s={diff:0,spin:0};
 Anim.loop(c,(x,w,h,t)=>{
  const d=Math.max(-1,Math.min(1,s.diff*10));
  const span=Math.min(320,w-80);
  const cx=w/2;
  const lx=cx-span/2, rx=cx+span/2;
  const by=h-36, ly=by-88, ry=by-88-d*26;
  x.strokeStyle='#334155';x.lineWidth=7;x.beginPath();x.moveTo(lx,by);x.lineTo(lx,24);x.moveTo(rx,by);x.lineTo(rx,24);x.stroke();
  x.fillStyle='#1E293B';x.fillRect(lx-20,by,span+40,10);
  x.strokeStyle=Math.abs(s.diff)<.04?'#34D399':'#FBBF24';x.lineWidth=6;x.lineCap='round';
  x.beginPath();x.moveTo(lx,ly);x.lineTo(rx,ry);x.stroke();
  x.fillStyle='#D4A017';[[lx,ly],[rx,ry]].forEach(([px,py])=>{x.beginPath();x.moveTo(px-6,py+6);x.lineTo(px+6,py+6);x.lineTo(px,py+20);x.fill()});
  x.fillStyle='#E2E8F0';x.font='bold 11px sans-serif';x.textAlign='center';
  x.fillText('LEFT (REF)',lx,by+24);x.fillText('RIGHT MOTOR',rx,by+24);
  if(Math.abs(s.diff)>=.04){
   const cw=s.diff<0;
   const a=t*3*(cw?1:-1);x.strokeStyle=cw?'#34D399':'#38BDF8';x.lineWidth=3;
   x.beginPath();x.arc(rx,by-28,15,a,a+4.2);x.stroke();
   const ex=rx+15*Math.cos(a+4.2),ey=by-28+15*Math.sin(a+4.2);x.fillStyle=x.strokeStyle;x.beginPath();x.arc(ex,ey,4,0,7);x.fill();
   x.fillText(cw?'TURN CW (raises bed)':'TURN CCW (lowers bed)',rx-15,by-52);
  }else if(s.diff!==null){x.fillStyle='#34D399';x.fillText('✓ LEVEL',cx,34)}
 });
 return{el:c,set:p=>Object.assign(s,p)};
};

/* Bed screws top-down: strictly square bed aspect ratio */
Anim.bedScrews=function(onPick){
 const c=Anim.make(280,320);const s={screws:[],sel:-1,res:{}};
 c.onclick=e=>{
  const r=c.getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;
  const ch=parseInt(c.style.height)||280;
  const bedSide=Math.min(r.width-44,ch-40);
  const bx=(r.width-bedSide)/2,by=(ch-bedSide)/2;
  s.screws.forEach((p,i)=>{
   const px=bx+bedSide*p[0],py=by+bedSide*p[1];
   if(Math.hypot(px-mx,py-my)<24)onPick&&onPick(i);
  });
 };
 Anim.loop(c,(x,w,h,t)=>{
  const bedSide=Math.min(w-44,h-40);
  const bx=(w-bedSide)/2,by=(h-bedSide)/2;
  x.fillStyle='#131A26';x.strokeStyle='rgba(56,189,248,.5)';x.lineWidth=1.5;
  x.fillRect(bx,by,bedSide,bedSide);x.strokeRect(bx,by,bedSide,bedSide);
  // Center grid lines
  x.strokeStyle='rgba(255,255,255,.06)';x.lineWidth=1;
  x.beginPath();x.moveTo(bx+bedSide/2,by);x.lineTo(bx+bedSide/2,by+bedSide);x.moveTo(bx,by+bedSide/2);x.lineTo(bx+bedSide,by+bedSide/2);x.stroke();
  s.screws.forEach((p,i)=>{
   const px=bx+bedSide*p[0],py=by+bedSide*p[1];const r=s.res[i];
   const col=r===undefined?'#94A3B8':Math.abs(r)<=.04?'#34D399':'#FBBF24';
   x.fillStyle='#0F172A';x.strokeStyle=i===s.sel?'#00E5FF':col;x.lineWidth=i===s.sel?3:2;
   x.beginPath();x.arc(px,py,15,0,7);x.fill();x.stroke();
   x.fillStyle='#E2E8F0';x.font='bold 11px sans-serif';x.textAlign='center';x.fillText(i+1,px,py+4);
   if(r!==undefined){
    x.fillStyle=col;x.font='bold 10px Consolas, monospace';x.fillText((r>0?'+':'')+r.toFixed(3),px,py+28);
    if(Math.abs(r)>.04){const a=t*3*(r>0?-1:1);x.strokeStyle=col;x.lineWidth=2;x.beginPath();x.arc(px,py,20,a,a+3.5);x.stroke()}
   }
  });
 });
 return{el:c,set:p=>Object.assign(s,p)};
};

/* Bed mesh 3D build plate with interactive click-and-drag rotation and coloured height spots */
Anim.mesh = function(o = {}) {
  const h = o.h || 380;
  const maxW = o.w || 640;
  const c = Anim.make(h, maxW);
  c.classList.add('canvas-mesh');

  // Realistic default 6x6 crown/bowl demonstration mesh when printer mesh not yet probed
  const DEMO_MESH = [
    [-0.045, -0.025, -0.010, -0.012, -0.030, -0.055],
    [-0.020,  0.015,  0.035,  0.030,  0.010, -0.025],
    [ 0.010,  0.045,  0.075,  0.068,  0.038,  0.005],
    [ 0.015,  0.050,  0.082,  0.072,  0.042,  0.010],
    [-0.015,  0.020,  0.040,  0.035,  0.015, -0.020],
    [-0.050, -0.030, -0.015, -0.018, -0.035, -0.060]
  ];

  const s = {
    m: DEMO_MESH,
    probing: false,
    idx: 0,
    view: 'plate', // 'plate' | 'surface' | '2d'
    rotX: 0.58,   // elevation / pitch (rad)
    rotY: -0.68,  // azimuth / yaw (rad)
    zoom: 1.0,
    hoveredSpot: null,
    _spots2D: []
  };

  // Color mapping: Blue -> Cyan -> Green (0.00) -> Amber -> Red
  const col = (z, sp) => {
    const t = Math.max(-1, Math.min(1, z / sp));
    const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
    const BLUE = [37, 99, 235], CYAN = [6, 182, 212], GREEN = [16, 185, 129], YELLOW = [245, 158, 11], RED = [239, 68, 68];
    let r;
    if (t < -0.5) r = mix(BLUE, CYAN, (t + 1) * 2);
    else if (t < 0) r = mix(CYAN, GREEN, (t + 0.5) * 2);
    else if (t < 0.5) r = mix(GREEN, YELLOW, t * 2);
    else r = mix(YELLOW, RED, (t - 0.5) * 2);
    return `rgb(${r[0]},${r[1]},${r[2]})`;
  };

  const colDark = (z, sp) => {
    const t = Math.max(-1, Math.min(1, z / sp));
    if (t < 0) return '#1E3A8A';
    if (t < 0.4) return '#065F46';
    return '#7F1D1D';
  };

  const colAlpha = (z, sp, a) => {
    return col(z, sp).replace('rgb', 'rgba').replace(')', `,${a})`);
  };

  // Interactive mouse/touch drag rotation & zoom
  let isDown = false;
  let lastX = 0, lastY = 0;

  c.style.cursor = 'grab';
  c.style.touchAction = 'none';

  c.addEventListener('pointerdown', e => {
    isDown = true;
    lastX = e.clientX;
    lastY = e.clientY;
    c.style.cursor = 'grabbing';
    try { c.setPointerCapture(e.pointerId); } catch (err) {}
  });

  c.addEventListener('pointermove', e => {
    if (isDown) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      s.rotY -= dx * 0.008;
      // Clamp elevation between ~10° and ~82°
      s.rotX = Math.max(0.15, Math.min(1.42, s.rotX - dy * 0.008));
      lastX = e.clientX;
      lastY = e.clientY;
    } else {
      const rect = c.getBoundingClientRect();
      const scaleX = c.width / rect.width;
      const scaleY = c.height / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;
      s.hoveredSpot = null;
      if (s._spots2D) {
        for (const pt of s._spots2D) {
          if (Math.hypot(pt.sx - mx, pt.sy - my) < 14) {
            s.hoveredSpot = pt;
            break;
          }
        }
      }
    }
  });

  const stopDrag = e => {
    if (isDown) {
      isDown = false;
      c.style.cursor = 'grab';
      try { if (e && e.pointerId) c.releasePointerCapture(e.pointerId); } catch (err) {}
    }
  };

  c.addEventListener('pointerup', stopDrag);
  c.addEventListener('pointercancel', stopDrag);

  c.addEventListener('wheel', e => {
    e.preventDefault();
    s.zoom = Math.max(0.65, Math.min(1.85, s.zoom - e.deltaY * 0.0012));
  }, { passive: false });

  c.addEventListener('dblclick', () => {
    s.rotX = 0.58;
    s.rotY = -0.68;
    s.zoom = 1.0;
  });

  // 3D projection helper
  const project = (X, Y, Z, cx, cy, scale) => {
    const x1 = X * Math.cos(s.rotY) - Y * Math.sin(s.rotY);
    const y1 = X * Math.sin(s.rotY) + Y * Math.cos(s.rotY);
    const z1 = Z;
    const x2 = x1;
    const y2 = y1 * Math.cos(s.rotX) - z1 * Math.sin(s.rotX);
    const z2 = y1 * Math.sin(s.rotX) + z1 * Math.cos(s.rotX);
    const sx = cx + x2 * scale * s.zoom;
    const sy = cy + y2 * scale * s.zoom;
    return { sx, sy, depth: z2 };
  };

  Anim.loop(c, (x, w, h) => {
    const m = s.m && s.m.length ? s.m : DEMO_MESH;
    const ny = m.length, nx = m[0].length;
    const flat = m.flat();
    const minZ = Math.min(...flat);
    const maxZ = Math.max(...flat);
    const rangeZ = maxZ - minZ;
    const sp = Math.max(0.02, Math.max(...flat.map(Math.abs)));

    // View: 2D Heatmap
    if (s.view === '2d') {
      const meshSide = Math.min(w - 60, h - 70);
      const cw = meshSide / nx, ch = meshSide / ny;
      const ox = (w - meshSide) / 2, oy = (h - meshSide) / 2 - 12;

      // Bed plate border
      x.fillStyle = '#0F172A';
      x.strokeStyle = 'rgba(0,229,255,.4)';
      x.lineWidth = 2;
      x.fillRect(ox - 6, oy - 6, meshSide + 12, meshSide + 12);
      x.strokeRect(ox - 6, oy - 6, meshSide + 12, meshSide + 12);

      const spots2d = [];
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const val = m[j][i];
          const px = ox + i * cw;
          const py = oy + (ny - 1 - j) * ch;

          x.fillStyle = colAlpha(val, sp, 0.28);
          x.fillRect(px, py, cw - 1, ch - 1);
          x.strokeStyle = 'rgba(255,255,255,.08)';
          x.strokeRect(px, py, cw - 1, ch - 1);

          // Center spot
          const cx = px + cw / 2, cy = py + ch / 2;
          const isHov = s.hoveredSpot && s.hoveredSpot.i === i && s.hoveredSpot.j === j;
          const rad = isHov ? Math.min(cw, ch) * 0.38 : Math.min(cw, ch) * 0.28;

          x.fillStyle = col(val, sp);
          x.beginPath();
          x.arc(cx, cy, rad, 0, Math.PI * 2);
          x.fill();
          x.strokeStyle = isHov ? '#FFFFFF' : 'rgba(255,255,255,.6)';
          x.lineWidth = isHov ? 2 : 1;
          x.stroke();

          // Height value
          x.fillStyle = '#FFFFFF';
          x.font = 'bold 12.5px Consolas, monospace';
          x.textAlign = 'center';
          x.fillText(val.toFixed(2), cx, cy + ch * 0.38);

          spots2d.push({ i, j, val, sx: cx, sy: cy });
        }
      }
      s._spots2D = spots2d;
    } else {
      // View: 3D Build Plate with Coloured Spots or Topographic Surface
      const cx = w / 2;
      const cy = h / 2 - 10;
      const scale = Math.min(w, h) * 0.38;

      // 1. Draw 3D Plate Slab (Base & Thickness)
      const P = [
        [-1.08, -1.08, 0], // Front-Left
        [ 1.08, -1.08, 0], // Front-Right
        [ 1.08,  1.08, 0], // Back-Right
        [-1.08,  1.08, 0], // Back-Left
      ];
      const B = [
        [-1.08, -1.08, -0.12],
        [ 1.08, -1.08, -0.12],
        [ 1.08,  1.08, -0.12],
        [-1.08,  1.08, -0.12],
      ];

      const p2D = P.map(pt => project(pt[0], pt[1], pt[2], cx, cy, scale));
      const b2D = B.map(pt => project(pt[0], pt[1], pt[2], cx, cy, scale));

      const sides = [
        { pts: [p2D[0], p2D[1], b2D[1], b2D[0]], c: '#1E293B' }, // Front
        { pts: [p2D[1], p2D[2], b2D[2], b2D[1]], c: '#0F172A' }, // Right
        { pts: [p2D[2], p2D[3], b2D[3], b2D[2]], c: '#090D16' }, // Back
        { pts: [p2D[3], p2D[0], b2D[0], b2D[3]], c: '#273549' }, // Left
      ];

      // Draw sides
      sides.forEach(sd => {
        const avgZ = sd.pts.reduce((sum, p) => sum + p.depth, 0) / 4;
        if (avgZ < 0) { // Facing camera / visible
          x.fillStyle = sd.c;
          x.beginPath();
          sd.pts.forEach((p, idx) => idx ? x.lineTo(p.sx, p.sy) : x.moveTo(p.sx, p.sy));
          x.closePath();
          x.fill();
          x.strokeStyle = 'rgba(56,189,248,.2)';
          x.stroke();
        }
      });

      // Top Plate Face
      const grad = x.createLinearGradient(p2D[0].sx, p2D[0].sy, p2D[2].sx, p2D[2].sy);
      grad.addColorStop(0, '#151D2A');
      grad.addColorStop(1, '#0C121D');
      x.fillStyle = grad;
      x.beginPath();
      p2D.forEach((p, idx) => idx ? x.lineTo(p.sx, p.sy) : x.moveTo(p.sx, p.sy));
      x.closePath();
      x.fill();
      x.strokeStyle = 'rgba(0,229,255,.45)';
      x.lineWidth = 1.5;
      x.stroke();

      // Subdued Plate Grid Lines
      x.strokeStyle = 'rgba(255,255,255,.05)';
      x.lineWidth = 1;
      for (let k = -4; k <= 4; k += 2) {
        const u = k * 0.22;
        const l1 = project(u, -1.08, 0, cx, cy, scale);
        const l2 = project(u,  1.08, 0, cx, cy, scale);
        x.beginPath(); x.moveTo(l1.sx, l1.sy); x.lineTo(l2.sx, l2.sy); x.stroke();

        const w1 = project(-1.08, u, 0, cx, cy, scale);
        const w2 = project( 1.08, u, 0, cx, cy, scale);
        x.beginPath(); x.moveTo(w1.sx, w1.sy); x.lineTo(w2.sx, w2.sy); x.stroke();
      }

      // Front edge label
      const fMid = project(0, -1.08, 0, cx, cy, scale);
      x.fillStyle = '#94A3B8';
      x.font = 'bold 12px sans-serif';
      x.textAlign = 'center';
      x.fillText('▲ FRONT', fMid.sx, fMid.sy + 14);

      // 2. Project 3D Probed Height Points
      const spots = [];
      const grid3D = [];

      for (let j = 0; j < ny; j++) {
        grid3D[j] = [];
        for (let i = 0; i < nx; i++) {
          const val = m[j][i];
          const u = (i / (nx - 1) - 0.5) * 1.8;
          const v = (j / (ny - 1) - 0.5) * 1.8;
          const z = (val / sp) * 0.45;

          const base = project(u, v, 0, cx, cy, scale);
          const elevated = project(u, v, z, cx, cy, scale);

          const pt = {
            i, j, val,
            bx: base.sx, by: base.sy,
            sx: elevated.sx, sy: elevated.sy,
            depth: elevated.depth,
            isMin: val === minZ,
            isMax: val === maxZ
          };
          grid3D[j][i] = pt;
          spots.push(pt);
        }
      }
      s._spots2D = spots;

      // 3. Draw Topographic Contoured Surface Mesh
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const p00 = grid3D[j][i];
          const p10 = grid3D[j][i + 1];
          const p11 = grid3D[j + 1][i + 1];
          const p01 = grid3D[j + 1][i];
          const avgVal = (p00.val + p10.val + p11.val + p01.val) / 4;

          x.fillStyle = colAlpha(avgVal, sp, s.view === 'surface' ? 0.42 : 0.22);
          x.strokeStyle = colAlpha(avgVal, sp, s.view === 'surface' ? 0.75 : 0.45);
          x.lineWidth = 1;
          x.beginPath();
          x.moveTo(p00.sx, p00.sy);
          x.lineTo(p10.sx, p10.sy);
          x.lineTo(p11.sx, p11.sy);
          x.lineTo(p01.sx, p01.sy);
          x.closePath();
          x.fill();
          x.stroke();
        }
      }

      // 4. Draw Coloured Spots (Discs / Nodes) with Height Stems
      if (s.view === 'plate') {
        const sorted = [...spots].sort((a, b) => b.depth - a.depth);
        sorted.forEach(pt => {
          const isHov = s.hoveredSpot && s.hoveredSpot.i === pt.i && s.hoveredSpot.j === pt.j;
          const rad = isHov ? 9.5 : 7;

          // Vertical stem connecting plate to elevated spot
          x.strokeStyle = colAlpha(pt.val, sp, isHov ? 0.95 : 0.65);
          x.lineWidth = isHov ? 2.5 : 1.8;
          x.beginPath();
          x.moveTo(pt.bx, pt.by);
          x.lineTo(pt.sx, pt.sy);
          x.stroke();

          // Anchor base dot
          x.fillStyle = 'rgba(255,255,255,.25)';
          x.beginPath();
          x.arc(pt.bx, pt.by, 2, 0, Math.PI * 2);
          x.fill();

          // Coloured Spot with 3D Radial Highlight
          const sGrad = x.createRadialGradient(pt.sx - 2, pt.sy - 2, 1, pt.sx, pt.sy, rad);
          sGrad.addColorStop(0, '#FFFFFF');
          sGrad.addColorStop(0.35, col(pt.val, sp));
          sGrad.addColorStop(1, colDark(pt.val, sp));

          x.fillStyle = sGrad;
          x.beginPath();
          x.arc(pt.sx, pt.sy, rad, 0, Math.PI * 2);
          x.fill();

          x.strokeStyle = isHov ? '#FFFFFF' : 'rgba(255,255,255,.7)';
          x.lineWidth = isHov ? 2.2 : 1.2;
          x.stroke();

          // Min / Max Callout Badges with smart edge boundary placement
          if (!isHov && (pt.isMin || pt.isMax)) {
            const isMax = pt.isMax;
            const txt = (pt.val > 0 ? '+' : '') + pt.val.toFixed(3);
            x.font = 'bold 12px Consolas, monospace';
            const tw = x.measureText(txt).width + 12;
            const by = isMax ? (pt.sy < 45 ? pt.sy + 20 : pt.sy - 16) : (pt.sy > h - 52 ? pt.sy - 16 : pt.sy + 20);
            x.fillStyle = isMax ? 'rgba(239,68,68,0.92)' : 'rgba(37,99,235,0.92)';
            x.fillRect(pt.sx - tw / 2, by - 11, tw, 17);
            x.strokeStyle = '#FFFFFF';
            x.lineWidth = 1;
            x.strokeRect(pt.sx - tw / 2, by - 11, tw, 17);
            x.fillStyle = '#FFFFFF';
            x.textAlign = 'center';
            x.fillText(txt, pt.sx, by + 2);
          }
        });
      }
    }

    // 5. Hover Tooltip
    if (s.hoveredSpot) {
      const hp = s.hoveredSpot;
      const info = `[${hp.i}, ${hp.j}]  Z: ${(hp.val > 0 ? '+' : '') + hp.val.toFixed(3)} mm`;
      x.font = 'bold 13.5px Consolas, monospace';
      const tw = x.measureText(info).width + 20;
      const hx = Math.max(10, Math.min(w - tw - 10, hp.sx - tw / 2));
      const hy = Math.max(20, hp.sy - 28);

      x.fillStyle = 'rgba(15,23,42,0.95)';
      x.strokeStyle = col(hp.val, sp);
      x.lineWidth = 2;
      x.fillRect(hx, hy - 16, tw, 26);
      x.strokeRect(hx, hy - 16, tw, 26);

      x.fillStyle = '#F8FAFC';
      x.textAlign = 'left';
      x.fillText(info, hx + 10, hy + 2);
    }

    // 6. HUD Header Overlays
    x.fillStyle = '#CBD5E1';
    x.font = 'bold 12px sans-serif';
    x.textAlign = 'left';
    x.fillText('3D BUILD PLATE • CLICK & DRAG TO ROTATE', 14, 22);

    x.textAlign = 'right';
    x.fillStyle = '#38BDF8';
    x.font = 'bold 12px Consolas, monospace';
    x.fillText(s.view === 'plate' ? '3D PLATE + SPOTS' : s.view === 'surface' ? '3D TOPOGRAPHY' : '2D MATRIX', w - 14, 22);

    // 7. Bottom Height Color Gradient Legend
    const barW = Math.min(280, w - 160);
    const barH = 9;
    const barX = (w - barW) / 2;
    const barY = h - 26;

    const lGrad = x.createLinearGradient(barX, 0, barX + barW, 0);
    lGrad.addColorStop(0, '#2563EB');    // Blue
    lGrad.addColorStop(0.25, '#06B6D4'); // Cyan
    lGrad.addColorStop(0.5, '#10B981');  // Green (0.00)
    lGrad.addColorStop(0.75, '#F59E0B'); // Amber
    lGrad.addColorStop(1, '#EF4444');    // Red

    x.fillStyle = lGrad;
    x.fillRect(barX, barY, barW, barH);
    x.strokeStyle = 'rgba(255,255,255,0.2)';
    x.strokeRect(barX, barY, barW, barH);

    x.font = 'bold 12.5px Consolas, monospace';
    x.fillStyle = '#60A5FA';
    x.textAlign = 'right';
    x.fillText(minZ.toFixed(3), barX - 8, barY + 8);

    x.fillStyle = '#34D399';
    x.textAlign = 'center';
    x.fillText('0.00', barX + barW / 2, barY - 4);

    x.fillStyle = '#F87171';
    x.textAlign = 'left';
    x.fillText((maxZ > 0 ? '+' : '') + maxZ.toFixed(3), barX + barW + 8, barY + 8);

    x.fillStyle = '#E2E8F0';
    x.font = 'bold 12.5px Consolas, monospace';
    x.textAlign = 'center';
    x.fillText(`${nx}×${ny} Grid (${nx * ny} points) • Range: ${rangeZ.toFixed(3)} mm`, w / 2, h - 8);
  });

  return {
    el: c,
    set: p => Object.assign(s, p),
    resetView: () => { s.rotX = 0.58; s.rotY = -0.68; s.zoom = 1.0; },
    toggleView: () => {
      s.view = s.view === 'plate' ? 'surface' : s.view === 'surface' ? '2d' : 'plate';
      return s.view;
    }
  };
};

/* Z offset nozzle clearance */
Anim.zoffset=function(){
 const c=Anim.make(160,420);const s={delta:0};
 Anim.loop(c,(x,w,h)=>{
  const cx=w/2,by=h*.68;
  const span=Math.min(300,w-40);
  x.fillStyle='rgba(0,229,255,.35)';x.fillRect(cx-span/2,by,span,10);
  const d=Math.max(-.4,Math.min(.4,s.delta));const ny=by-10-d*65;
  x.fillStyle='#F59E0B';x.fillRect(cx-18,by-5,36,5);
  x.fillStyle='#475569';x.fillRect(cx-20,ny-40,40,20);
  x.fillStyle='#EAB308';x.beginPath();x.moveTo(cx-12,ny-20);x.lineTo(cx+12,ny-20);x.lineTo(cx+3,ny);x.lineTo(cx-3,ny);x.fill();
  x.fillStyle='#fff';x.font='bold 13px Consolas, monospace';x.textAlign='left';
  x.fillText(`Δ ${(s.delta>0?'+':'')+s.delta.toFixed(3)} mm`,cx+48,by-16);
 });
 return{el:c,set:p=>Object.assign(s,p)};
};

/* Line & scatter chart */
Anim.chart=function(o){
 const c=Anim.make(o.h||190,520);const s={pts:[],target:null,scatter:!!o.scatter};
 Anim.loop(c,(x,w,h)=>{
  const r={l:44,t:10,w:w-54,h:h-28};
  x.strokeStyle='rgba(0,229,255,.25)';x.strokeRect(r.l,r.t,r.w,r.h);
  const p=s.pts;if(!p.length){x.fillStyle='#94A3B8';x.font='bold 12px sans-serif';x.textAlign='center';x.fillText(o.empty||'No data',w/2,h/2);return}
  let lo=Math.min(...p),hi=Math.max(...p);if(s.target!==null){lo=Math.min(lo,s.target-3);hi=Math.max(hi,s.target+3)}
  const pad=Math.max((hi-lo)*.15,o.minPad||2);lo-=pad;hi+=pad;
  const Y=v=>r.t+r.h-(v-lo)/(hi-lo)*r.h,X=i=>r.l+r.w*(s.scatter?(i+.5)/Math.max(10,p.length):i/Math.max(1,p.length-1));
  x.fillStyle='#94A3B8';x.font='10px sans-serif';x.textAlign='right';
  for(let k=0;k<5;k++){const v=lo+(hi-lo)*k/4;x.fillText(v.toFixed(o.dec??0),r.l-4,Y(v)+3);x.strokeStyle='rgba(148,163,184,.12)';x.beginPath();x.moveTo(r.l,Y(v));x.lineTo(r.l+r.w,Y(v));x.stroke()}
  if(s.target!==null){x.strokeStyle='#FBBF24';x.setLineDash([5,4]);x.beginPath();x.moveTo(r.l,Y(s.target));x.lineTo(r.l+r.w,Y(s.target));x.stroke();x.setLineDash([])}
  if(!s.scatter){x.strokeStyle='#00E5FF';x.lineWidth=2;x.beginPath();p.forEach((v,i)=>i?x.lineTo(X(i),Y(v)):x.moveTo(X(i),Y(v)));x.stroke();x.lineWidth=1}
  else{const avg=p.reduce((a,b)=>a+b)/p.length;x.strokeStyle='#00E5FF';x.setLineDash([5,4]);x.beginPath();x.moveTo(r.l,Y(avg));x.lineTo(r.l+r.w,Y(avg));x.stroke();x.setLineDash([]);
   p.forEach((v,i)=>{x.fillStyle=Math.abs(v-avg)<.003?'#34D399':'#FBBF24';x.beginPath();x.arc(X(i),Y(v),4,0,7);x.fill()})}
 });
 return{el:c,set:p=>Object.assign(s,p)};
};

/* Animated circular/bipolar force gauge */
Anim.gauge=function(o={}){
 const c=Anim.make(o.h||200,360);
 const s={val:0,min:o.min||-50,max:o.max||50,trig:o.trig||25,label:o.label||'PROBE FORCE (g)',unit:'g'};
 let cur=0;
 Anim.loop(c,(x,w,h)=>{
  cur+=(s.val-cur)*0.22;
  const cx=w/2,cy=h*0.84,r=Math.min(w*0.44,h*0.72);
  x.lineWidth=12;x.lineCap='round';
  x.strokeStyle='rgba(56,189,248,.25)';x.beginPath();x.arc(cx,cy,r,Math.PI,Math.PI*1.5);x.stroke();
  x.strokeStyle='rgba(16,185,129,.25)';x.beginPath();x.arc(cx,cy,r,Math.PI*1.5,Math.PI*2);x.stroke();
  const tFrac=Math.min(1,s.trig/s.max);
  x.strokeStyle='rgba(239,68,68,.55)';
  x.beginPath();x.arc(cx,cy,r,Math.PI*(1.5+0.5*tFrac),Math.PI*2);x.stroke();
  x.beginPath();x.arc(cx,cy,r,Math.PI,Math.PI*(1.5-0.5*tFrac));x.stroke();
  x.strokeStyle='rgba(255,255,255,.5)';x.lineWidth=2;
  x.beginPath();x.moveTo(cx,cy-r-8);x.lineTo(cx,cy-r+8);x.stroke();
  const frac=Math.max(-1,Math.min(1,cur/s.max));
  const ang=Math.PI*1.5+frac*(Math.PI*0.5);
  const isTrig=Math.abs(cur)>=s.trig;
  x.strokeStyle=isTrig?'#EF4444':'#34D399';x.lineWidth=3.5;
  x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+Math.cos(ang)*(r-12),cy+Math.sin(ang)*(r-12));x.stroke();
  x.fillStyle='#0F172A';x.strokeStyle='#00E5FF';x.lineWidth=2.5;
  x.beginPath();x.arc(cx,cy,10,0,Math.PI*2);x.fill();x.stroke();
  x.fillStyle=isTrig?'#F87171':'#F8FAFC';x.font='bold 24px Consolas, monospace';x.textAlign='center';
  x.fillText((cur>=0?'+':'')+cur.toFixed(1)+' '+s.unit,cx,cy-40);
  x.fillStyle='#94A3B8';x.font='bold 10px sans-serif';
  x.fillText(s.label,cx,cy-20);
 });
 return{el:c,set:p=>Object.assign(s,p)};
};

/* Stepper motor buzz & gantry animation */
Anim.stepperBuzz=function(){
 const c=Anim.make(170,400);const s={active:null};
 Anim.loop(c,(x,w,h,t)=>{
  const cx=w/2,cy=h/2;
  x.strokeStyle='rgba(51,65,85,.7)';x.lineWidth=3;
  x.strokeRect(cx-110,18,220,h-36);
  x.strokeStyle='rgba(71,85,105,.4)';x.lineWidth=1.5;
  x.beginPath();x.moveTo(cx-110,cy);x.lineTo(cx+110,cy);x.stroke();
  const motors=[
   {id:'stepper_x',l:'X MOTOR',x:cx-110,y:28},
   {id:'stepper_y',l:'Y MOTOR',x:cx+110,y:28},
   {id:'stepper_z',l:'Z (LEFT)',x:cx-110,y:h-28},
   {id:'stepper_z1',l:'Z1 (RIGHT)',x:cx+110,y:h-28},
   {id:'extruder',l:'EXTRUDER',x:cx,y:cy}
  ];
  motors.forEach(m=>{
   const act=s.active===m.id;
   const vib=act?Math.sin(t*45)*4:0;
   x.fillStyle=act?'#00E5FF':'#1E293B';
   x.strokeStyle=act?'#38BDF8':'#475569';
   x.lineWidth=act?3:1.5;
   x.beginPath();x.arc(m.x+vib,m.y,16,0,Math.PI*2);x.fill();x.stroke();
   x.fillStyle=act?'#0F172A':'#F1F5F9';
   x.font='bold 9.5px sans-serif';x.textAlign='center';
   x.fillText(m.l.split(' ')[0],m.x+vib,m.y+3.5);
  });
  if(s.active){
   x.fillStyle='#38BDF8';x.font='bold 11px sans-serif';x.textAlign='center';
   x.fillText('⚡ STEPPER BUZZ: '+s.active.toUpperCase(),cx,h-8);
  }else{
   x.fillStyle='#64748B';x.font='10.5px sans-serif';x.textAlign='center';
   x.fillText('Tap any motor below to buzz coil',cx,h-8);
  }
 });
 return{el:c,set:p=>Object.assign(s,p)};
};

/* Config health scanner animation */
Anim.scanner=function(){
 const c=Anim.make(150,440);const s={scanning:true,issues:0,checked:0,total:12};
 Anim.loop(c,(x,w,h,t)=>{
  const cx=w/2;
  x.fillStyle='#0B111D';x.fillRect(cx-190,12,380,h-24);
  x.strokeStyle='rgba(56,189,248,.3)';x.lineWidth=1;
  x.strokeRect(cx-190,12,380,h-24);
  for(let i=0;i<6;i++){
   const ly=28+i*18;
   x.fillStyle='rgba(148,163,184,.2)';
   x.fillRect(cx-170,ly,340*((i%3+2)/4),6);
  }
  const scanY=16+((t*70)%(h-32));
  const grad=x.createLinearGradient(0,scanY-14,0,scanY);
  grad.addColorStop(0,'rgba(0,229,255,0)');
  grad.addColorStop(1,'rgba(0,229,255,.45)');
  x.fillStyle=grad;x.fillRect(cx-189,scanY-14,378,14);
  x.strokeStyle='#00E5FF';x.lineWidth=2;
  x.beginPath();x.moveTo(cx-189,scanY);x.lineTo(cx+189,scanY);x.stroke();
  x.fillStyle='#E2E8F0';x.font='bold 11px Consolas, monospace';x.textAlign='center';
  x.fillText(s.scanning?'SCANNING [gcode_macro PRINT_START]…':(s.issues?'⚠ ISSUE DETECTED IN CONFIG':'✓ CONFIG HEALTHY'),cx,h-16);
 });
 return{el:c,set:p=>Object.assign(s,p)};
};

/* Manual probe paper drag test animation */
Anim.paperTest = function(o = {}) {
  const c = Anim.make(o.h || 205, 460);
  const s = { gap: 0.08, dragging: true, zPos: 0.0, dragFriction: 0.35 };
  let paperX = 0;
  Anim.loop(c, (x, w, h, t) => {
    const cx = w / 2;
    const bedY = h - 38;
    const bedW = Math.min(340, w - 60);

    // Bed surface base
    x.fillStyle = '#1E293B';
    x.fillRect(cx - bedW / 2, bedY, bedW, 18);
    x.strokeStyle = '#38BDF8';
    x.lineWidth = 1.5;
    x.strokeRect(cx - bedW / 2, bedY, bedW, 18);

    // PEI Texture line
    x.strokeStyle = '#D97706';
    x.lineWidth = 2.5;
    x.beginPath();
    x.moveTo(cx - bedW / 2 + 1, bedY + 1);
    x.lineTo(cx + bedW / 2 - 1, bedY + 1);
    x.stroke();

    // Clearance calculation
    const clampedGap = Math.max(-0.06, Math.min(0.4, s.gap));
    const nozzleTipY = bedY - 5 - clampedGap * 130;

    // Sliding paper sheet underneath
    const pSpeed = s.dragging ? 1.8 : 0;
    paperX = Math.sin(t * 3.5 * pSpeed) * 32;
    const paperW = 140, paperH = 6;
    x.fillStyle = '#F8FAFC';
    x.fillRect(cx - paperW / 2 + paperX, bedY - paperH, paperW, paperH);
    x.strokeStyle = 'rgba(0,0,0,0.4)';
    x.lineWidth = 1;
    x.strokeRect(cx - paperW / 2 + paperX, bedY - paperH, paperW, paperH);

    // Paper pull tab / arrow indicator
    if (s.dragging) {
      const dir = Math.cos(t * 3.5 * pSpeed);
      x.fillStyle = '#38BDF8';
      x.font = 'bold 11px sans-serif';
      x.textAlign = dir > 0 ? 'left' : 'right';
      x.fillText(dir > 0 ? '▶ Pulling Paper' : '◀ Pulling Paper', cx + (dir > 0 ? paperW / 2 + paperX + 8 : -paperW / 2 + paperX - 8), bedY - 1);
    }

    // Brass Nozzle & Heater Block
    const nw = 42;
    x.fillStyle = '#334155';
    x.fillRect(cx - nw / 2, nozzleTipY - 44, nw, 24);
    x.fillStyle = '#94A3B8';
    x.font = 'bold 9.5px sans-serif';
    x.textAlign = 'center';
    x.fillText('HEATER', cx, nozzleTipY - 28);

    // Brass cone
    x.fillStyle = '#D4AF37';
    x.beginPath();
    x.moveTo(cx - 14, nozzleTipY - 20);
    x.lineTo(cx + 14, nozzleTipY - 20);
    x.lineTo(cx + 3, nozzleTipY);
    x.lineTo(cx - 3, nozzleTipY);
    x.closePath();
    x.fill();
    x.strokeStyle = '#B8860B';
    x.lineWidth = 1;
    x.stroke();

    // Friction indicator & clearance status badge
    const isPinched = s.gap <= 0.01;
    const isSlightDrag = s.gap > 0.01 && s.gap <= 0.08;
    const statusCol = isSlightDrag ? '#10B981' : isPinched ? '#EF4444' : '#F59E0B';
    const statusText = isSlightDrag ? '✓ SLIGHT DRAG (FEEL FRICTION)' : isPinched ? '⚠ PINCHED / TOO TIGHT' : '○ LOOSE / NO FRICTION';

    x.fillStyle = 'rgba(15,23,42,0.85)';
    x.fillRect(cx - 135, 10, 270, 26);
    x.strokeStyle = statusCol;
    x.lineWidth = 1.5;
    x.strokeRect(cx - 135, 10, 270, 26);

    x.fillStyle = statusCol;
    x.font = 'bold 12px sans-serif';
    x.textAlign = 'center';
    x.fillText(statusText, cx, 27);

    // Clearance dimension label
    x.fillStyle = '#CBD5E1';
    x.font = 'bold 11.5px Consolas, monospace';
    x.textAlign = 'left';
    x.fillText(`GAP: ${(s.gap >= 0 ? '+' : '') + s.gap.toFixed(3)} mm`, 16, h - 12);

    x.textAlign = 'right';
    x.fillStyle = '#38BDF8';
    x.fillText(`REL Z: ${(s.zPos >= 0 ? '+' : '') + s.zPos.toFixed(3)} mm`, w - 16, h - 12);
  });
  return { el: c, set: p => Object.assign(s, p) };
};

/* Independent dual/triple Z gantry leveling animation */
Anim.zTilt = function(o = {}) {
  const c = Anim.make(o.h || 215, 460);
  const s = { tilt: 0.035, z1: 0.0, z2: 0.035, tolerance: 0.010, probing: false, pass: 1 };
  Anim.loop(c, (x, w, h, t) => {
    const cx = w / 2;
    const span = Math.min(320, w - 80);
    const lx = cx - span / 2, rx = cx + span / 2;
    const baseBedY = h - 42;
    const tiltNorm = Math.max(-1, Math.min(1, s.tilt * 12));
    const ly = baseBedY - 70;
    const ry = baseBedY - 70 - tiltNorm * 28;

    // Z leadscrews / towers
    x.strokeStyle = '#334155';
    x.lineWidth = 6;
    x.beginPath();
    x.moveTo(lx, 26); x.lineTo(lx, baseBedY);
    x.moveTo(rx, 26); x.lineTo(rx, baseBedY);
    x.stroke();

    // Bed base support
    x.fillStyle = '#1E293B';
    x.fillRect(lx - 16, baseBedY, span + 32, 10);
    x.strokeStyle = '#475569';
    x.strokeRect(lx - 16, baseBedY, span + 32, 10);

    // Gantry beam
    const isLevel = Math.abs(s.tilt) <= s.tolerance;
    const beamCol = isLevel ? '#10B981' : '#F59E0B';
    x.strokeStyle = beamCol;
    x.lineWidth = 6;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(lx, ly);
    x.lineTo(rx, ry);
    x.stroke();

    // Pivot brackets
    x.fillStyle = '#D97706';
    [[lx, ly], [rx, ry]].forEach(([px, py]) => {
      x.fillRect(px - 6, py - 4, 12, 14);
    });

    // Probing toolhead motion if probing
    if (s.probing) {
      const probeT = (Math.sin(t * 3) + 1) / 2;
      const probeX = lx + (rx - lx) * probeT;
      const probeY = ly + (ry - ly) * probeT;
      x.fillStyle = '#00E5FF';
      x.beginPath();
      x.arc(probeX, probeY - 14, 6, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = '#FFFFFF';
      x.lineWidth = 1.5;
      x.stroke();
    }

    // Lead screw motor rotation spinners
    if (!isLevel) {
      const rotDir = s.tilt > 0 ? 1 : -1;
      const ang = t * 4 * rotDir;
      x.strokeStyle = '#38BDF8';
      x.lineWidth = 2.5;
      x.beginPath();
      x.arc(rx, baseBedY + 22, 11, ang, ang + 4.2);
      x.stroke();
      x.fillStyle = '#38BDF8';
      x.font = 'bold 9.5px sans-serif';
      x.textAlign = 'center';
      x.fillText(rotDir > 0 ? 'ADJUST CW' : 'ADJUST CCW', rx, baseBedY + 38);
    }

    // Top status badge
    x.fillStyle = 'rgba(15,23,42,0.85)';
    x.fillRect(cx - 125, 10, 250, 24);
    x.strokeStyle = isLevel ? '#10B981' : '#F59E0B';
    x.lineWidth = 1.5;
    x.strokeRect(cx - 125, 10, 250, 24);

    x.fillStyle = isLevel ? '#34D399' : '#FBBF24';
    x.font = 'bold 11.5px sans-serif';
    x.textAlign = 'center';
    x.fillText(isLevel ? '✓ GANTRY TILT LEVEL (≤ 0.01 mm)' : `TILT DELTA: ${(s.tilt >= 0 ? '+' : '') + s.tilt.toFixed(3)} mm`, cx, 26);

    // Motor labels
    x.font = 'bold 11px Consolas, monospace';
    x.fillStyle = '#CBD5E1';
    x.textAlign = 'center';
    x.fillText(`Z0 (REF): 0.000`, lx, baseBedY - 14);
    x.fillText(`Z1: ${(s.tilt >= 0 ? '+' : '') + s.tilt.toFixed(3)}`, rx, baseBedY - 14);
  });
  return { el: c, set: p => Object.assign(s, p) };
};

/* Voron 4-corner Quad Gantry Level (QGL) isometric tramming animation */
Anim.quadGantry = function(o = {}) {
  const c = Anim.make(o.h || 220, 460);
  const s = {
    corners: [0.035, -0.025, 0.040, -0.015],
    probing: false,
    activeCorner: -1,
    tolerance: 0.005,
    iteration: 1
  };
  Anim.loop(c, (x, w, h, t) => {
    const cx = w / 2, cy = h / 2 - 4;
    const gw = Math.min(240, w * 0.52), gh = 90;

    // Isometric 4 corners projection
    const pts = [
      { x: cx - gw / 2, y: cy + gh / 2, name: 'Z0 (FL)', val: s.corners[0] },
      { x: cx - gw / 2 + 40, y: cy - gh / 2 + 10, name: 'Z1 (RL)', val: s.corners[1] },
      { x: cx + gw / 2 - 40, y: cy - gh / 2 + 10, name: 'Z2 (RR)', val: s.corners[2] },
      { x: cx + gw / 2, y: cy + gh / 2, name: 'Z3 (FR)', val: s.corners[3] }
    ];

    // Bed plane
    x.fillStyle = 'rgba(30,41,59,0.5)';
    x.strokeStyle = 'rgba(71,85,105,0.4)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(pts[0].x, pts[0].y + 26);
    x.lineTo(pts[1].x, pts[1].y + 26);
    x.lineTo(pts[2].x, pts[2].y + 26);
    x.lineTo(pts[3].x, pts[3].y + 26);
    x.closePath();
    x.fill();
    x.stroke();

    // 4 Z pillar posts
    pts.forEach(p => {
      x.strokeStyle = 'rgba(148,163,184,0.3)';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(p.x, p.y + 26);
      x.lineTo(p.x, p.y - 12);
      x.stroke();
    });

    // Elevated Quad Gantry frame
    const maxDev = Math.max(...s.corners.map(Math.abs));
    const isLevel = maxDev <= s.tolerance;
    const gantryCol = isLevel ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)';
    const gantryBorder = isLevel ? '#10B981' : '#F59E0B';

    const elevated = pts.map(p => ({
      x: p.x,
      y: p.y - p.val * 160
    }));

    x.fillStyle = gantryCol;
    x.strokeStyle = gantryBorder;
    x.lineWidth = 2.5;
    x.beginPath();
    x.moveTo(elevated[0].x, elevated[0].y);
    x.lineTo(elevated[1].x, elevated[1].y);
    x.lineTo(elevated[2].x, elevated[2].y);
    x.lineTo(elevated[3].x, elevated[3].y);
    x.closePath();
    x.fill();
    x.stroke();

    // Corner indicator balls & height callouts
    pts.forEach((p, idx) => {
      const ep = elevated[idx];
      const ok = Math.abs(p.val) <= s.tolerance;
      const dotCol = ok ? '#10B981' : p.val > 0 ? '#EF4444' : '#38BDF8';

      x.fillStyle = dotCol;
      x.beginPath();
      x.arc(ep.x, ep.y, 6.5, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = '#FFFFFF';
      x.lineWidth = 1.5;
      x.stroke();

      x.font = 'bold 10.5px Consolas, monospace';
      x.fillStyle = '#F8FAFC';
      x.textAlign = idx === 0 || idx === 1 ? 'right' : 'left';
      const offX = idx === 0 || idx === 1 ? -10 : 10;
      x.fillText(`${p.name}: ${(p.val >= 0 ? '+' : '') + p.val.toFixed(3)}`, ep.x + offX, ep.y + 4);
    });

    // HUD Header
    x.fillStyle = 'rgba(15,23,42,0.9)';
    x.fillRect(cx - 135, 8, 270, 24);
    x.strokeStyle = isLevel ? '#10B981' : '#F59E0B';
    x.lineWidth = 1.5;
    x.strokeRect(cx - 135, 8, 270, 24);

    x.fillStyle = isLevel ? '#34D399' : '#FBBF24';
    x.font = 'bold 11px sans-serif';
    x.textAlign = 'center';
    x.fillText(isLevel ? '✓ GANTRY LEVEL SQUARE' : `GANTRY TILT: ±${maxDev.toFixed(3)} mm (TOL: ${s.tolerance} mm)`, cx, 24);
  });
  return { el: c, set: p => Object.assign(s, p) };
};

/* Input Shaper ADXL345 Resonance Frequency Sweep & Spectrum Chart */
Anim.shaper = function(o = {}) {
  const c = Anim.make(o.h || 220, 460);
  const s = {
    axis: 'X',
    freqX: 52.4,
    freqY: 46.8,
    shaperX: 'mzv',
    shaperY: 'ei',
    testing: false,
    sweepFreq: 0
  };
  Anim.loop(c, (x, w, h, t) => {
    const cx = w / 2;
    const r = { l: 48, t: 36, w: w - 64, h: h - 70 };

    // Background chart grid
    x.fillStyle = 'rgba(11,16,29,0.7)';
    x.fillRect(r.l, r.t, r.w, r.h);
    x.strokeStyle = 'rgba(56,189,248,0.2)';
    x.strokeRect(r.l, r.t, r.w, r.h);

    // Freq grid lines (10 to 130 Hz)
    x.fillStyle = '#64748B';
    x.font = '9.5px Consolas, monospace';
    x.textAlign = 'center';
    for (let f = 20; f <= 120; f += 20) {
      const fx = r.l + ((f - 10) / 120) * r.w;
      x.strokeStyle = 'rgba(255,255,255,0.06)';
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(fx, r.t);
      x.lineTo(fx, r.t + r.h);
      x.stroke();
      x.fillText(`${f}Hz`, fx, r.t + r.h + 14);
    }

    // Resonance curve plotting for X axis (Cyan) and Y axis (Purple)
    const plotCurve = (peakFreq, col, label, active) => {
      x.strokeStyle = col;
      x.lineWidth = active ? 2.5 : 1.5;
      x.beginPath();
      for (let i = 0; i <= 60; i++) {
        const freq = 10 + (i / 60) * 120;
        const dist = (freq - peakFreq) / 10;
        const amp = Math.exp(-dist * dist * 0.5);
        const py = r.t + r.h - 8 - amp * (r.h - 22);
        const px = r.l + (i / 60) * r.w;
        if (i === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.stroke();

      // Peak marker
      const pPeakX = r.l + ((peakFreq - 10) / 120) * r.w;
      const pPeakY = r.t + 10;
      x.fillStyle = col;
      x.beginPath();
      x.arc(pPeakX, pPeakY, 4, 0, Math.PI * 2);
      x.fill();
      x.fillText(`${label}: ${peakFreq.toFixed(1)}Hz`, pPeakX, pPeakY - 6);
    };

    plotCurve(s.freqX, '#00E5FF', 'X (MZV)', s.axis === 'X');
    plotCurve(s.freqY, '#C084FC', 'Y (EI)', s.axis === 'Y');

    // Sweep cursor if testing
    if (s.testing) {
      const sw = 10 + ((t * 40) % 120);
      const swX = r.l + ((sw - 10) / 120) * r.w;
      x.strokeStyle = '#EF4444';
      x.lineWidth = 2;
      x.setLineDash([4, 4]);
      x.beginPath();
      x.moveTo(swX, r.t);
      x.lineTo(swX, r.t + r.h);
      x.stroke();
      x.setLineDash([]);
      x.fillStyle = '#EF4444';
      x.fillText(`SWEEP: ${sw.toFixed(0)} Hz`, swX, r.t + r.h + 26);
    }

    // Top HUD
    x.fillStyle = '#CBD5E1';
    x.font = 'bold 11px sans-serif';
    x.textAlign = 'left';
    x.fillText('ADXL345 RESONANCE SPECTRUM (1-133 Hz)', r.l, 22);

    x.textAlign = 'right';
    x.fillStyle = '#00E5FF';
    x.font = 'bold 11px Consolas, monospace';
    x.fillText(`RECOMMENDED: X=${s.shaperX.toUpperCase()} • Y=${s.shaperY.toUpperCase()}`, r.l + r.w, 22);
  });
  return { el: c, set: p => Object.assign(s, p) };
};

/* Axis twist compensation X-rail skew animation */
Anim.axisTwist = function(o = {}) {
  const c = Anim.make(o.h || 205, 460);
  const s = { pts: [-0.035, -0.010, 0.025, 0.045, 0.015], activeIdx: 2 };
  Anim.loop(c, (x, w, h, t) => {
    const cx = w / 2;
    const r = { l: 40, t: 36, w: w - 80, h: h - 70 };

    // Linear rail representation
    x.fillStyle = '#1E293B';
    x.fillRect(r.l, r.t + r.h / 2 - 8, r.w, 16);
    x.strokeStyle = '#475569';
    x.strokeRect(r.l, r.t + r.h / 2 - 8, r.w, 16);

    // Baseline 0-line
    x.strokeStyle = 'rgba(255,255,255,0.15)';
    x.setLineDash([4, 4]);
    x.beginPath();
    x.moveTo(r.l, r.t + r.h / 2);
    x.lineTo(r.l + r.w, r.t + r.h / 2);
    x.stroke();
    x.setLineDash([]);

    // Curve connecting twist points
    x.strokeStyle = '#00E5FF';
    x.lineWidth = 2.5;
    x.beginPath();
    s.pts.forEach((v, i) => {
      const px = r.l + (i / (s.pts.length - 1)) * r.w;
      const py = r.t + r.h / 2 - v * 240;
      if (i === 0) x.moveTo(px, py);
      else x.lineTo(px, py);
    });
    x.stroke();

    // Probe points
    s.pts.forEach((v, i) => {
      const px = r.l + (i / (s.pts.length - 1)) * r.w;
      const py = r.t + r.h / 2 - v * 240;
      const isAct = i === s.activeIdx;

      x.fillStyle = isAct ? '#00E5FF' : '#38BDF8';
      x.beginPath();
      x.arc(px, py, isAct ? 6.5 : 4.5, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = '#FFFFFF';
      x.lineWidth = 1.5;
      x.stroke();

      x.font = 'bold 10px Consolas, monospace';
      x.fillStyle = '#CBD5E1';
      x.textAlign = 'center';
      x.fillText((v >= 0 ? '+' : '') + v.toFixed(3), px, py + (v > 0 ? -10 : 18));
      x.fillText(`P${i + 1}`, px, r.t + r.h + 16);
    });

    x.fillStyle = '#CBD5E1';
    x.font = 'bold 11px sans-serif';
    x.textAlign = 'left';
    x.fillText('X-AXIS TWIST COMPENSATION SKEW', r.l, 20);
  });
  return { el: c, set: p => Object.assign(s, p) };
};

/* TMC Stepper Endstop Phase Microstep Wheel Animation */
Anim.endstopPhase = function(o = {}) {
  const c = Anim.make(o.h || 205, 460);
  const s = { phase: 42, total: 64, variance: 0 };
  Anim.loop(c, (x, w, h, t) => {
    const cx = w / 2, cy = h / 2 + 6, r = 65;

    // Outer phase ring
    x.strokeStyle = '#334155';
    x.lineWidth = 14;
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.stroke();

    // Trigger sector
    const trigAng = (s.phase / s.total) * Math.PI * 2 - Math.PI / 2;
    x.strokeStyle = '#00E5FF';
    x.lineWidth = 14;
    x.beginPath();
    x.arc(cx, cy, r, trigAng - 0.15, trigAng + 0.15);
    x.stroke();

    // Center needle
    x.strokeStyle = '#38BDF8';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(cx, cy);
    x.lineTo(cx + Math.cos(trigAng) * (r - 10), cy + Math.sin(trigAng) * (r - 10));
    x.stroke();

    x.fillStyle = '#0F172A';
    x.strokeStyle = '#00E5FF';
    x.lineWidth = 2;
    x.beginPath();
    x.arc(cx, cy, 8, 0, Math.PI * 2);
    x.fill();
    x.stroke();

    x.fillStyle = '#F8FAFC';
    x.font = 'bold 14px Consolas, monospace';
    x.textAlign = 'center';
    x.fillText(`PHASE ${s.phase} / ${s.total}`, cx, h - 8);

    x.fillStyle = '#CBD5E1';
    x.font = 'bold 11px sans-serif';
    x.fillText('TMC ENDSTOP PHASE MICROSTEP ALIGNMENT', cx, 20);
  });
  return { el: c, set: p => Object.assign(s, p) };
};

/* Delta 3-Tower Geometry Animation */
Anim.deltaCal = function(o = {}) {
  const c = Anim.make(o.h || 215, 460);
  const s = { radius: 105.0, towers: [0.0, 0.0, 0.0], probing: false };
  Anim.loop(c, (x, w, h, t) => {
    const cx = w / 2, cy = h / 2 + 18, r = 58;

    // Delta bed circle
    x.fillStyle = 'rgba(30,41,59,0.5)';
    x.strokeStyle = 'rgba(56,189,248,0.3)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();
    x.stroke();

    // 3 Towers (A at top, B at bottom-right, C at bottom-left)
    const towers = [
      { name: 'TOWER A', ang: -Math.PI / 2 },
      { name: 'TOWER B', ang: Math.PI / 6 },
      { name: 'TOWER C', ang: (5 * Math.PI) / 6 }
    ];

    towers.forEach(tw => {
      const tx = cx + Math.cos(tw.ang) * (r + 18);
      const ty = cy + Math.sin(tw.ang) * (r + 18);

      x.fillStyle = '#334155';
      x.strokeStyle = '#38BDF8';
      x.lineWidth = 2;
      x.beginPath();
      x.arc(tx, ty, 8, 0, Math.PI * 2);
      x.fill();
      x.stroke();

      x.font = 'bold 10.5px sans-serif';
      x.fillStyle = '#CBD5E1';
      x.textAlign = 'center';
      x.fillText(tw.name, tx, ty + (tw.ang < 0 ? -12 : 18));
    });

    // Effector arms
    const ex = cx + Math.sin(t * 2) * 18;
    const ey = cy + Math.cos(t * 2) * 14;

    towers.forEach(tw => {
      const tx = cx + Math.cos(tw.ang) * (r + 18);
      const ty = cy + Math.sin(tw.ang) * (r + 18);
      x.strokeStyle = 'rgba(0,229,255,0.45)';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(tx, ty);
      x.lineTo(ex, ey);
      x.stroke();
    });

    // Effector dot
    x.fillStyle = '#00E5FF';
    x.beginPath();
    x.arc(ex, ey, 5.5, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = '#FFFFFF';
    x.lineWidth = 1.5;
    x.stroke();

    x.fillStyle = '#CBD5E1';
    x.font = 'bold 11px sans-serif';
    x.textAlign = 'center';
    x.fillText('DELTA 3-TOWER GEOMETRY CALIBRATION', cx, 20);
  });
  return { el: c, set: p => Object.assign(s, p) };
};
