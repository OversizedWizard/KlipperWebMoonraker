#!/usr/bin/env bash
# ============================================================================
# Klipper Touch Web UI - Automated Raspberry Pi Installer
# ============================================================================

set -e

C_RESET="\033[0m"
C_CYAN="\033[1;36m"
C_GREEN="\033[1;32m"
C_AMBER="\033[1;33m"
C_RED="\033[1;31m"
C_GRAY="\033[0;90m"

echo -e "${C_CYAN}"
echo "=========================================================="
echo "            KLIPPER WEB UI - PI INSTALLER                 "
echo "=========================================================="
echo -e "${C_RESET}"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
DEST_DIR="/var/www/klipper-screen-web"
BACKUP_DIR="/etc/nginx/klipper-web-backup"

# Ignore fileMode changes so future 'git pull' updates never conflict
if command -v git >/dev/null 2>&1 && [ -d "$SRC_DIR/.git" ]; then
    git -C "$SRC_DIR" config core.fileMode false || true
fi

if ! sudo -v; then
    echo -e "${C_RED}[ERROR] Sudo privileges are required to configure Nginx and install web files.${C_RESET}"
    exit 1
fi

echo -e "${C_GREEN}[1/4] Checking system dependencies (nginx)...${C_RESET}"
if ! command -v nginx >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y nginx
fi

