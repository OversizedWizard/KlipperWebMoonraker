/* Print History Page: Browse past prints (successful and failed), view full print stats, clear history, and Print Again */
(function(){
  const root = $('#p-history');
  let jobs = [];
  let filter = 'all'; // 'all', 'completed', 'failed'
  let loading = false;
  let errorMsg = '';

  function fmtTime(sec){
    if(!sec || sec <= 0) return '0s';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    if(h > 0) return `${h}h ${m}m ${rem}s`;
    if(m > 0) return `${m}m ${rem}s`;
    return `${rem}s`;
  }

  function fmtDate(epoch){
    if(!epoch) return 'Unknown';
    try {
      const d = new Date(epoch * 1000);
      return d.toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}) + ' ' +
             d.toLocaleTimeString(undefined, {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    } catch(e){
      return 'Unknown';
    }
  }

  function fmtFilament(mm){
    if(!mm || mm <= 0) return '0 mm';
    const m = (mm / 1000).toFixed(2);
    // Approximate PLA grams for 1.75mm: density ~1.24 g/cm3 => ~2.98 g/m
    const g = (m * 2.98).toFixed(1);
    if(mm >= 1000) return `${m} m (${g} g)`;
    return `${mm.toFixed(0)} mm (${g} g)`;
  }

  function detectBedMesh(job){
    const meta = job.metadata || {};
    if(meta.bed_mesh) return meta.bed_mesh;
    if(meta.adaptive_mesh) return 'Adaptive (KAMP)';
    // Check if bed was heated or if start macro typically loads default
    if(meta.first_layer_bed_temp && meta.first_layer_bed_temp > 0){
      return 'default (Active)';
    }
    return 'None / Off';
  }

  function isSuccessful(job){
    return job.status === 'completed';
  }

  function isFailed(job){
    return job.status === 'cancelled' || job.status === 'error' || job.status === 'klippy_shutdown';
  }

  async function loadHistory(){
    loading = true;
    errorMsg = '';
    render();
    try {
      const res = await MR.getHistory(100);
      if (Array.isArray(res)) {
        jobs = res;
      } else if (res && Array.isArray(res.jobs)) {
        jobs = res.jobs;
      } else {
        jobs = [];
      }
    } catch(e){
      console.error('Failed to load history', e);
      errorMsg = (e && e.message) ? String(e.message) : 'Network or Moonraker error';
      toast('Failed to load history: ' + errorMsg);
    } finally {
      loading = false;
      render();
    }
  }

  function openJobDetails(job){
    const meta = job.metadata || {};
    const success = isSuccessful(job);
    const statusText = success ? 'SUCCESSFUL' : (job.status ? job.status.toUpperCase() : 'UNKNOWN');
    const statusCol = success ? '#10B981' : '#EF4444';
    const statusBg = success ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.18)';
    const statusBorder = success ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.45)';

    const cleanName = (job.filename || 'Unknown').split('/').pop();
    const meshUsed = detectBedMesh(job);
    const printDur = fmtTime(job.print_duration);
    const totalDur = fmtTime(job.total_duration);
    const filUsed = fmtFilament(job.filament_used);
    const filTotal = meta.filament_total ? fmtFilament(meta.filament_total) : 'N/A';
    const startDate = fmtDate(job.start_time);
    const endDate = fmtDate(job.end_time);

    const slicer = (meta.slicer ? `${meta.slicer} ${meta.slicer_version || ''}` : 'Unknown').trim();
    const layerCount = meta.layer_count ? `${meta.layer_count} layers` : 'Unknown';
    const layerH = meta.layer_height ? `${meta.layer_height} mm` : 'Unknown';
    const objH = meta.object_height ? `${meta.object_height} mm` : 'Unknown';

    const n = el(`
      <div class="dlg" style="max-width:540px;border:1.5px solid rgba(0,229,255,0.4);border-radius:12px;padding:20px;background:#0d1527">
        <div class="row" style="align-items:flex-start;gap:12px;margin-bottom:14px">
          <div style="width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:${statusBg};color:${statusCol};border:1px solid ${statusBorder};flex-shrink:0">
            ${success ? '✔' : '✖'}
          </div>
          <div class="grow" style="overflow:hidden">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="background:${statusBg};color:${statusCol};border:1px solid ${statusBorder};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:800;letter-spacing:1px">${statusText}</span>
              <span style="color:#64748b;font-size:11px;font-weight:700">ID: ${job.job_id || '--'}</span>
            </div>
            <h3 style="margin:6px 0 0;font-size:16px;font-weight:800;color:#f8fafc;word-break:break-all">${cleanName}</h3>
            <div style="color:#94a3b8;font-size:11px;margin-top:2px">${job.filename}</div>
          </div>
          <button class="x" id="jd-close" style="background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;padding:4px">✕</button>
        </div>

        <div style="background:#131d33;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#00E5FF;letter-spacing:1px;margin-bottom:8px">PRINT TIMING & STATISTICS</div>
          <div class="grid2" style="gap:10px;font-size:12px">
            <div><span style="color:#64748b">Start Time:</span> <b style="color:#cbd5e1">${startDate}</b></div>
            <div><span style="color:#64748b">End Time:</span> <b style="color:#cbd5e1">${endDate}</b></div>
            <div><span style="color:#64748b">Print Duration:</span> <b style="color:#00E5FF">${printDur}</b></div>
            <div><span style="color:#64748b">Total Duration:</span> <b style="color:#cbd5e1">${totalDur}</b></div>
            <div><span style="color:#64748b">Filament Used:</span> <b style="color:#38bdf8">${filUsed}</b></div>
            <div><span style="color:#64748b">Filament Total:</span> <b style="color:#cbd5e1">${filTotal}</b></div>
          </div>
        </div>

        <div style="background:#131d33;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;margin-bottom:16px">
          <div style="font-size:11px;font-weight:800;color:#00E5FF;letter-spacing:1px;margin-bottom:8px">CALIBRATION & SLICER SPECS</div>
          <div class="grid2" style="gap:10px;font-size:12px">
            <div><span style="color:#64748b">Bed Mesh:</span> <b style="color:${meshUsed.includes('None') ? '#94a3b8' : '#34d399'}">${meshUsed}</b></div>
            <div><span style="color:#64748b">Slicer:</span> <b style="color:#cbd5e1">${slicer}</b></div>
            <div><span style="color:#64748b">Layer Count:</span> <b style="color:#cbd5e1">${layerCount}</b></div>
            <div><span style="color:#64748b">Layer Height:</span> <b style="color:#cbd5e1">${layerH}</b></div>
            <div><span style="color:#64748b">Object Height:</span> <b style="color:#cbd5e1">${objH}</b></div>
            <div><span style="color:#64748b">File Exists:</span> <b style="color:${job.exists ? '#10B981' : '#f87171'}">${job.exists ? 'Yes' : 'Deleted / Missing'}</b></div>
          </div>
        </div>

        <div class="row" style="justify-content:space-between;align-items:center;gap:10px">
          <button class="btn" id="jd-cancel" style="min-width:90px">Close</button>
          <button class="btn pri" id="jd-print-again" style="flex:1;background:linear-gradient(135deg,#00B4D8,#0077B6);font-weight:800;color:#fff;border:none;display:flex;align-items:center;justify-content:center;gap:8px">
            <span style="font-size:15px">🖨</span> Print Again
          </button>
        </div>
      </div>
    `);

    const close = modal(n);
    $('#jd-close', n).onclick = close;
    $('#jd-cancel', n).onclick = close;

    $('#jd-print-again', n).onclick = async () => {
      close();
      confirmBox('Print Again', `Are you sure you want to start printing "${cleanName}" again?`, 'Print Now', async () => {
        try {
          toast(`Starting print: ${cleanName}...`);
          await MR.startPrint(job.filename);
          App.go('printing');
        } catch(e){
          toast('Failed to start print: ' + (e.message || e));
        }
      });
    };
  }

  function confirmClearAll(){
    confirmBox('Clear Print History', 'Are you sure you want to delete all print history records? This action cannot be undone.', 'Clear All', async () => {
      try {
        await MR.clearHistory();
        toast('Print history cleared');
        loadHistory();
      } catch(e){
        toast('Failed to clear history');
      }
    }, true);
  }

  function render(){
    if(!root) return;

    const completedCount = jobs.filter(isSuccessful).length;
    const failedCount = jobs.filter(isFailed).length;
    const totalCount = jobs.length;

    let filtered = jobs;
    if(filter === 'completed') filtered = jobs.filter(isSuccessful);
    else if(filter === 'failed') filtered = jobs.filter(isFailed);

    root.innerHTML = `
      <div style="padding:16px 20px;max-width:1100px;margin:0 auto">
        <!-- Top Toolbar -->
        <div class="row" style="align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
          <div class="row" style="align-items:center;gap:12px">
            <button class="btn sm" id="h-back-files" style="font-weight:800">‹ Back to Files</button>
            <div style="font-size:18px;font-weight:900;letter-spacing:1px;color:#f8fafc">PRINT HISTORY</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <span style="background:rgba(0,229,255,0.12);color:#00E5FF;border:1px solid rgba(0,229,255,0.3);font-size:11px;font-weight:800;padding:3px 10px;border-radius:12px">TOTAL: ${totalCount}</span>
              <span style="background:rgba(16,185,129,0.15);color:#34D399;border:1px solid rgba(16,185,129,0.35);font-size:11px;font-weight:800;padding:3px 10px;border-radius:12px">✔ SUCCESS: ${completedCount}</span>
              <span style="background:rgba(239,68,68,0.15);color:#F87171;border:1px solid rgba(239,68,68,0.35);font-size:11px;font-weight:800;padding:3px 10px;border-radius:12px">✖ FAILED: ${failedCount}</span>
            </div>
          </div>

          <div class="row" style="align-items:center;gap:10px">
            <button class="btn" id="h-refresh" style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700">
              ${ICON('reload', 14)} Refresh
            </button>
            <button class="btn danger" id="h-clear-all" style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800;background:rgba(239,68,68,0.18);border:1px solid rgba(239,68,68,0.45);color:#FCA5A5">
              ${ICON('trash', 14)} Clear All
            </button>
          </div>
        </div>

        <!-- Filter tabs -->
        <div class="row" style="gap:8px;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:12px">
          <button class="btn ${filter === 'all' ? 'on' : ''}" data-flt="all" style="font-weight:800;font-size:12px;min-width:80px">
            All (${totalCount})
          </button>
          <button class="btn ${filter === 'completed' ? 'on' : ''}" data-flt="completed" style="font-weight:800;font-size:12px;min-width:110px;color:${filter === 'completed' ? '#000' : '#34D399'}">
            ✔ Successful (${completedCount})
          </button>
          <button class="btn ${filter === 'failed' ? 'on' : ''}" data-flt="failed" style="font-weight:800;font-size:12px;min-width:90px;color:${filter === 'failed' ? '#000' : '#F87171'}">
            ✖ Failed (${failedCount})
          </button>
        </div>

        <!-- Jobs List -->
        <div id="h-list" style="display:flex;flex-direction:column;gap:10px">
          ${loading ? '<div style="text-align:center;padding:40px;color:#94a3b8;font-weight:700">Loading print history...</div>' : ''}
          ${(!loading && errorMsg) ? `
            <div style="text-align:center;padding:36px 20px;background:rgba(239,68,68,0.1);border-radius:12px;border:1px solid rgba(239,68,68,0.35)">
              <div style="font-size:16px;font-weight:800;color:#FCA5A5">Failed to load print history</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:4px">${errorMsg}</div>
              <button class="btn sm pri" id="h-retry" style="margin-top:12px">⟳ Retry</button>
            </div>
          ` : ''}
          ${(!loading && !errorMsg && filtered.length === 0) ? `
            <div style="text-align:center;padding:60px 20px;background:#0d1527;border-radius:12px;border:1px dashed rgba(255,255,255,0.1)">
              <div style="font-size:36px;margin-bottom:10px">📜</div>
              <div style="font-size:16px;font-weight:800;color:#f8fafc">No print history found</div>
              <div style="font-size:12px;color:#64748b;margin-top:4px">Completed and cancelled print jobs will show up here.</div>
            </div>
          ` : ''}
          ${filtered.map(job => {
            const success = isSuccessful(job);
            const statusCol = success ? '#10B981' : '#EF4444';
            const statusBg = success ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.16)';
            const statusBorder = success ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.4)';
            const statusLabel = success ? 'SUCCESS' : (job.status ? job.status.toUpperCase() : 'FAILED');
            const cleanName = (job.filename || 'Unknown').split('/').pop();
            const dateStr = fmtDate(job.start_time);
            const durStr = fmtTime(job.total_duration || job.print_duration);
            const filStr = fmtFilament(job.filament_used);
            const meshStr = detectBedMesh(job);

            return `
              <div class="h-card" data-jid="${job.job_id}" style="display:flex;align-items:center;gap:14px;background:#0f172a;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 16px;cursor:pointer;transition:all 0.15s;user-select:none">
                <!-- Status icon pill -->
                <div style="width:38px;height:38px;border-radius:8px;background:${statusBg};border:1.5px solid ${statusBorder};display:flex;align-items:center;justify-content:center;color:${statusCol};font-weight:900;font-size:16px;flex-shrink:0">
                  ${success ? '✔' : '✖'}
                </div>

                <!-- Info middle -->
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
                    <span style="font-size:10px;font-weight:800;letter-spacing:0.8px;padding:2px 6px;border-radius:4px;background:${statusBg};color:${statusCol};border:1px solid ${statusBorder}">${statusLabel}</span>
                    <span style="font-size:11px;color:#94a3b8;font-weight:600">${dateStr}</span>
                    <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.12);color:#38bdf8;border:1px solid rgba(56,189,248,0.3)">Mesh: ${meshStr}</span>
                  </div>
                  <div style="font-size:14px;font-weight:800;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cleanName}</div>
                  <div style="display:flex;align-items:center;gap:14px;font-size:11px;color:#64748b;margin-top:4px;flex-wrap:wrap">
                    <span>⏱ <b style="color:#cbd5e1">${durStr}</b></span>
                    <span>🧵 <b style="color:#38bdf8">${filStr}</b></span>
                    <span style="color:#64748b">Path: ${job.filename}</span>
                  </div>
                </div>

                <!-- Right Action -->
                <div class="row" style="align-items:center;gap:8px;flex-shrink:0">
                  <button class="btn sm pri h-reprint-btn" data-jid="${job.job_id}" style="font-size:11px;font-weight:800;background:rgba(0,229,255,0.14);border:1px solid rgba(0,229,255,0.4);color:#00E5FF;padding:6px 10px;display:flex;align-items:center;gap:4px">
                    🖨 Print Again
                  </button>
                  <span style="font-size:18px;color:#64748b;margin-left:4px">›</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Bind card hover effect
    root.querySelectorAll('.h-card').forEach(c => {
      c.onmouseenter = () => { c.style.borderColor = '#00E5FF'; c.style.background = '#15213b'; };
      c.onmouseleave = () => { c.style.borderColor = 'rgba(255,255,255,0.08)'; c.style.background = '#0f172a'; };
      c.onclick = (e) => {
        if(e.target.closest('.h-reprint-btn')) return; // handled separately
        const jid = c.dataset.jid;
        const job = jobs.find(j => j.job_id === jid);
        if(job) openJobDetails(job);
      };
    });

    // Bind reprint quick buttons
    root.querySelectorAll('.h-reprint-btn').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const jid = b.dataset.jid;
        const job = jobs.find(j => j.job_id === jid);
        if(!job) return;
        const cleanName = (job.filename || 'Unknown').split('/').pop();
        confirmBox('Print Again', `Are you sure you want to start printing "${cleanName}" again?`, 'Print Now', async () => {
          try {
            toast(`Starting print: ${cleanName}...`);
            await MR.startPrint(job.filename);
            App.go('printing');
          } catch(err){
            toast('Failed to start print: ' + (err.message || err));
          }
        });
      };
    });

    // Bind filter buttons
    root.querySelectorAll('[data-flt]').forEach(b => {
      b.onclick = () => {
        filter = b.dataset.flt;
        render();
      };
    });

    // Bind back, retry, refresh & clear all
    const backBtn = $('#h-back-files', root);
    if(backBtn) backBtn.onclick = () => (App.go ? App.go('files') : go('files'));

    const retryBtn = $('#h-retry', root);
    if(retryBtn) retryBtn.onclick = () => loadHistory();

    const refBtn = $('#h-refresh', root);
    if(refBtn) refBtn.onclick = () => loadHistory();

    const clrBtn = $('#h-clear-all', root);
    if(clrBtn) clrBtn.onclick = () => confirmClearAll();
  }

  App.pages.history = {
    show(){
      loadHistory();
    }
  };
})();

