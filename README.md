# NiiMBOT D110/D11/D100 macOS Printer (AirPrint/IPP, Bluetooth)

Use your **NiiMBOT label printer** (D110, D11, D100_M, etc.) as a **normal printer on macOS (Sonoma/Sequoia)**.  
This project exposes a local **AirPrint / IPP Everywhere** queue so every app’s **Print** dialog works.  
Jobs are rasterised and sent over **Bluetooth (BLE)** using **@mmote/niimblue-node** with **label size & density presets**.

> **Tested device:** NiiMBOT **D100_M** only (by the maintainer).  
> It **should** work with any printer models supported by [`niimblue-node`](https://github.com/MultiMote/niimblue-node), but model-specific tweaks may be needed.  
> **Contributions and test reports are very welcome.**

---

## Features
- ✅ Works with macOS **Sonoma 14** / **Sequoia 15**
- ✅ **AirPrint / IPP Everywhere** queue (no vendor driver)
- ✅ **Bluetooth (BLE)** bridge via **niimblue-node**
- ✅ Real **Paper/Label sizes** in the Print dialog (presets supported)
- ✅ **Density / darkness** control (map from Print dialog to thermal settings)

---

## How it works
A small IPP server (`ippeveprinter`) advertises a local printer.  
Each print job is handed to a Node “bridge” that converts PDFs/images to 1-bit and prints over BLE using **niimblue-node**.

---

## Supported printers & media
- **Models:** Any supported by `niimblue-node`. Confirmed on **D100_M**; expected compatibility for **D110** and **D11**.  
- **Roll sizes (pre-configured):** 12×22, 12×30, 12×40, 12×75, 12×109 mm; 14×30, 14×40 mm; 15×30, 15×50 mm.  
  You can edit `config/niimbot.printer` to add or change sizes for your media.

---

## Requirements
- macOS 13+ (Sonoma) or 15 (Sequoia)
- Node.js 18+ (`brew install node`)
- Xcode Command Line Tools (`xcode-select --install`)  
- **Bluetooth permission** for your terminal app (System Settings → Privacy & Security → Bluetooth)
- ImageMagick (`brew install imagemagick`) – used for PDF rasterisation fallback
- `ippeveprinter` (often included; otherwise install from CUPS/ippsample)

---

## Quick start

```bash
# 1) Clone & install
git clone https://github.com/<YOUR-USER>/niimboot-macos-printer-driver.git
cd niimboot-macos-printer-driver
npm install

# 2) Discover your printer's BLE name (macOS uses names, not MAC addresses)
npx @mmote/niimblue-node niimblue-cli scan -t ble
# Example output: D100-AB12CD34 or D110-ABCDEF1234

# 3) Start the printer
export NIIMBLUE_NAME="D100-AB12CD34"
chmod +x scripts/*.sh src/bridge.mjs
./scripts/start-printer.sh

# 4) Add the printer in macOS
# System Settings ▸ Printers ▸ Add Printer ▸ IPP URL:
# ipp://localhost:8631/ipp/print
