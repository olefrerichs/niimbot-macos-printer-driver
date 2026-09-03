# Changelog

## v0.3.1 — 2026-09-03

### Hardening
- **Install root is resolved from the script's own location** (`import.meta.url`) instead of `process.cwd()`. `scripts/start-printer.sh` never changes into the repository, so ippeveprinter — and with it the bridge — inherited the working directory of whatever started it; only the LaunchAgent's `WorkingDirectory` made that the install root. Started from anywhere else the bridge could not find `config/bridge.config.json` and aborted with "Set your printer name". Debug rasters follow the same root.
- **Job files are confined to the spool directory.** `start-printer.sh` exports `NIIMBOT_SPOOL`, the directory it hands to `ippeveprinter -d`. When that variable is set the bridge accepts only job files inside it, resolved through symlinks, so a stray argument cannot make it read unrelated files. Run by hand the variable is unset and any readable file is accepted, keeping `niimblue-print file.pdf` usable.
- **Distinct job file errors.** Missing file, not a regular file, and outside the spool directory are reported separately instead of all appearing as "No job file path provided".

### Upgrading
```bash
git pull
launchctl kickstart -k gui/$(id -u)/local.niimbot.ipp
```
No configuration, PPD or queue changes; the plist is untouched, so `bootout`/`bootstrap` is not needed.

## v0.3.0 — 2026-09-02

### Printing
- **Multi-page documents.** Every PDF page becomes one label, printed as a single print task. Previously all pages were flattened onto one label.
- **Copies from the Print dialog** are honoured (collated or uncollated), multiplied by the optional `QUANTITY` setting.
- **Density** is mapped into the printer model's supported range (`densityMin`/`Max`/`Default` from niimbluelib) instead of a fixed 1–5.
- **Print speed mode** on D110M_V4-class printers: *High* quality selects the slower high-quality mode (speed 0). `SPEED` and `COLOR` config overrides.
- **Label type** is read from the roll's RFID tag, then the printer, unless `LABEL_TYPE` is set.
- **Pre-flight check** via printer heartbeat: cover open, no labels or no ribbon abort the job before printing.
- Configurable timeouts: `PAGE_TIMEOUT_MS`, `STATUS_TIMEOUT_MS`, `STATUS_POLL_MS`.

### macOS integration
- **Printer status in the queue.** Printer error codes map to printer-state-reasons, so the macOS queue shows cover open, out of labels, battery low, feed error, wrong label type.
- **Supply levels in the printer name.** After every job the printer name reads e.g. `Niimbot D110_M [Labels 81% · Battery 75%]` (`STATUS_IN_NAME=0` disables). Battery and remaining labels are also reported as CUPS marker attributes; macOS's own Supply Levels panel ignores those for local IPP queues.
- **Short printer name.** `add-macos-printer.sh` names the queue `Niimbot <model>` (`DISPLAY_NAME` override).
- **Quality default High.** CUPS hardcodes *Normal* in generated PPDs; the add script now sets High on the queue.
- **Clean paper size names.** The PPD uses exact millimetre dimensions and a 0.1 mm margin, so the dialog lists `12x40mm` instead of `11.99x39.86mm.Borderless`, and the default size matches a real choice.
- Per-page `job-impressions-completed` progress reporting.

### Tooling and docs
- `npm run info` shows model, firmware, battery and the detected print task.
- Clearer ImageMagick error reporting (missing `convert`, missing Ghostscript).
- README: requirements corrected (Node 20.9+, `ippeveprinter` ships with macOS), debug under the LaunchAgent via `plutil` plus unload/reload, update instructions, supported models reference niimbluelib, Bluetooth permission wording.
- `package.json`: engines `node >= 20.9`, model typo fixed.

### Upgrading
```bash
git pull
npm install
launchctl bootout gui/$(id -u)/local.niimbot.ipp; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.niimbot.ipp.plist
./scripts/add-macos-printer.sh   # PPD changed: re-create the queue for the new size names, quality default and short name
```
Existing `config/bridge.config.json` files keep working; `LABEL_TYPE: 1` now acts as an explicit override, set it to `""` to use the roll's tag.

## v0.2.0 — 2026-09-02

- `@mmote/niimblue-node` 0.0.8 → 1.2.0 (BLE via `@stoprocent/noble`; 13 npm audit findings → 0), `sharp` 0.34 → 0.35.
- `@mmote/niimbluelib` pinned to `0.0.1-alpha.43-node`; alpha.44 changed the image-source interface and breaks niimblue-node 1.2.0.
- Bridge ported to the `printImages()` API; ImageMagick failures reported with a reason.
- Ghostscript documented as a requirement; Quick start step 0 checks the tools; update instructions added.

## v0.1.0 — 2025-08-27

- First release: AirPrint/IPP Everywhere queue via `ippeveprinter`, BLE bridge via `niimblue-node`, label sizes and density from the Print dialog, LaunchAgent, debug mode.
