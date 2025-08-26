#!/usr/bin/env bash
set -Eeuo pipefail

# --- Repo paths ---
ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")"/.. && pwd)"
SPOOL="${ROOT_DIR}/.spool"
PPD="${ROOT_DIR}/config/niimbot.ppd"
BACKEND="${ROOT_DIR}/src/bridge.mjs"
CFG="${ROOT_DIR}/config/bridge.config.json"
LOGFILE="$SPOOL/ippeve.log"

# --- Environment & defaults ---
PORT="${IPP_PORT:-8631}"

# DEBUG switch: NIIMBOT_DEBUG=1 (or DEBUG=1)
DEBUG="${NIIMBOT_DEBUG:-${DEBUG:-0}}"

# Ensure common bins are on PATH (Homebrew etc.)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

mkdir -p "$SPOOL"
chmod +x "$BACKEND" || true

# Clean spool if not debugging (keeps folder; removes old PNG/logs)
if [[ "$DEBUG" != "1" ]]; then
  find "$SPOOL" -mindepth 1 -maxdepth 1 -print0 2>/dev/null | xargs -0 rm -rf 2>/dev/null || true
fi

# --- Read printer name (env > config) ---
if [[ -z "${NIIMBLUE_NAME:-}" ]]; then
  if [[ -f "$CFG" ]]; then
    NIIMBLUE_NAME="$(node -e 'try{const f=require(process.argv[1]);process.stdout.write(String(f.NIIMBLUE_NAME||""))}catch(e){process.exit(0)}' "$CFG" || true)"
  fi
fi

if [[ -z "${NIIMBLUE_NAME:-}" ]]; then
  printf 'ERROR: Set NIIMBLUE_NAME env var or put {"NIIMBLUE_NAME":"D110_M-..."} in %s\n' "$CFG" >&2
  exit 2
fi
PRINTER_NAME="${NIIMBLUE_NAME}_BLE"

# --- Show effective bridge settings (from config/env) ---
SHOW() { printf '  %-18s %s\n' "$1" "$2"; }
RENDER="${NIIMBOT_RENDER:-${NIIMBLUE_RENDER:-${RENDER:-text}}}"
THRESH="${NIIMBOT_THRESHOLD:-${NIIMBLUE_THRESHOLD:-${THRESHOLD:-60%}}}"
DIR_OVR="${NIIMBOT_DIRECTION:-${NIIMBLUE_DIRECTION:-${DIRECTION:-auto}}}"
ROT_LEFT="${NIIMBOT_ROTATE_FOR_LEFT:-${NIIMBLUE_ROTATE_FOR_LEFT:-${ROTATE_FOR_LEFT:-0}}}"
LBL_TYPE="${NIIMBOT_LABEL_TYPE:-${NIIMBLUE_LABEL_TYPE:-${LABEL_TYPE:-1}}}"
QTY="${NIIMBOT_QUANTITY:-${NIIMBLUE_QUANTITY:-${QUANTITY:-1}}}"

echo "Starting ippeveprinter on port ${PORT} ..."
echo "Printer: ${PRINTER_NAME}"
echo "PPD:     ${PPD}"
echo "Backend: ${BACKEND}"
echo "Spool:   ${SPOOL}"
echo "Debug:   ${DEBUG}  (log: ${LOGFILE})"
echo "Bridge settings (env overrides > config):"
SHOW "NIIMBLUE_NAME"    "$NIIMBLUE_NAME"
SHOW "RENDER"           "$RENDER"
SHOW "THRESHOLD"        "$THRESH"
SHOW "DIRECTION"        "$DIR_OVR"
SHOW "ROTATE_FOR_LEFT"  "$ROT_LEFT"
SHOW "LABEL_TYPE"       "$LBL_TYPE"
SHOW "QUANTITY"         "$QTY"

# --- Run server (PPD-based) ---
if [[ "$DEBUG" == "1" ]]; then
  ippeveprinter \
    -p "${PORT}" \
    -v \
    -P "${PPD}" \
    -d "${SPOOL}" \
    -c "${BACKEND}" \
    "${PRINTER_NAME}" 2>&1 | tee "$LOGFILE"
else
  ippeveprinter \
    -p "${PORT}" \
    -v \
    -P "${PPD}" \
    -d "${SPOOL}" \
    -c "${BACKEND}" \
    "${PRINTER_NAME}" >/dev/null 2>&1
fi
