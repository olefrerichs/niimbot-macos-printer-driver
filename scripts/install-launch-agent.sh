#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_TEMPLATE="$HERE/launchd/local.niimbot.ipp.plist"
PLIST_TARGET="$HOME/Library/LaunchAgents/local.niimbot.ipp.plist"

mkdir -p "$HOME/Library/LaunchAgents"

# Substitute repo path into plist template
sed "s|@@REPO_DIR@@|$HERE|g" "$PLIST_TEMPLATE" > "$PLIST_TARGET"

# (Re)load the LaunchAgent
launchctl unload "$PLIST_TARGET" 2>/dev/null || true
launchctl load "$PLIST_TARGET"

echo "Loaded LaunchAgent:"
echo "  $PLIST_TARGET"
echo
echo "The start script reads the printer name from:"
echo "  $HERE/config/bridge.config.json    (set NIIMBLUE_NAME there)"
echo
echo "To enable debug logging under launchd, you can edit the plist and add:"
echo "  <key>EnvironmentVariables</key>"
echo "  <dict><key>NIIMBOT_DEBUG</key><string>1</string></dict>"
echo
echo "Kickstart it now with:"
echo "  launchctl kickstart -k gui/$(id -u)/local.niimbot.ipp"
