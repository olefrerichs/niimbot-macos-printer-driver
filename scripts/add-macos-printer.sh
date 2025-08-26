#!/usr/bin/env bash
set -Eeuo pipefail

PRINTER_NAME="${1:-Niimbot_BLE}"
IPP_HOST="${IPP_HOST:-localhost}"
IPP_PORT="${IPP_PORT:-8631}"
IPP_URL="ipp://${IPP_HOST}:${IPP_PORT}/ipp/print"

echo "Adding printer '${PRINTER_NAME}' at ${IPP_URL} (driverless 'everywhere') ..."
lpadmin -x "${PRINTER_NAME}" 2>/dev/null || true
lpadmin -p "${PRINTER_NAME}" -E -v "${IPP_URL}" -m everywhere

# Optional: share printers locally (harmless if already set)
cupsctl --share-printers || true

echo
echo "Capabilities:"
lpoptions -p "${PRINTER_NAME}" -l | sed -n '1,200p'
echo
echo "Done. You can now print to '${PRINTER_NAME}'."
