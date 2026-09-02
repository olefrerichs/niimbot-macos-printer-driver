#!/usr/bin/env bash
set -Eeuo pipefail

PRINTER_NAME="${1:-Niimbot_BLE}"
IPP_HOST="${IPP_HOST:-localhost}"
IPP_PORT="${IPP_PORT:-8631}"
IPP_URL="ipp://${IPP_HOST}:${IPP_PORT}/ipp/print"

# Display name shown by macOS: "Niimbot <model>" derived from the BLE name in the config
# (D110_M-H516111371 -> Niimbot D110_M). Override with NIIMBOT_DISPLAY_NAME or DISPLAY_NAME in the config.
ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")"/.. && pwd)"
CFG="${ROOT_DIR}/config/bridge.config.json"
cfg() { node -e 'try{const f=require(process.argv[1]);process.stdout.write(String(f[process.argv[2]]||""))}catch(e){}' "$CFG" "$1" 2>/dev/null || true; }
DISPLAY_NAME="${NIIMBOT_DISPLAY_NAME:-$(cfg DISPLAY_NAME)}"
if [[ -z "$DISPLAY_NAME" ]]; then
  BLE_NAME="${NIIMBLUE_NAME:-$(cfg NIIMBLUE_NAME)}"
  MODEL="${BLE_NAME%%-*}"
  DISPLAY_NAME="Niimbot ${MODEL:-Label Printer}"
fi

echo "Adding printer '${PRINTER_NAME}' at ${IPP_URL} (driverless 'everywhere') ..."
lpadmin -x "${PRINTER_NAME}" 2>/dev/null || true
lpadmin -p "${PRINTER_NAME}" -E -v "${IPP_URL}" -m everywhere

# CUPS hardcodes Normal as the quality default in generated PPDs; labels look best at High
lpadmin -p "${PRINTER_NAME}" -o cupsPrintQuality=High

# Short display name; the bridge appends "[Labels 81% · Battery 75%]" after every job
lpadmin -p "${PRINTER_NAME}" -D "${DISPLAY_NAME}"
echo "Display name: ${DISPLAY_NAME}"

# Optional: share printers locally (harmless if already set)
cupsctl --share-printers || true

echo
echo "Capabilities:"
lpoptions -p "${PRINTER_NAME}" -l | sed -n '1,200p'
echo
echo "Done. You can now print to '${PRINTER_NAME}'."
