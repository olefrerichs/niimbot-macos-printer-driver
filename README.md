# NiiMBOT macOS Printer Driver (AirPrint/IPP, Bluetooth)

Use your **NiiMBOT label printer** (D110_M, D110, D11, etc.) as a **normal printer on macOS** (Sonoma / Sequoia).  
This project exposes a local **AirPrint / IPP Everywhere** queue so every app’s **Print** dialog works.  
Jobs are rasterised and sent over **Bluetooth (BLE)** using [`@mmote/niimblue-node`](https://github.com/MultiMote/niimblue-node), with **label size & density presets**.

> **Tested device:** NiiMBOT **D110_M** only (by the maintainer).  
> It *should* work with any printer models supported by [`niimblue-node`](https://github.com/MultiMote/niimblue-node).  
> Model-specific tweaks may be needed. Contributions and test reports are welcome!


## Features

- Works with macOS **Sonoma 14** / **Sequoia 15** / **Tahoe 26**
- **AirPrint / IPP Everywhere** queue (no vendor driver)
- **Bluetooth (BLE)** bridge via `niimblue-node`
- Real **Paper/Label sizes** in the Print dialog (presets supported)
- **Multi-page documents**: every PDF page becomes one label, printed as a single job
- **Copies** from the Print dialog (collated or uncollated), times an optional per-job quantity
- **Density / darkness** and **print speed** mapped from the Print dialog's Quality setting, within the model's supported density range
- **Label type** taken from the roll's RFID tag or the printer (configurable override)
- **Printer status in the macOS queue**: cover open, out of labels, battery low, feed error, wrong label type
- **Supply levels in the printer name**: after every job the macOS printer name reads e.g. *Niimbot D110_M [Labels 81% · Battery 75%]* (macOS's own Supply Levels panel ignores CUPS supply data for local IPP queues)
- **Debug mode** (keeps logs and rendered rasters in `.spool`)


## Requirements

- macOS 14+ (Sonoma)
- Node.js 18+ (`brew install node`)
- Xcode Command Line Tools (`xcode-select --install`)
- ImageMagick (`brew install imagemagick`)
- Ghostscript (`brew install ghostscript`)
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
  "DIRECTION": "",            // "", or "top"|"left"
  "ROTATE_FOR_LEFT": "0",     // "1" to rotate +90° when direction=left
  "LABEL_TYPE": "",           // "" = from the roll's RFID tag / printer; 1 gaps, 2 black mark, 3 continuous, 5 transparent
  "QUANTITY": 1,              // labels per copy (multiplied with Copies from the Print dialog)
  "SPEED": "",                // "" = from Quality (High -> 0); 0 = slower/higher quality, 1 = normal. D110M_V4-class printers only
  "COLOR": "",                // multicolor paper temperature (B1 / D110M_V4 only); "" = library default
  "PAGE_TIMEOUT_MS": 10000,   // timeout for sending one page's image data
  "STATUS_TIMEOUT_MS": 8000,  // timeout per status poll while waiting for the printer
  "STATUS_POLL_MS": 500,      // status poll interval
  "STATUS_IN_NAME": "1",      // append "[Labels 81% · Battery 75%]" to the macOS printer name after each job
  "DISPLAY_NAME": "",         // macOS printer name set by add-macos-printer.sh; "" = "Niimbot <model>"
  "DEBUG": "0"                // "1" = keep logs & .spool PNGs, "0" = quiet
}
```
You can override any setting at runtime with env vars:
e.g. NIIMBOT_RENDER=photo ./scripts/start-printer.sh


## Quick start

```bash
# 0) Check the requirements above are met (all must print a path)
which node convert gs ippeveprinter

# 1) Clone & install
git clone https://github.com/olefrerichs/niimbot-macos-printer-driver.git
cd niimbot-macos-printer-driver
npm install

# 2) Discover your printer's BLE name
npm run scan:ble
# Example: D110-AB12CD34 or D110-ABCDEF1234

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
- **Quality** → *Draft* = lowest density, *Normal* = the model's default, *High* = highest density and, on D110M_V4-class printers, the slower high-quality print mode
- **Copies** → prints that many labels per page; multi-page documents are collated unless the dialog says otherwise
- **Pages** → each page of the document is one label; use *Pages: from/to* to print a subset
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

### Updating to a new version

```bash
cd niimbot-macos-printer-driver
git pull
npm install                      # picks up dependency changes
which gs || brew install ghostscript   # required since v0.2.0
launchctl kickstart -k gui/$(id -u)/local.niimbot.ipp   # restart if you use the LaunchAgent
./scripts/add-macos-printer.sh   # re-create the macOS queue when the release notes say the PPD changed
```
If you started the printer manually instead, stop it and run `./scripts/start-printer.sh` again.  
Re-creating the queue regenerates the macOS-side PPD (paper size names, quality default); your saved presets in the Print dialog keep working.  
`git pull` keeps your edits to `config/bridge.config.json` unless the release changed that file too; if it complains, run `git stash && git pull && git stash pop`.

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
  Adjust Print dialog **Quality** or tweak `"THRESHOLD"` in config.

- **Queue shows “Cover open”, “Out of labels”, “Low supply”, ...**  
  The printer reported the condition before or during the job. Fix it and print again; the status clears with the next job.

- **Supply levels**  
  Remaining labels (from the roll's RFID tag) and battery charge are appended to the printer name after every job (disable with `"STATUS_IN_NAME": "0"`) and reported to CUPS:  
  `ipptool -tv ipp://localhost:631/printers/Niimbot_BLE get-printer-attributes.test | grep marker-`.  
  macOS's *Options & Supplies → Supply Levels* panel shows “Information Not Available” for this queue; it only fetches supplies from Bonjour-discovered printers, not from CUPS.

- **PDFs don’t print** (queue shows the job for a second, then it disappears; `ippeve.log` says `convert failed`)  
  Ensure both ImageMagick and Ghostscript are installed (`brew install imagemagick ghostscript`).  
  Test with `convert -density 406 some.pdf out.png` — `gs: command not found` means Ghostscript is missing.

###  Supported printers & media

- **Models:** Any with a print task in [`niimbluelib`](https://github.com/MultiMote/niimbluelib/blob/main/src/print_tasks/index.ts)
  (D11, D110, D110_M, D101, B1, B21 variants, B21_PRO, B1_PRO, H1S, and more; 80 models are recognised).  
  Confirmed by the maintainer: **D110_M** (protocol v4).  
  `npm run info` connects to your printer and prints its model, firmware, battery and the detected print task.

- **Roll sizes (preconfigured):**  
  12×22, 12×30, 12×40, 12×75, 12×109 mm  
  14×30, 14×40, 15×30, 15×50 mm

  (See `config/niimbot.ppd` for details.)


### Roadmap
- Auto-detect model variants (e.g. D110_M) and tune protocol/init
- Optional pure-Node IPP server (no ippeveprinter dependency)
- Homebrew formula for one-command install