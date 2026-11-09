# 🌐 Klipper Touch Web UI

A fast, zero-dependency, mobile- and desktop-responsive Web Interface for **Klipper 3D Printers** and **Moonraker** — matching the **Klipper Touch Display** experience in any phone, tablet, or PC browser.

---

## ✨ Features

- **📱 Mobile & Desktop Responsive**:
  - Automatically adapts to smartphones (bottom navigation bar, full-width cards, touch-optimized controls) and desktop browsers (3-column rearrangeable & collapsible operator dashboard).
- **🧭 Interactive 3D Bed Mesh Visualizer**:
  - Touch / finger drag rotation (`3D Plate + Spots`, `3D Topography`, `2D Grid`), spot height inspection tooltips, and live probing progress.
- **🛏️ One-Tap Bed Levelling Mode Selector (Normal / KAMP / Off)**:
  - Switch between **Normal Full Bed Mesh**, **KAMP Adaptive Mesh** (with `SMART_PARK` and `LINE_PURGE`), or **No Levelling** directly from the Home screen — automatically updates `printer.cfg` (`PRINT_START`).
- **🧵 Visual Spool Showcase & Tap-to-Edit Settings**:
  - Custom-tinted filament spool showcase card; tap the Spool Card to open the material preset (`PLA`, `PETG`, `ABS`, `ASA`, `TPU`, `Nylon`, `PC`, etc.), 16-colour palette, and nozzle/bed temperature popup.
  - Procedural **Load / Unload Filament** workflow with live extruder velocity sync and filament runout sensor detection.
- **📂 Pro G-Code File Manager**:
  - Grid and List views with embedded slicer thumbnails, folder navigation, drag-and-drop multi-file upload, and print confirmation preview.
- **🎯 Full Visual Calibration Suite**:
  - **Z-Offset & Paper Friction Test**, **Manual Dual-Z Motor Trim**, **Bed Screws Guided Leveling**, **Input Shaper (`SHAPER_CALIBRATE`)**, **Probe Accuracy**, **Load Cell Calibration & Tare**, and **PID Autotune**.
- **📝 Built-in `printer.cfg` Code Editor**:
  - Syntax-highlighted Klipper config editor with section sidebar navigation, search, font-size zoom, and one-click **Save & Restart Klipper**.

---

## 📦 Installation on Raspberry Pi

SSH into your Raspberry Pi (e.g. `ssh pi@<your-pi-ip>`) and run:

```bash
cd ~
git clone https://github.com/OversizedWizard/KlipperDisplayWeb.git html-git
cd html-git
chmod +x install.sh uninstall.sh
./install.sh
```

*(Or if copying the `html-git` folder directly to your Pi via SCP:)*

```bash
scp -r html-git pi@<your-pi-ip>:~/
ssh pi@<your-pi-ip>
cd ~/html-git
chmod +x install.sh uninstall.sh
./install.sh
```

---

## 🛠️ Interactive Installer Options

When you run `./install.sh`, it checks your Raspberry Pi for any existing web interface (`Mainsail`, `Fluidd`, or an older `Klipper Web UI` installation) and asks:

```text
----------------------------------------------------------
[!] Detected an existing Klipper Web UI installation on this Pi.
    • Active Nginx site(s): mainsail
----------------------------------------------------------
Would you like to replace the existing web interface with the new one? (y/n) [default: y]:
```

### Option 1: Replace Existing Web Interface (`y` — Default)
- Backs up your previous Nginx site configuration to `/etc/nginx/klipper-web-backup/`.
- Replaces the old web files in `/var/www/klipper-screen-web` with the new version.
- Serves **Klipper Web UI** directly on **Port 80** (`http://<your-pi-ip>/`) while preserving all `/websocket`, `/printer`, `/api`, `/server`, and `/webcam/` reverse-proxy routes so **OrcaSlicer / PrusaSlicer / Cura uploads and webcam streams continue working seamlessly**.

### Option 2: Keep Existing Interface & Run Alongside on Port 8090 (`n`)
- Leaves your existing Port 80 interface (`Mainsail` / `Fluidd`) untouched at `http://<your-pi-ip>/`.
- Installs **Klipper Web UI** on **Port 8090** (or any custom port you choose):
  - Open at: `http://<your-pi-ip>:8090/`
  *(Note: Port `8090` is used by default to avoid conflicting with `camera-streamer` on port `8080`.)*

---

## 🔄 Updating to a Newer Version

To pull the latest updates and replace the installed files on your Raspberry Pi:

```bash
cd ~/html-git
git pull
./install.sh
```

---

## 🗑️ Uninstalling / Restoring Previous Web Interface

To remove **Klipper Web UI** and restore your backed-up `Mainsail` or `Fluidd` configuration:

```bash
cd ~/html-git
./uninstall.sh
```

---

## 🔐 Moonraker CORS / Authorization Note

If opening the web UI from a different port or a local PC shows **`● Offline`**, ensure `/home/pi/printer_data/config/moonraker.conf` trusts your local network under `[authorization]`:

```ini
[authorization]
trusted_clients:
    10.0.0.0/8
    127.0.0.0/8
    169.254.0.0/16
    172.16.0.0/12
    192.168.0.0/16
    FE80::/10
    ::1/128
cors_domains:
    *://*.lan
    *://*.local
    *://192.168.*
    *://10.*
```

Then restart Moonraker:

```bash
sudo systemctl restart moonraker
```

---

## 📄 License

Licensed under the MIT License. See [LICENSE](LICENSE) for details.
