# NiiMBOT macOS Printer Driver (AirPrint/IPP, Bluetooth)

Use your **NiiMBOT label printer** (D100_M, D110, D11, etc.) as a **normal printer on macOS** (Sonoma / Sequoia).  
This project exposes a local **AirPrint / IPP Everywhere** queue so every app’s **Print** dialog works.  
Jobs are rasterised and sent over **Bluetooth (BLE)** using [`@mmote/niimblue-node`](https://github.com/MultiMote/niimblue-node), with **label size & density presets**.

> **Tested device:** NiiMBOT **D100_M** only (by the maintainer).  
> It *should* work with any printer models supported by [`niimblue-node`](https://github.com/MultiMote/niimblue-node).  
> Model-specific tweaks may be needed. Contributions and test reports are welcome!


## Features

- Works with macOS **Sonoma 14** / **Sequoia 15**
- **AirPrint / IPP Everywhere** queue (no vendor driver)
- **Bluetooth (BLE)** bridge via `niimblue-node`
- Real **Paper/Label sizes** in the Print dialog (presets supported)
- **Density / darkness** control (mapped from Print dialog)
- **Debug mode** (keeps logs and rendered rasters in `.spool`)


## Requirements

- macOS 13+ (Sonoma) or 15 (Sequoia)
- Node.js 18+ (`brew install node`)
- Xcode Command Line Tools (`xcode-select --install`)
- ImageMagick (`brew install imagemagick`)
- `ippeveprinter` (included in CUPS; install via `brew install ipp-tools` if missing)
- **Bluetooth permission** for your terminal app  
  (System Settings → Privacy & Security → Bluetooth)


## Configure

Put your printer’s BLE name into `config/bridge.config.json`:

```jsonc
{
  "NIIMBLUE_NAME": "D110_M-XXXXYYYY", // required
  "RENDER": "text",           // "text" or "photo"
  "THRESHOLD": "60%",         // used for RENDER="text"
  "DIRECTION": "",            // "", or "top"|"left"|"right"|"bottom"
  "ROTATE_FOR_LEFT": "0",     // "1" to rotate +90° when direction=left
  "LABEL_TYPE": 1,            // printer's label type (usually leave at 1)
  "QUANTITY": 1,              // number of labels per job
  "DEBUG": "0"                // "1" = keep logs & .spool PNGs, "0" = quiet
}
```
You can override any setting at runtime with env vars:
e.g. NIIMBOT_RENDER=photo ./scripts/start-printer.sh


## Quick start

```bash
# 1) Clone & install
git clone https://github.com/YOUR-USER/niimbot-macos-printer-driver.git
cd niimbot-macos-printer-driver
npm install

# 2) Discover your printer's BLE name
npm run scan:ble
# Example: D100-AB12CD34 or D110-ABCDEF1234

# 3) Put the name into config/bridge.config.json

# 4) Start the printer
chmod +x scripts/*.sh src/bridge.mjs
./scripts/start-printer.sh

# 5) Add the printer in macOS
./scripts/add-macos-printer.sh
# (or add ipp://localhost:8631/ipp/print manually in System Settings)
```

---

## Quick reference

### Print dialog tips

- **Paper Size** → pick your label (e.g. **12×40 mm**)
- **Quality/Density** → try *Normal* first, increase darkness if needed
- Save **Presets**: *Presets ▸ Save Current Settings as Preset…* (e.g., “12×40 High Density”)

### Render quality presets

Two rasterisation modes:

- **Text** (default): sharp edges, thresholded, good for codes/logos
- **Photo**: Floyd–Steinberg dithering, better for gradients/photos

Switch at launch:

```bash
NIIMBOT_RENDER=text   ./scripts/start-printer.sh   # crisp logos/text
NIIMBOT_RENDER=photo  ./scripts/start-printer.sh   # dithering for photos
NIIMBOT_THRESHOLD=62% ./scripts/start-printer.sh   # fine-tune threshold
```

### Debug mode
Enable Debug to keep logs and rendered job images:
NIIMBOT_DEBUG=1 ./scripts/start-printer.sh
```bash
# Logs:   .spool/ippeve.log
# Images: .spool/job-*.png
```
When Debug=0 (default), .spool is emptied on start and logs are suppressed.

### Launch at login (LaunchAgent)
Install the LaunchAgent:
```bash
./scripts/install-launch-agent.sh
launchctl kickstart -k gui/$(id -u)/local.niimbot.ipp
```
- The LaunchAgent runs scripts/start-printer.sh at login.
- Printer name & defaults are read from config/bridge.config.json.
- To enable persistent debug mode, edit the plist and add:
```xml
<key>EnvironmentVariables</key>
<dict>
<key>NIIMBOT_DEBUG</key><string>1</string>
</dict>
```
### Troubleshooting

- **Queue says “In Use” then “Idle” but nothing prints**  
  Enable debug (`NIIMBOT_DEBUG=1`), print a simple PDF, check `.spool/ippeve.log`.  
  Open `.spool/job-*.png` — this is exactly what gets sent to the printer.

- **Print direction rotated**  
  Set `"DIRECTION": "top"` in `config/bridge.config.json` (or `NIIMBOT_DIRECTION=top`).

- **Too light/dark**  
  Adjust Print dialog **Quality/Density** or tweak `"THRESHOLD"` in config.

- **PDFs don’t print**  
  Ensure ImageMagick is installed (`brew install imagemagick`).

###  Supported printers & media

- **Models:** Any supported by `niimblue-node`.  
  Confirmed: **D100_M**. Expected: **D110**, **D11**.

- **Roll sizes (preconfigured):**  
  12×22, 12×30, 12×40, 12×75, 12×109 mm  
  14×30, 14×40 mm  
  15×30, 15×50 mm

  (See `config/niimbot.ppd` for details.)


### Roadmap
- Auto-detect model variants (e.g. D110_M) and tune protocol/init
- Optional pure-Node IPP server (no ippeveprinter dependency)
- Homebrew formula for one-command install