# Detect any existing web interface installations on the Pi
EXISTING_SITES=""
for site in /etc/nginx/sites-enabled/*; do
    [ -e "$site" ] || continue
    bname="$(basename "$site")"
    EXISTING_SITES="${EXISTING_SITES} ${bname}"
done

OLD_WEB_FOUND=0
if [ -d "$DEST_DIR" ] || [ -d "/home/pi/klipper-web-ui" ] || [ -f "/etc/nginx/sites-enabled/klipper-screen-web" ] || [ -f "/etc/nginx/sites-enabled/klipper-web-ui" ]; then
    OLD_WEB_FOUND=1
fi

echo -e "\n${C_GREEN}[2/4] Checking for existing web interfaces on this Raspberry Pi...${C_RESET}"
echo -e "${C_AMBER}----------------------------------------------------------${C_RESET}"
if [ "$OLD_WEB_FOUND" -eq 1 ]; then
    echo -e "${C_AMBER}[!] Detected an existing Klipper Web UI installation on this Pi.${C_RESET}"
fi
if [ -n "$EXISTING_SITES" ]; then
    echo -e "    ${C_CYAN}• Active Nginx site(s):${EXISTING_SITES}${C_RESET}"
fi
echo -e "${C_AMBER}----------------------------------------------------------${C_RESET}"

read -r -p "Would you like to replace the existing web interface with the new one? (y/n) [default: y]: " REPLACE_OLD
REPLACE_OLD=${REPLACE_OLD:-y}

echo -e "\n${C_GREEN}[3/4] Installing web interface files to ${DEST_DIR}...${C_RESET}"
if [ -d "$DEST_DIR" ]; then
    sudo rm -rf "$DEST_DIR"
fi
sudo mkdir -p "$DEST_DIR"
sudo cp -r "$SRC_DIR/index.html" "$SRC_DIR/css" "$SRC_DIR/js" "$DEST_DIR/"
sudo chmod -R a+rX "$DEST_DIR"

# Keep /home/pi/klipper-web-ui synced if it was used previously
if [ -d "/home/pi/klipper-web-ui" ] || [ -L "/home/pi/klipper-web-ui" ]; then
    sudo rm -rf "/home/pi/klipper-web-ui"
    sudo ln -s "$DEST_DIR" "/home/pi/klipper-web-ui" || true
fi

# Check if MainsailOS / FluiddOS upstream definitions already exist in /etc/nginx/conf.d/
NEED_UPSTREAM=1
if grep -rq "upstream apiserver" /etc/nginx/conf.d/ 2>/dev/null; then
    NEED_UPSTREAM=0
fi

UPSTREAM_BLOCK=""
if [ "$NEED_UPSTREAM" -eq 1 ]; then
    UPSTREAM_BLOCK='map $http_upgrade $connection_upgrade {
    default upgrade;
    "" close;
}
upstream apiserver {
    ip_hash;
    server 127.0.0.1:7125;
}'
fi

WEBCAM_BLOCK=""
if grep -rq "upstream mjpgstreamer1" /etc/nginx/conf.d/ 2>/dev/null; then
    WEBCAM_BLOCK='
    location /webcam/ {
        postpone_output 0;
        proxy_buffering off;
        proxy_ignore_headers X-Accel-Buffering;
        access_log off;
        error_log off;
        proxy_pass http://mjpgstreamer1/;
    }'
fi

echo -e "\n${C_GREEN}[4/4] Configuring Nginx web server...${C_RESET}"

if [[ "$REPLACE_OLD" =~ ^[Yy]$ ]]; then
    LISTEN_PORT=80
    echo -e "${C_CYAN}Replacing existing web interface on Port 80...${C_RESET}"
    sudo mkdir -p "$BACKUP_DIR"
    for f in /etc/nginx/sites-enabled/*; do
        [ -e "$f" ] || continue
        bname="$(basename "$f")"
        if [ "$bname" != "klipper-screen-web" ] && [ "$bname" != "klipper-web-ui" ]; then
            sudo cp -P "$f" "$BACKUP_DIR/" 2>/dev/null || true
        fi
        sudo rm -f "$f"
    done
    echo -e "${C_GRAY}Backed up previous Nginx site configs to ${BACKUP_DIR}${C_RESET}"
else
    echo -e "${C_CYAN}Keeping existing Port 80 web interface and installing on a secondary port...${C_RESET}"
    read -r -p "Enter port for the Klipper Web UI [default: 8090]: " CUSTOM_PORT
    LISTEN_PORT=${CUSTOM_PORT:-8090}
    sudo rm -f /etc/nginx/sites-enabled/klipper-web-ui /etc/nginx/sites-enabled/klipper-screen-web 2>/dev/null || true
fi

cat <<EOF | sudo tee /etc/nginx/sites-available/klipper-screen-web >/dev/null
$UPSTREAM_BLOCK
server {
    listen ${LISTEN_PORT};
    server_name _;

    root ${DEST_DIR};
    index index.html;

    client_max_body_size 0;
    proxy_request_buffering off;

    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    location /websocket {
        proxy_pass http://apiserver/websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    location ~ ^/(printer|api|access|machine|server)/ {
        proxy_pass http://apiserver\$request_uri;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Scheme \$scheme;
    }
$WEBCAM_BLOCK
}
EOF

sudo ln -sf /etc/nginx/sites-available/klipper-screen-web /etc/nginx/sites-enabled/klipper-screen-web
sudo nginx -t
sudo systemctl reload nginx || sudo systemctl restart nginx

PI_IP="$(hostname -I | awk '{print $1}')"

echo -e "\n${C_CYAN}==========================================================${C_RESET}"
echo -e "${C_GREEN}       KLIPPER WEB UI INSTALLED SUCCESSFULLY!             ${C_RESET}"
echo -e "${C_CYAN}==========================================================${C_RESET}"
if [ "$LISTEN_PORT" = "80" ]; then
    echo -e "• Open on Phone or PC: ${C_GREEN}http://${PI_IP}/${C_RESET}"
    echo -e "• Previous interface backed up in: ${C_GRAY}${BACKUP_DIR}${C_RESET}"
else
    echo -e "• Open on Phone or PC: ${C_GREEN}http://${PI_IP}:${LISTEN_PORT}/${C_RESET}"
    echo -e "• Original Port 80 interface kept at: ${C_GRAY}http://${PI_IP}/${C_RESET}"
fi
echo -e "• To uninstall or restore old web UI: ${C_AMBER}./uninstall.sh${C_RESET}"
echo -e "${C_CYAN}==========================================================${C_RESET}\n"
