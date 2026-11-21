#!/usr/bin/env bash
# ============================================================================
# Klipper Touch Web UI - Uninstaller & Previous Interface Restorer
# ============================================================================

set -e

C_RESET="\033[0m"
C_CYAN="\033[1;36m"
C_GREEN="\033[1;32m"
C_AMBER="\033[1;33m"

echo -e "${C_CYAN}==========================================================${C_RESET}"
echo -e "          KLIPPER WEB UI - UNINSTALLER                    "
echo -e "${C_CYAN}==========================================================${C_RESET}"

BACKUP_DIR="/etc/nginx/klipper-web-backup"

sudo rm -f /etc/nginx/sites-enabled/klipper-screen-web /etc/nginx/sites-enabled/klipper-web-ui
sudo rm -f /etc/nginx/sites-available/klipper-screen-web
sudo rm -rf /var/www/klipper-screen-web

if [ -d "$BACKUP_DIR" ] && [ -n "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
    read -r -p "Restore previous web interface (Mainsail/Fluidd) from backup? (y/n) [default: y]: " RESTORE_OLD
    RESTORE_OLD=${RESTORE_OLD:-y}
    if [[ "$RESTORE_OLD" =~ ^[Yy]$ ]]; then
        sudo cp -P "$BACKUP_DIR"/* /etc/nginx/sites-enabled/
        echo -e "${C_GREEN}✓ Restored previous Nginx site configuration.${C_RESET}"
    fi
fi

sudo nginx -t && (sudo systemctl reload nginx || sudo systemctl restart nginx)
echo -e "${C_GREEN}✓ Uninstalled Klipper Web UI and reloaded Nginx.${C_RESET}"

