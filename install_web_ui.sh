#!/usr/bin/env bash
# Wrapper that delegates to install.sh so both ./install.sh and sudo bash install_web_ui.sh
# safely detect existing Mainsail/Fluidd nginx upstreams without duplicate definition errors.
set -e
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
if [ -f "$SRC/install.sh" ]; then
    exec bash "$SRC/install.sh" "$@"
fi
echo "Error: install.sh not found in $SRC" >&2
exit 1
