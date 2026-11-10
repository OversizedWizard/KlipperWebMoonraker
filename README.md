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

---

## 📷 Camera Setup (CSI / OV5647 + Official 7" DSI Touchscreen)

If using a **CSI Camera (e.g. 5MP OV5647)** alongside the **Official Raspberry Pi 7" DSI Touchscreen Display**, both devices share the internal Unicam/DSI I2C bus (`i2c-10` on `i2c0mux`).

### 1. Boot Configuration (`/boot/firmware/config.txt`)
Under modern Raspberry Pi OS (Bullseye / Bookworm / Trixie) with KMS graphics, the touchscreen is managed natively by the kernel's `edt-ft5406` driver. Do **NOT** use legacy firmware touch overlays:

```ini
# Auto-detect camera sensor (OV5647) and DSI panel
camera_auto_detect=1
display_auto_detect=1

# Modern KMS Graphics Driver (Required for direct kernel touch + camera)
dtoverlay=vc4-kms-v3d
max_framebuffers=2

# ⚠️ CRITICAL: Ensure legacy firmware touch & floating GPIO lines are DISABLED:
# DO NOT include dtoverlay=rpi-ft5406 (forces GPU polling of 0x38 at 60Hz, locking the shared I2C bus and killing the camera)
# DO NOT include dtoverlay=w1-gpio unless an actual 1-wire sensor is wired to GPIO 4
```

### 2. Dedicated Camera Streamer Service (`klipper-cam.service`)
Create `/etc/systemd/system/klipper-cam.service`:

```ini
[Unit]
Description=OV5647 Camera Streamer
After=network.target

[Service]
User=pi
Type=simple
ExecStart=/usr/bin/camera-streamer \
  --camera-type=libcamera \
  --camera-format=YUYV \
  --camera-width=1296 \
  --camera-height=972 \
  --camera-fps=30 \
  --camera-nbufs=3 \
  --http-listen=0.0.0.0 \
  --http-port=8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now klipper-cam.service
```

### 3. Alternative: Crowsnest Configuration (`crowsnest.conf`)
If managing your stream with Crowsnest instead of a standalone systemd service, configure `/home/pi/printer_data/config/crowsnest.conf`:

```ini
[crowsnest]
log_level: verbose
rollover_on_start: false
no_proxy: true

[cam 1]
mode: camera-streamer
port: 8080
device: /base/soc/i2c0mux/i2c@1/ov5647@36
resolution: 1296x972
max_fps: 30
custom_flags: --camera-format=YUYV
```

### 4. Streaming Endpoints (Supported in Web UI)
* **Live MJPEG Stream**: `http://<pi-ip>:8080/?action=stream` or `http://<pi-ip>/webcam/?action=stream`
* **Direct High-Res Snapshot**: `http://<pi-ip>:8080/?action=snapshot` or `http://<pi-ip>/webcam/?action=snapshot`
* **Ultra-Low Latency WebRTC**: `http://<pi-ip>:8080/webrtc`


