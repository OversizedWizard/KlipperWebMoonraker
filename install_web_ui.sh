#!/usr/bin/env bash
# Installs the Klipper Screen web UI on a Raspberry Pi, replacing Mainsail/Fluidd on port 80.
# Usage:  sudo bash install_web_ui.sh
set -e
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST=/var/www/klipper-screen-web
echo "==> Installing files to $DEST"
mkdir -p "$DEST"
cp -r "$SRC/index.html" "$SRC/css" "$SRC/js" "$DEST/"
chmod -R a+rX "$DEST"

command -v nginx >/dev/null || { apt-get update && apt-get install -y nginx; }

echo "==> Backing up existing nginx site configs"
BK=/etc/nginx/klipper-screen-backup-$(date +%s)
mkdir -p "$BK"
for f in /etc/nginx/sites-enabled/*; do [ -e "$f" ] && { cp -P "$f" "$BK/"; rm -f "$f"; }; done
echo "    backup: $BK"

cat > /etc/nginx/sites-available/klipper-screen-web <<'EOF'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
upstream apiserver { ip_hash; server 127.0.0.1:7125; }
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root /var/www/klipper-screen-web;
    index index.html;
    client_max_body_size 1024M;
    location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-cache"; }
    location = /index.html { add_header Cache-Control "no-store, no-cache, must-revalidate"; }
    location /websocket {
        proxy_pass http://apiserver/websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $http_host;
        proxy_read_timeout 86400;
    }
    location ~ ^/(printer|api|access|machine|server)/ {
        proxy_pass http://apiserver$request_uri;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 600;
        proxy_request_buffering off;
        proxy_buffering off;
    }
}
EOF
ln -sf /etc/nginx/sites-available/klipper-screen-web /etc/nginx/sites-enabled/klipper-screen-web
nginx -t
systemctl restart nginx
echo "==> Done. Open http://$(hostname -I | awk '{print $1}')/"
echo "==> Make sure /home/*/printer_data/config/moonraker.conf [authorization] trusts your network"
echo "    (cors_domains / trusted_clients) and restart moonraker if the page shows Offline."
echo "==> To restore Mainsail/Fluidd: copy files from $BK back to /etc/nginx/sites-enabled and restart nginx."

