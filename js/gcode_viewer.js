/**
 * G-Code 3D Visualizer for Klipper Web Interface
 * High-performance 3D rotatable toolpath and live nozzle visualizer.
 * Supports orbit rotation, pan, zoom, layer slider, live printing trace,
 * and demo simulation mode. Zero external dependencies.
 */

window.GCodeViewer = (function() {
  let canvas = null;
  let ctx = null;
  let container = null;

  // Bed dimensions (mm)
  let bedW = 235;
  let bedH = 235;
  let bedMaxZ = 250;

  // 3D Camera state
  let rotX = 55;      // elevation (deg, 5 to 90)
  let rotZ = -35;     // azimuth orbit (deg)
  let zoom = 1.35;    // scale factor
  let panX = 0;       // screen offset X
  let panY = 0;       // screen offset Y
  let followNozzle = false;

  // Nozzle state
  let nozzle = { x: 117.5, y: 117.5, z: 12 };
  let targetNozzle = { x: 117.5, y: 117.5, z: 12 };
  let isExtruding = false;
  let liveSpeed = 0;
  let curLayer = 0;
  let totLayer = 0;

  // Toolpaths storage
  // layers: Array of { z: number, paths: Array of { x1, y1, z1, x2, y2, z2, ext: boolean } }
  let layers = [];
  let layerMap = new Map(); // z -> layerObj
  let activeLivePath = [];  // live points recorded as nozzle moves
  let activeLayerZ = 0;

  // Interaction state
  let isDragging = false;
  let dragMode = 'rotate'; // 'rotate' or 'pan'
  let lastMouseX = 0;
  let lastMouseY = 0;
  let pinchDist = 0;

  // Animation frame
  let animId = null;
  let isVisible = false;

  // Settings
  let showTravel = true;
  let showGrid = true;
  let showNozzle = true;
  let layerFilter = 0; // 0 = show all up to top layer; >0 = show all up to selected layer

  // Simulation state (for simulating G-code when not printing)
  let isSimulating = false;
  let simPaused = false;
  let simLayerIdx = 0;
  let simPathIdx = 0;
  const speedOptions = [2, 5, 10, 25, 50];
  let speedIdx = 2; // default: 10x
  let simSpeedMultiplier = speedOptions[speedIdx];
  let isPrinterBusy = false;

  function init(containerEl) {
    if (!containerEl) return;
    container = containerEl;
    container.innerHTML = `
      <div class="gcode-wrap" style="position:relative;width:100%;height:100%;min-height:340px;background:#050811;border-radius:12px;overflow:hidden;user-select:none">
        <canvas id="gcode-3d-canvas" style="display:block;width:100%;height:100%;cursor:grab"></canvas>
        
        <!-- Live HUD Overlay -->
        <div class="gcode-hud" style="position:absolute;top:10px;left:10px;pointer-events:none;display:flex;flex-direction:column;gap:4px">
          <div class="gcode-hud-pill mono" id="gc-hud-pos" style="background:rgba(15,23,42,0.85);backdrop-filter:blur(6px);border:1px solid rgba(0,229,255,0.35);padding:4px 10px;border-radius:8px;font-size:12px;font-weight:800;color:#F8FAFC">
            <span style="color:#00E5FF">X:</span> <span id="gc-x">0.0</span> &nbsp;
            <span style="color:#00E5FF">Y:</span> <span id="gc-y">0.0</span> &nbsp;
            <span style="color:#38BDF8">Z:</span> <span id="gc-z">0.00</span> mm
          </div>
          <div class="gcode-hud-sub mono" style="background:rgba(15,23,42,0.75);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.1);padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;color:#94A3B8;display:inline-flex;gap:10px">
            <span>Layer: <b id="gc-lay-txt" style="color:#C084FC">0 / 0</b></span>
            <span>Speed: <b id="gc-spd-txt" style="color:#34D399">0 mm/s</b></span>
          </div>
        </div>

        <!-- 3D View Controls (Top-Right) -->
        <div class="gcode-tools" style="position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:2">
          <button class="btn sm" id="gc-btn-3d" title="3D Isometric View" style="padding:4px 9px;font-size:11px;font-weight:800">⟳ 3D</button>
          <button class="btn sm" id="gc-btn-top" title="Top-Down 2D View" style="padding:4px 9px;font-size:11px;font-weight:800">⊞ Top</button>
          <button class="btn sm" id="gc-btn-front" title="Front Elevation View" style="padding:4px 9px;font-size:11px;font-weight:800">⬒ Front</button>
          <button class="btn sm" id="gc-btn-follow" title="Toggle Auto-Follow Nozzle" style="padding:4px 9px;font-size:11px;font-weight:800">🎯 Follow</button>
          <button class="btn sm" id="gc-btn-reset" title="Reset View & Center Bed" style="padding:4px 9px;font-size:11px;font-weight:800">⛶ Center</button>
        </div>

        <!-- Bottom Controls & Layer Slider -->
        <div class="gcode-bot-bar" style="position:absolute;bottom:8px;left:8px;right:8px;display:flex;align-items:center;gap:8px;background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.12);padding:6px 12px;border-radius:10px;z-index:2">
          <button class="btn sm pri" id="gc-btn-play" title="Simulate G-Code printing" style="padding:4px 11px;font-size:11px;font-weight:800;background:linear-gradient(135deg,#00E5FF,#2563EB);border:none;box-shadow:0 0 10px rgba(0,229,255,.3);display:flex;align-items:center;gap:4px">
            <span id="gc-play-icon">▶</span> <span id="gc-play-text">Play</span>
          </button>
          <button class="btn sm" id="gc-btn-speed" title="Simulation Speed (tap to change)" style="padding:3px 7px;font-size:10.5px;font-weight:800;border-color:rgba(0,229,255,.3);color:#00E5FF">10x</button>
          <span style="font-size:11px;font-weight:800;color:#94A3B8;white-space:nowrap">LAYER:</span>
          <input type="range" id="gc-layer-slider" min="0" max="0" value="0" style="flex:1;cursor:pointer;accent-color:#00E5FF;height:6px">
          <span id="gc-slider-val" class="mono" style="font-size:11.5px;font-weight:800;color:#00E5FF;min-width:55px;text-align:right">ALL</span>
          <button class="btn sm" id="gc-btn-clear" title="Clear Extrusion Paths" style="padding:3px 7px;font-size:11px">✕ Clear</button>
        </div>
      </div>
    `;

    canvas = container.querySelector('#gcode-3d-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    setupEvents();
    resizeCanvas();

    // ResizeObserver for clean responsive auto-scaling
    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(container);

    startRenderLoop();
  }

  function resizeCanvas() {
    if (!canvas || !container) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      const wasZero = canvas.width === 0;
      canvas.width = w;
      canvas.height = h;
      if (wasZero || zoom === 1.35) fitBed();
    }
  }

  function setupEvents() {
    if (!canvas) return;

    // View button actions
    container.querySelector('#gc-btn-3d')?.addEventListener('click', () => {
      rotX = 55; rotZ = -35; panX = 0; panY = 0; followNozzle = false; updateFollowBtn();
    });
    container.querySelector('#gc-btn-top')?.addEventListener('click', () => {
      rotX = 90; rotZ = 0; panX = 0; panY = 0; followNozzle = false; updateFollowBtn();
    });
    container.querySelector('#gc-btn-front')?.addEventListener('click', () => {
      rotX = 8; rotZ = 0; panX = 0; panY = 0; followNozzle = false; updateFollowBtn();
    });
    container.querySelector('#gc-btn-reset')?.addEventListener('click', () => {
      rotX = 55; rotZ = -35; panX = 0; panY = 0; followNozzle = false; updateFollowBtn();
      fitBed();
    });
    container.querySelector('#gc-btn-follow')?.addEventListener('click', () => {
      followNozzle = !followNozzle;
      updateFollowBtn();
    });
    container.querySelector('#gc-btn-play')?.addEventListener('click', () => {
      toggleSimulation();
    });
    container.querySelector('#gc-btn-speed')?.addEventListener('click', () => {
      toggleSpeed();
    });
    container.querySelector('#gc-btn-clear')?.addEventListener('click', () => {
      stopSimulation();
      layers = [];
      layerMap.clear();
      activeLivePath = [];
      updateLayerSlider();
      updatePlayBtn();
      toast('Visualizer paths cleared');
    });

    const slider = container.querySelector('#gc-layer-slider');
    slider?.addEventListener('input', (e) => {
      layerFilter = parseInt(e.target.value, 10);
      const valTxt = container.querySelector('#gc-slider-val');
      if (valTxt) valTxt.textContent = layerFilter === 0 ? 'ALL' : `${layerFilter}`;
      if (isSimulating && layerFilter > 0) {
        simLayerIdx = Math.max(0, Math.min(layers.length - 1, layerFilter - 1));
        simPathIdx = 0;
      }
    });

    // Mouse Controls
    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate';
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;

      if (dragMode === 'rotate') {
        rotZ = (rotZ + dx * 0.5) % 360;
        rotX = Math.max(5, Math.min(90, rotX + dy * 0.4));
      } else {
        panX += dx;
        panY += dy;
        followNozzle = false;
        updateFollowBtn();
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (canvas) canvas.style.cursor = 'grab';
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Scroll Zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      zoom = Math.max(0.4, Math.min(6.0, zoom * factor));
    }, { passive: false });

    // Touch Controls
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        dragMode = 'rotate';
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        isDragging = true;
        dragMode = 'pinch';
        pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        lastMouseX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastMouseY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      if (e.touches.length === 1 && dragMode === 'rotate') {
        const dx = e.touches[0].clientX - lastMouseX;
        const dy = e.touches[0].clientY - lastMouseY;
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
        rotZ = (rotZ + dx * 0.6) % 360;
        rotX = Math.max(5, Math.min(90, rotX + dy * 0.5));
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (pinchDist > 0 && dist > 0) {
          const factor = dist / pinchDist;
          zoom = Math.max(0.4, Math.min(6.0, zoom * factor));
          pinchDist = dist;
        }
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        panX += (midX - lastMouseX) * 0.8;
        panY += (midY - lastMouseY) * 0.8;
        lastMouseX = midX;
        lastMouseY = midY;
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      isDragging = false;
      pinchDist = 0;
    });
  }

  function updateFollowBtn() {
    const btn = container?.querySelector('#gc-btn-follow');
    if (btn) btn.classList.toggle('on', followNozzle);
  }

  function fitBed() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    if (cw <= 0 || ch <= 0) return;
    zoom = Math.min(cw / 240, ch / 210);
    panX = 0;
    panY = 10;
  }

  // Simulation Controls & Speed
  function setPrinting(printing) {
    isPrinterBusy = !!printing;
    if (isPrinterBusy && isSimulating) {
      stopSimulation();
    }
    updatePlayBtn();
  }

  function toggleSimulation() {
    if (isPrinterBusy) {
      toast('Cannot simulate while printer is actively printing');
      return;
    }
    if (!layers.length) {
      toast('Load a G-code file first to simulate print');
      return;
    }

    if (!isSimulating) {
      isSimulating = true;
      simPaused = false;
      if (simLayerIdx >= layers.length || (layerFilter === 0 && simLayerIdx === 0 && simPathIdx === 0)) {
        simLayerIdx = 0;
        simPathIdx = 0;
      } else if (layerFilter > 0) {
        simLayerIdx = Math.max(0, Math.min(layers.length - 1, layerFilter - 1));
        simPathIdx = 0;
      }
      toast('▶ Simulating G-code print…');
    } else if (simPaused) {
      simPaused = false;
      toast('▶ Resumed simulation');
    } else {
      simPaused = true;
      toast('⏸ Paused simulation');
    }
    updatePlayBtn();
  }

  function stopSimulation() {
    isSimulating = false;
    simPaused = false;
    isExtruding = false;
    updatePlayBtn();
  }

  function toggleSpeed() {
    speedIdx = (speedIdx + 1) % speedOptions.length;
    simSpeedMultiplier = speedOptions[speedIdx];
    const spdBtn = container?.querySelector('#gc-btn-speed');
    if (spdBtn) spdBtn.textContent = `${simSpeedMultiplier}x`;
    toast(`Simulation speed: ${simSpeedMultiplier}x`);
  }

  function updatePlayBtn() {
    const playBtn = container?.querySelector('#gc-btn-play');
    const playIcon = container?.querySelector('#gc-play-icon');
    const playTxt = container?.querySelector('#gc-play-text');
    if (!playBtn) return;

    if (isPrinterBusy) {
      playBtn.disabled = true;
      playBtn.style.opacity = '0.55';
      playBtn.style.cursor = 'not-allowed';
      playBtn.style.background = 'rgba(255,255,255,0.08)';
      playBtn.style.boxShadow = 'none';
      if (playIcon) playIcon.textContent = '●';
      if (playTxt) playTxt.textContent = 'Printing';
      return;
    }

    playBtn.disabled = false;
    playBtn.style.opacity = '1';
    playBtn.style.cursor = 'pointer';

    if (isSimulating && !simPaused) {
      if (playIcon) playIcon.textContent = '⏸';
      if (playTxt) playTxt.textContent = 'Pause';
      playBtn.style.background = 'linear-gradient(135deg,#F59E0B,#D97706)';
      playBtn.style.boxShadow = '0 0 10px rgba(245,158,11,.4)';
    } else if (isSimulating && simPaused) {
      if (playIcon) playIcon.textContent = '▶';
      if (playTxt) playTxt.textContent = 'Resume';
      playBtn.style.background = 'linear-gradient(135deg,#00E5FF,#2563EB)';
      playBtn.style.boxShadow = '0 0 10px rgba(0,229,255,.3)';
    } else {
      if (playIcon) playIcon.textContent = '▶';
      if (playTxt) playTxt.textContent = 'Play';
      playBtn.style.background = 'linear-gradient(135deg,#00E5FF,#2563EB)';
      playBtn.style.boxShadow = '0 0 10px rgba(0,229,255,.3)';
    }
  }

  // 3D Projection Math
  function project(x, y, z, cx, cy) {
    const dx = x - bedW / 2;
    const dy = y - bedH / 2;
    const dz = z;

    const radZ = (rotZ * Math.PI) / 180;
    const radX = (rotX * Math.PI) / 180;

    const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);
    const x1 = dx * cosZ - dy * sinZ;
    const y1 = dx * sinZ + dy * cosZ;
    const z1 = dz;

    const cosX = Math.cos(radX), sinX = Math.sin(radX);
    const x2 = x1;
    const y2 = y1 * cosX - z1 * sinX;
    const z2 = y1 * sinX + z1 * cosX;

    const pDist = 720;
    const pScale = pDist / (pDist + y2);

    const sx = cx + (x2 * zoom * pScale) + panX;
    const sy = cy - (z2 * zoom * pScale) + panY;

    return { x: sx, y: sy, depth: y2 };
  }

  // Live Position Update from Moonraker or Demo
  function updatePosition(x, y, z, speed, extruding, layerNum, totalLayers) {
    targetNozzle.x = typeof x === 'number' ? x : targetNozzle.x;
    targetNozzle.y = typeof y === 'number' ? y : targetNozzle.y;
    targetNozzle.z = typeof z === 'number' ? Math.max(0, z) : targetNozzle.z;
    liveSpeed = speed || 0;
    isExtruding = !!extruding;
    if (layerNum) curLayer = layerNum;
    if (totalLayers) totLayer = totalLayers;

    // Update HUD text
    const xEl = container?.querySelector('#gc-x');
    const yEl = container?.querySelector('#gc-y');
    const zEl = container?.querySelector('#gc-z');
    const lEl = container?.querySelector('#gc-lay-txt');
    const sEl = container?.querySelector('#gc-spd-txt');

    if (xEl) xEl.textContent = targetNozzle.x.toFixed(1);
    if (yEl) yEl.textContent = targetNozzle.y.toFixed(1);
    if (zEl) zEl.textContent = targetNozzle.z.toFixed(2);
    if (lEl) lEl.textContent = `${curLayer} / ${totLayer || '?'}`;
    if (sEl) sEl.textContent = `${liveSpeed.toFixed(0)} mm/s`;

    // Append to live path if extruding/printing
    if (isExtruding && (Math.abs(nozzle.x - targetNozzle.x) > 0.1 || Math.abs(nozzle.y - targetNozzle.y) > 0.1)) {
      addLivePathSegment(nozzle.x, nozzle.y, nozzle.z, targetNozzle.x, targetNozzle.y, targetNozzle.z);
    }
  }

  function addLivePathSegment(x1, y1, z1, x2, y2, z2) {
    const lz = Math.round(z2 * 100) / 100;
    let lay = layerMap.get(lz);
    if (!lay) {
      lay = { z: lz, paths: [] };
      layerMap.set(lz, lay);
      layers.push(lay);
      layers.sort((a, b) => a.z - b.z);
      updateLayerSlider();
    }
    lay.paths.push({ x1, y1, z1, x2, y2, z2, ext: true });
  }

  function updateLayerSlider() {
    const slider = container?.querySelector('#gc-layer-slider');
    if (!slider) return;
    const max = layers.length;
    slider.max = `${max}`;
    if (layerFilter > max) {
      layerFilter = 0;
      slider.value = '0';
      const valTxt = container?.querySelector('#gc-slider-val');
      if (valTxt) valTxt.textContent = 'ALL';
    }
  }

  // Smooth Render Loop
  function startRenderLoop() {
    function loop() {
      renderScene();
      animId = requestAnimationFrame(loop);
    }
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
  }

  function renderScene() {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    if (w <= 0 || h <= 0) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Subtle background gradient
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, Math.max(w, h));
    bgGrad.addColorStop(0, '#090E1A');
    bgGrad.addColorStop(1, '#03060C');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Screen Center
    const cx = w / 2;
    const cy = h / 2 + 20;

    // Simulation step update
    if (isSimulating && !simPaused && layers.length > 0) {
      const curLay = layers[simLayerIdx];
      if (curLay && curLay.paths.length > 0) {
        simPathIdx = Math.min(curLay.paths.length, simPathIdx + simSpeedMultiplier);

        const targetP = curLay.paths[Math.min(curLay.paths.length - 1, Math.max(0, simPathIdx - 1))];
        if (targetP) {
          targetNozzle.x = targetP.x2;
          targetNozzle.y = targetP.y2;
          targetNozzle.z = curLay.z;
          isExtruding = !!targetP.ext;
        }

        if (simPathIdx >= curLay.paths.length) {
          simLayerIdx++;
          simPathIdx = 0;
          if (simLayerIdx >= layers.length) {
            isSimulating = false;
            simPaused = false;
            isExtruding = false;
            updatePlayBtn();
            toast('✓ G-code simulation finished');
          }
        }

        curLayer = Math.min(layers.length, simLayerIdx + 1);
        totLayer = layers.length;
        liveSpeed = Math.round(50 * (simSpeedMultiplier / 5));

        const xEl = container?.querySelector('#gc-x');
        const yEl = container?.querySelector('#gc-y');
        const zEl = container?.querySelector('#gc-z');
        const lEl = container?.querySelector('#gc-lay-txt');
        const sEl = container?.querySelector('#gc-spd-txt');
        if (xEl) xEl.textContent = targetNozzle.x.toFixed(1);
        if (yEl) yEl.textContent = targetNozzle.y.toFixed(1);
        if (zEl) zEl.textContent = targetNozzle.z.toFixed(2);
        if (lEl) lEl.textContent = `${curLayer} / ${totLayer}`;
        if (sEl) sEl.textContent = `${liveSpeed} mm/s`;

        const slider = container?.querySelector('#gc-layer-slider');
        if (slider) slider.value = `${curLayer}`;
        const valTxt = container?.querySelector('#gc-slider-val');
        if (valTxt) valTxt.textContent = `${curLayer}/${totLayer}`;
      }
    }

    // Follow Nozzle Camera offset
    if (followNozzle) {
      const pN = project(targetNozzle.x, targetNozzle.y, targetNozzle.z, cx, cy);
      panX += (cx - pN.x) * 0.08;
      panY += (cy - pN.y) * 0.08;
    }

    // Smooth nozzle position interpolation
    nozzle.x += (targetNozzle.x - nozzle.x) * (isSimulating ? 0.45 : 0.25);
    nozzle.y += (targetNozzle.y - nozzle.y) * (isSimulating ? 0.45 : 0.25);
    nozzle.z += (targetNozzle.z - nozzle.z) * (isSimulating ? 0.45 : 0.25);

    // 1. Draw 3D Build Plate
    if (showGrid) {
      drawBuildPlate(cx, cy);
    }

    // 2. Draw Toolpaths & Extrusion Layers
    drawToolpaths(cx, cy);

    // 3. Draw Live 3D Nozzle & Laser Alignment Line
    if (showNozzle) {
      draw3DNozzle(cx, cy);
    }

    // 4. Draw 3D Coordinate Gimbal / Compass
    drawGimbalCompass(w - 38, h - 38);

    ctx.restore();
  }

  // 1. Build Plate Drawing
  function drawBuildPlate(cx, cy) {
    const corners = [
      project(0, 0, 0, cx, cy),
      project(bedW, 0, 0, cx, cy),
      project(bedW, bedH, 0, cx, cy),
      project(0, bedH, 0, cx, cy),
    ];

    // Bed Plate Surface
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.lineTo(corners[2].x, corners[2].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.closePath();

    const plateGrad = ctx.createLinearGradient(corners[0].x, corners[0].y, corners[2].x, corners[2].y);
    plateGrad.addColorStop(0, 'rgba(15, 23, 42, 0.88)');
    plateGrad.addColorStop(1, 'rgba(7, 11, 20, 0.95)');
    ctx.fillStyle = plateGrad;
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 3D Beveled plate edge (thickness)
    const b0 = project(0, 0, -4, cx, cy);
    const b1 = project(bedW, 0, -4, cx, cy);
    const b2 = project(bedW, bedH, -4, cx, cy);
    const b3 = project(0, bedH, -4, cx, cy);

    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.lineTo(b1.x, b1.y);
    ctx.lineTo(b0.x, b0.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.fill();

    // Grid Lines
    ctx.lineWidth = 0.75;
    for (let x = 0; x <= bedW; x += 10) {
      const isMajor = x % 50 === 0 || x === bedW;
      ctx.strokeStyle = isMajor ? 'rgba(0, 229, 255, 0.28)' : 'rgba(56, 189, 248, 0.08)';
      ctx.lineWidth = isMajor ? 1.0 : 0.6;
      const p1 = project(x, 0, 0, cx, cy);
      const p2 = project(x, bedH, 0, cx, cy);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let y = 0; y <= bedH; y += 10) {
      const isMajor = y % 50 === 0 || y === bedH;
      ctx.strokeStyle = isMajor ? 'rgba(0, 229, 255, 0.28)' : 'rgba(56, 189, 248, 0.08)';
      ctx.lineWidth = isMajor ? 1.0 : 0.6;
      const p1 = project(0, y, 0, cx, cy);
      const p2 = project(bedW, y, 0, cx, cy);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Origin Glowing Point (0,0,0)
    const p0 = project(0, 0, 0, cx, cy);
    ctx.beginPath();
    ctx.arc(p0.x, p0.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#00E5FF';
    ctx.shadowColor = '#00E5FF';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Dimension labels
    ctx.font = '9px Consolas, monospace';
    ctx.fillStyle = '#64748B';
    ctx.fillText('0,0', p0.x - 18, p0.y + 12);
    const pEnd = project(bedW, 0, 0, cx, cy);
    ctx.fillText(`${bedW}mm`, pEnd.x + 4, pEnd.y + 4);
  }

  // 2. Toolpath Rendering - leaves all previous layers there when drawing a layer
  function drawToolpaths(cx, cy) {
    if (!layers.length) return;

    let maxLayerIdx;
    let activePathLimit = null;

    if (isSimulating) {
      maxLayerIdx = Math.min(layers.length - 1, simLayerIdx);
      activePathLimit = simPathIdx;
    } else if (layerFilter > 0) {
      // User scrubbed slider: leave all previous layers underneath it!
      maxLayerIdx = Math.min(layers.length - 1, layerFilter - 1);
    } else {
      // layerFilter === 0: show ALL layers
      maxLayerIdx = layers.length - 1;
    }

    const totalL = layers.length;

    for (let lIdx = 0; lIdx <= maxLayerIdx; lIdx++) {
      const lay = layers[lIdx];
      const isTopActive = (lIdx === maxLayerIdx);
      const progressRatio = totalL > 1 ? lIdx / totalL : 1;

      // Color gradient: base layers have depth gradient; top/active layer is highlighted in bright neon cyan #00E5FF
      let strokeCol = isTopActive
        ? '#00E5FF'
        : `hsl(${210 + progressRatio * 60}, 80%, ${38 + progressRatio * 20}%)`;

      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = isTopActive ? 2.2 : 1.3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (isTopActive) {
        ctx.shadowColor = '#00E5FF';
        ctx.shadowBlur = 6;
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      const pathLimit = (isTopActive && activePathLimit !== null)
        ? Math.min(lay.paths.length, activePathLimit)
        : lay.paths.length;

      for (let pIdx = 0; pIdx < pathLimit; pIdx++) {
        const p = lay.paths[pIdx];
        if (!p.ext && !showTravel) continue;
        const p1 = project(p.x1, p.y1, p.z1, cx, cy);
        const p2 = project(p.x2, p.y2, p.z2, cx, cy);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      }
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
  }

  // 3. Live 3D Nozzle & Toolhead
  function draw3DNozzle(cx, cy) {
    const nx = nozzle.x;
    const ny = nozzle.y;
    const nz = nozzle.z;

    // Bed Target Ring (projection of nozzle onto bed z=0)
    const pBed = project(nx, ny, 0, cx, cy);
    ctx.beginPath();
    ctx.ellipse(pBed.x, pBed.y, 8, 4.5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Crosshair ticks
    ctx.beginPath();
    ctx.moveTo(pBed.x - 10, pBed.y); ctx.lineTo(pBed.x + 10, pBed.y);
    ctx.moveTo(pBed.x, pBed.y - 6); ctx.lineTo(pBed.x, pBed.y + 6);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.stroke();

    // Vertical Laser Guide Line (from bed to nozzle tip)
    const pTip = project(nx, ny, nz, cx, cy);
    if (nz > 0.5) {
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(pBed.x, pBed.y);
      ctx.lineTo(pTip.x, pTip.y);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Glowing Extrusion Point
    ctx.beginPath();
    ctx.arc(pTip.x, pTip.y, isExtruding ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = isExtruding ? '#FFB703' : '#00E5FF';
    ctx.shadowColor = isExtruding ? '#FFB703' : '#00E5FF';
    ctx.shadowBlur = isExtruding ? 12 : 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 3D Brass Nozzle Cone
    const coneH = 9;
    const coneW = 6;
    const pTopCone = project(nx, ny, nz + coneH, cx, cy);
    const pLeftCone = project(nx - coneW, ny, nz + coneH, cx, cy);
    const pRightCone = project(nx + coneW, ny, nz + coneH, cx, cy);

    ctx.beginPath();
    ctx.moveTo(pTip.x, pTip.y);
    ctx.lineTo(pLeftCone.x, pLeftCone.y);
    ctx.lineTo(pRightCone.x, pRightCone.y);
    ctx.closePath();

    const brassGrad = ctx.createLinearGradient(pLeftCone.x, pLeftCone.y, pRightCone.x, pRightCone.y);
    brassGrad.addColorStop(0, '#B45309');
    brassGrad.addColorStop(0.5, '#FBBF24');
    brassGrad.addColorStop(1, '#92400E');
    ctx.fillStyle = brassGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.75;
    ctx.stroke();

    // 3D Heater Block (Aluminum cube above nozzle)
    const blockH = 10;
    const blockW = 9;
    const pBlockTL = project(nx - blockW, ny - blockW, nz + coneH, cx, cy);
    const pBlockTR = project(nx + blockW, ny - blockW, nz + coneH, cx, cy);
    const pBlockBR = project(nx + blockW, ny + blockW, nz + coneH + blockH, cx, cy);
    const pBlockBL = project(nx - blockW, ny + blockW, nz + coneH + blockH, cx, cy);

    ctx.beginPath();
    ctx.moveTo(pLeftCone.x, pLeftCone.y);
    ctx.lineTo(pBlockBL.x, pBlockBL.y);
    ctx.lineTo(pBlockBR.x, pBlockBR.y);
    ctx.lineTo(pRightCone.x, pRightCone.y);
    ctx.closePath();

    const aluGrad = ctx.createLinearGradient(pBlockBL.x, pBlockBL.y, pBlockBR.x, pBlockBR.y);
    aluGrad.addColorStop(0, '#475569');
    aluGrad.addColorStop(0.5, '#94A3B8');
    aluGrad.addColorStop(1, '#334155');
    ctx.fillStyle = aluGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
  }

  // 4. Orientation Compass
  function drawGimbalCompass(gx, gy) {
    const len = 22;
    const radZ = (rotZ * Math.PI) / 180;
    const radX = (rotX * Math.PI) / 180;

    function projDir(dx, dy, dz) {
      const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);
      const x1 = dx * cosZ - dy * sinZ;
      const y1 = dx * sinZ + dy * cosZ;
      const cosX = Math.cos(radX), sinX = Math.sin(radX);
      const x2 = x1;
      const y2 = y1 * cosX - dz * sinX;
      const z2 = y1 * sinX + dz * cosX;
      return { x: gx + x2 * len, y: gy - z2 * len };
    }

    const pX = projDir(1, 0, 0);
    const pY = projDir(0, 1, 0);
    const pZ = projDir(0, 0, 1);

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    // X Axis - Red
    ctx.strokeStyle = '#EF4444';
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(pX.x, pX.y); ctx.stroke();
    ctx.fillStyle = '#EF4444';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('X', pX.x + 3, pX.y + 3);

    // Y Axis - Green
    ctx.strokeStyle = '#10B981';
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(pY.x, pY.y); ctx.stroke();
    ctx.fillStyle = '#10B981';
    ctx.fillText('Y', pY.x + 3, pY.y + 3);

    // Z Axis - Blue
    ctx.strokeStyle = '#38BDF8';
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(pZ.x, pZ.y); ctx.stroke();
    ctx.fillStyle = '#38BDF8';
    ctx.fillText('Z', pZ.x + 3, pZ.y - 2);
  }

  // Load and Parse G-code string
  function loadGCode(gcodeText) {
    if (!gcodeText) return;
    layers = [];
    layerMap.clear();

    const lines = gcodeText.split('\n');
    let curX = 0, curY = 0, curZ = 0;
    let curLayZ = 0;
    let currentLayer = null;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const semiIdx = raw.indexOf(';');
      const line = (semiIdx >= 0 ? raw.slice(0, semiIdx) : raw).trim();
      if (!line) continue;

      if (line.startsWith('G0') || line.startsWith('G1') || line.startsWith('G2') || line.startsWith('G3')) {
        let x = curX, y = curY, z = curZ;
        let ext = false;

        const parts = line.split(/\s+/);
        for (let p = 1; p < parts.length; p++) {
          const part = parts[p];
          const code = part[0];
          const val = parseFloat(part.slice(1));
          if (code === 'X') x = val;
          else if (code === 'Y') y = val;
          else if (code === 'Z') {
            z = val;
            if (z !== curLayZ) {
              curLayZ = Math.round(z * 100) / 100;
              currentLayer = layerMap.get(curLayZ);
              if (!currentLayer) {
                currentLayer = { z: curLayZ, paths: [] };
                layerMap.set(curLayZ, currentLayer);
                layers.push(currentLayer);
              }
            }
          } else if (code === 'E') {
            if (val > 0) ext = true;
          }
        }

        if (ext && (x !== curX || y !== curY)) {
          if (!currentLayer) {
            curLayZ = Math.round(curZ * 100) / 100;
            currentLayer = { z: curLayZ, paths: [] };
            layerMap.set(curLayZ, currentLayer);
            layers.push(currentLayer);
          }
          currentLayer.paths.push({ x1: curX, y1: curY, z1: curZ, x2: x, y2: y, z2: z, ext: true });
        }

        curX = x; curY = y; curZ = z;
      }
    }

    layers.sort((a, b) => a.z - b.z);
    totLayer = layers.length;
    curLayer = layers.length;
    if (layers.length > 0) {
      const topLay = layers[layers.length - 1];
      if (topLay.paths.length > 0) {
        const lastP = topLay.paths[topLay.paths.length - 1];
        targetNozzle.x = lastP.x2;
        targetNozzle.y = lastP.y2;
        targetNozzle.z = topLay.z;
        nozzle.x = targetNozzle.x;
        nozzle.y = targetNozzle.y;
        nozzle.z = targetNozzle.z;
      }
    }
    stopSimulation();
    simLayerIdx = 0;
    simPathIdx = 0;
    layerFilter = 0;
    updateLayerSlider();
    updatePlayBtn();
    fitBed();
    toast(`3D Visualizer: loaded ${layers.length} layers`);
  }

  async function loadFromUrl(url) {
    if (!url) return false;
    try {
      toast('📥 Loading G-code for 3D Visualizer…');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      loadGCode(text);
      return true;
    } catch (e) {
      console.warn('GCodeViewer loadFromUrl error:', e);
      return false;
    }
  }

  return {
    init,
    updatePosition,
    loadGCode,
    loadFromUrl,
    fitBed,
    setPrinting,
    toggleSimulation,
    stopSimulation,
    destroy() {
      cancelAnimationFrame(animId);
      stopSimulation();
    }
  };
})();
