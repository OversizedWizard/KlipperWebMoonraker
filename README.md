# Klipper Screen – Web UI

HTML/CSS/JS recreation of the Klipper Screen app. No build step, no dependencies. Talks directly to Moonraker.

## Install on the Pi (replaces Mainsail/Fluidd on port 80)
```bash
scp -r html pi@<pi-ip>:~/
ssh pi@<pi-ip>
sudo bash ~/html/install_web_ui.sh
```
Existing nginx sites are backed up to `/etc/nginx/klipper-screen-backup-*`. Restore by copying them back to `sites-enabled` and restarting nginx.

If the page shows **Offline**, add your network to `moonraker.conf`:
```
[authorization]
trusted_clients:
    192.168.0.0/16
cors_domains:
    *://192.168.*
```

## Try it without installing
Open `index.html` via any static server (`python -m http.server`) and set the Moonraker host in **Settings → Moonraker Host** (e.g. `192.168.0.99:7125`).

## Pages & Key Features
- **Home**: Live nozzle & bed telemetry, coordinate readouts, load cell live force, and quick controls.
- **Files & Timelapses**: G-code & 3MF browser with fast thumbnail previews, pre-print health check (validates material & remaining spool weight before printing), drag-and-drop upload, and **🎬 Timelapses** player/downloader.
- **Printing**: Live progress, ETA, slicer time estimates, **🎯 Exclude Object** (interactive 2D build plate map to cancel individual failed parts mid-print), **📸 Camera Monitor** with full-screen view, frame snapshot download, and ↔ Horizontal / ↕ Vertical / ⟳ 180° rotation controls, and real-time babystepping.
- **Spool Manager**: Visual filament spool showcase with live remaining weight (grams & meters) progress tracking, `-50g` / `+50g` steppers, 1kg/750g/500g/250g quick presets, and automatic filament deduction during printing.
- **Calibrate**: Manual dual‑Z trim, bed screws, 3D bed mesh, Z‑offset live squish, probe accuracy, PID autotune, and nozzle load-cell weight gauge.
- **Printer.cfg & Configs**: Multi-file configuration browser (`printer.cfg`, `moonraker.conf`, `crowsnest.conf`, macros), syntax-highlighted editor, and **📦 One-Click Config Backup (.zip)**.
- **Logs**: Dedicated system log viewer (`klippy.log`, `moonraker.log`, `crowsnest.log`, etc.) with search, live auto-refresh, and one-click download/print.
- **Settings & Alerts**:
  - **Screen Sleep Timer**: User-configurable inactivity timeout (`Never`, `2 min`, `5 min`, `10 min`, `15 min`, `30 min`) that transitions to a low-power dark OLED sleep screen and wakes on any touch/interaction.
  - **🔔 Push & Audio Alerts**: Browser notifications and WebAudio alert chimes on print finish, pause, or printer error.
  - **Diagnostics & Health**: Live host CPU/RAM loads, MCU telemetry, motor buzz tests, and Config Health Check (detects and auto-fixes `LOAD_CELL_TARE` conflicts in `PRINT_START`).
- **Power**: Firmware restart, host reboot, system shutdown, and emergency stop.

