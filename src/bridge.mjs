#!/usr/bin/env node
// NiiMBOT macOS Printer Bridge
// - Converts incoming jobs (PDF/PS/images) to 1-bit page images, one per page
// - Prints all pages as one job over BLE using @mmote/niimblue-node print tasks
// - Reads IPP_* job attributes exported by ippeveprinter (media, quality, copies, ...)
// - Reports printer conditions back to ippeveprinter via STATE:/ATTR: lines
// - Central settings via config/bridge.config.json + env overrides

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { initClient, ImageEncoder } from "@mmote/niimblue-node";

// ---------- Settings (config + env) ----------
const ROOT = process.cwd();
const CFG_PATH = path.join(ROOT, "config", "bridge.config.json");

function loadJson(p) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}
const fileCfg = loadJson(CFG_PATH);

// Defaults ("" = automatic / library default)
const defaults = {
    NIIMBLUE_NAME: "",              // set in config/bridge.config.json
    RENDER: "text",                 // "text" | "photo"
    THRESHOLD: "60%",               // used when RENDER="text"
    DIRECTION: "",                  // "", "top"|"left"
    ROTATE_FOR_LEFT: "0",           // "1" to rotate raster when direction=left
    LABEL_TYPE: "",                 // "" = type reported by the printer; 1 gaps, 2 black mark, 3 continuous, 5 transparent
    QUANTITY: 1,                    // labels per copy (multiplied with Copies from the Print dialog)
    SPEED: "",                      // "" = from dialog quality (High -> 0); 0 = low speed/higher quality, 1 = normal. D110M_V4-class only
    COLOR: "",                      // multicolor paper temperature (B1 / D110M_V4 only); "" = library default
    PAGE_TIMEOUT_MS: 10000,         // timeout for sending one page's image data
    STATUS_TIMEOUT_MS: 8000,        // timeout for each status poll while waiting for the printer
    STATUS_POLL_MS: 500,            // status poll interval
    DEBUG: "0"                      // "1" keeps logs & .spool PNGs; "0" quiet mode
};

// Merge order: defaults < file < env
function pick(key) {
    const env = process.env["NIIMBOT_" + key] ?? process.env["NIIMBLUE_" + key] ?? process.env[key];
    if (env !== undefined && env !== "") return env;
    if (fileCfg[key] !== undefined && fileCfg[key] !== "") return String(fileCfg[key]);
    return String(defaults[key]);
}
const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const SETTINGS = {
    NAME: pick("NIIMBLUE_NAME"),
    RENDER: pick("RENDER").toLowerCase(),
    THRESHOLD: pick("THRESHOLD"),
    DIRECTION: pick("DIRECTION").toLowerCase(),
    ROTATE_FOR_LEFT: pick("ROTATE_FOR_LEFT") === "1",
    LABEL_TYPE: intOrNull(pick("LABEL_TYPE")),          // null = auto
    QUANTITY: Math.max(1, intOrNull(pick("QUANTITY")) ?? 1),
    SPEED: intOrNull(pick("SPEED")),                    // null = auto
    COLOR: intOrNull(pick("COLOR")),                    // null = library default
    PAGE_TIMEOUT_MS: intOrNull(pick("PAGE_TIMEOUT_MS")) ?? defaults.PAGE_TIMEOUT_MS,
    STATUS_TIMEOUT_MS: intOrNull(pick("STATUS_TIMEOUT_MS")) ?? defaults.STATUS_TIMEOUT_MS,
    STATUS_POLL_MS: intOrNull(pick("STATUS_POLL_MS")) ?? defaults.STATUS_POLL_MS,
    DEBUG: pick("DEBUG") === "1"
};

if (!SETTINGS.NAME) {
    console.error(`ERROR: Set your printer name in ${CFG_PATH} ({"NIIMBLUE_NAME":"D110_M-...."}) or via env NIIMBLUE_NAME.`);
    process.exit(2);
}

// ---- ippeveprinter message helpers -----------------------------------------
// Lines on stderr are parsed by ippeveprinter: INFO:/ERROR: -> job message,
// STATE: -> printer-state-reasons, ATTR: -> job/printer attributes.
const logInfo = (msg) => { if (SETTINGS.DEBUG) process.stderr.write(`INFO: ${msg}\n`); };
const logError = (msg) => { process.stderr.write(`ERROR: ${msg}\n`); };
const state = (spec) => { process.stderr.write(`STATE: ${spec}\n`); };
const attr = (spec) => { process.stderr.write(`ATTR: ${spec}\n`); };

// ---- Parse IPP options ------------------------------------------------------
const ipp = {
    mediaCol: process.env.IPP_MEDIA_COL || "",
    media: process.env.IPP_MEDIA || "",
    quality: (process.env.IPP_PRINT_QUALITY || "").toLowerCase(), // draft|normal|high
    darkness: process.env.IPP_PRINT_DARKNESS || "",
    copies: Math.max(1, intOrNull(process.env.IPP_COPIES) ?? 1),
    collated: !/uncollated/i.test(process.env.IPP_MULTIPLE_DOCUMENT_HANDLING || ""),
    contentType: process.env.CONTENT_TYPE || ""
};

// Extract size (mm) from media-col (x/y are hundredths of a millimetre)
function parseMediaColToMm(mediaColStr) {
    const x = /x-dimension\s*=\s*([0-9]+)/i.exec(mediaColStr);
    const y = /y-dimension\s*=\s*([0-9]+)/i.exec(mediaColStr);
    if (!x || !y) return null;
    return {
        mmW: Math.max(6, Math.round(parseInt(x[1], 10) / 100)),
        mmH: Math.max(6, Math.round(parseInt(y[1], 10) / 100))
    };
}

// Fallback: parse "om_12x40mm" style keywords
function parseMediaKeyword(mediaStr) {
    const m = /([0-9]{2})x([0-9]{2,3})mm/i.exec(mediaStr);
    return m ? { mmW: parseInt(m[1], 10), mmH: parseInt(m[2], 10) } : null;
}

const chosenSize =
    parseMediaColToMm(ipp.mediaCol) ||
    parseMediaKeyword(ipp.media) ||
    { mmW: 12, mmH: 40 };

// Map IPP darkness/quality -> thermal density within the model's supported range
function mapDensity(darknessStr, quality, meta) {
    const min = meta?.densityMin ?? 1;
    const max = meta?.densityMax ?? 5;
    const def = clamp(meta?.densityDefault ?? 3, min, max);
    if (darknessStr) {
        const d = clamp(parseInt(darknessStr, 10) || 0, 0, 100);
        return clamp(min + Math.round((d / 100) * (max - min)), min, max);
    }
    switch (quality) {
        case "draft": return min;
        case "high": return max;
        default: return def;
    }
}

// ---- Rasterise (one PNG per page) -------------------------------------------
const inPath = process.argv[2] && process.argv[2] !== "-" ? process.argv[2] : null;
if (!inPath || !fs.existsSync(inPath)) {
    logError("No job file path provided");
    process.exit(2);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "niimbot-ipp-"));
const spoolDir = path.join(ROOT, ".spool");
if (SETTINGS.DEBUG) fs.mkdirSync(spoolDir, { recursive: true });
const jobStamp = Date.now();

// ~203 dpi ≈ 8 px/mm; width must be divisible by 8
const px = (mm) => Math.round(mm * 8);
const widthPxRaw = px(chosenSize.mmW);
const widthPx = Math.max(8, widthPxRaw - (widthPxRaw % 8));
const heightPx = Math.max(px(chosenSize.mmH), 16);

const ext = path.extname(inPath).toLowerCase();
let pagePaths = [];
try {
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff"].includes(ext)) {
        // Image inputs: use sharp pipeline (fit + pad + threshold)
        const pngOut = path.join(tmpDir, "page-000.png");
        await sharp(inPath)
            .flatten({ background: "#fff" })
            .resize(widthPx, heightPx, { fit: "contain", kernel: sharp.kernel.nearest, background: "#fff" })
            .toColorspace('b-w')
            .threshold(SETTINGS.RENDER === "photo" ? 128 : Math.floor(parseInt(SETTINGS.THRESHOLD) || 153))
            .toFile(pngOut);
        pagePaths = [pngOut];
    } else {
        // PDF/other vector inputs: ImageMagick "convert" (needs Ghostscript for PDF).
        // Every input page becomes page-NNN.png; no -flatten, that would merge pages.
        const pattern = path.join(tmpDir, "page-%03d.png");
        const common = [
            "-units", "PixelsPerInch", "-density", "406",
            inPath, "-colorspace", "Gray", "-background", "white", "-alpha", "remove", "-alpha", "off",
            "-filter", "box", "-resize", `${widthPx}x${heightPx}`, // fit (no "!")
            "-gravity", "center", "-extent", `${widthPx}x${heightPx}`
        ];
        const args = (SETTINGS.RENDER === "photo")
            ? [...common, "-dither", "FloydSteinberg", "-colors", "2", "-type", "bilevel", "+adjoin", pattern]
            : [...common, "-unsharp", "0x1+0.8+0.02", "-threshold", SETTINGS.THRESHOLD, "-type", "bilevel", "+adjoin", pattern];

        const conv = spawnSync("convert", args, { stdio: ["ignore", "ignore", "pipe"] });
        if (conv.error?.code === "ENOENT") {
            logError("ImageMagick 'convert' not found on PATH (brew install imagemagick ghostscript)");
            process.exit(3);
        }
        if (conv.status !== 0) {
            // Keep the last meaningful stderr lines (skip the IMv7 deprecation banner)
            const detail = (conv.stderr || "").toString()
                .split("\n").map(l => l.trim())
                .filter(l => l && !/deprecated/i.test(l))
                .slice(-3).join(" | ");
            logError(`convert failed (exit ${conv.status})${detail ? ": " + detail : ""}`);
            process.exit(3);
        }
        pagePaths = fs.readdirSync(tmpDir)
            .filter(f => /^page-\d+\.png$/.test(f))
            .sort()
            .map(f => path.join(tmpDir, f));
        if (pagePaths.length === 0) {
            logError("convert produced no pages");
            process.exit(3);
        }
    }

    if (SETTINGS.DEBUG) {
        pagePaths.forEach((p, i) => {
            const copy = path.join(spoolDir, `job-${jobStamp}-p${i + 1}.png`);
            fs.copyFileSync(p, copy);
            logInfo(`Saved debug copy to ${copy}`);
        });
    }
} catch (e) {
    logError(`Rasterisation failed: ${e.message}`);
    process.exit(3);
}

logInfo(`IPP_MEDIA=${ipp.media}`);
logInfo(`IPP_MEDIA_COL=${ipp.mediaCol}`);
logInfo(`chosen mm = ${chosenSize.mmW}×${chosenSize.mmH}, pages=${pagePaths.length}, copies=${ipp.copies} (${ipp.collated ? "collated" : "uncollated"}) × quantity ${SETTINGS.QUANTITY}`);
logInfo(`render=${SETTINGS.RENDER} threshold=${SETTINGS.THRESHOLD}`);

// ---- Printer error -> IPP printer-state-reasons -----------------------------
// niimbluelib PrinterErrorCode -> [ippeveprinter state keyword, human text]
const PRINTER_ERRORS = {
    1: ["cover-open", "cover open"],
    2: ["media-empty", "out of labels"],
    3: ["marker-supply-low", "battery low"],
    4: ["other", "battery fault"],
    5: ["other", "cancelled at the printer"],
    6: ["other", "data error"],
    7: ["other", "print head overheated"],
    8: ["media-jam", "label feed error"],
    9: ["other", "printer busy"],
    10: ["other", "no print head"],
    11: ["other", "temperature too low"],
    12: ["other", "print head loose"],
    13: ["marker-supply-empty", "no ribbon"],
    14: ["marker-supply-empty", "wrong ribbon"],
    15: ["marker-supply-empty", "used ribbon"],
    16: ["media-needed", "wrong label type"],
    22: ["other", "communication error"],
    23: ["other", "printer disconnected"]
};

class BridgeError extends Error {
    constructor(keyword, text) { super(text); this.keyword = keyword; }
}

function describeError(e) {
    if (e instanceof BridgeError) return { keyword: e.keyword, text: e.message };
    if (typeof e?.reasonId === "number" && PRINTER_ERRORS[e.reasonId]) {
        const [keyword, text] = PRINTER_ERRORS[e.reasonId];
        return { keyword, text: `Printer reports: ${text}` };
    }
    if (/Device not found/i.test(String(e?.message))) {
        return { keyword: "other", text: `Printer ${SETTINGS.NAME} not found over Bluetooth (switched off or asleep?)` };
    }
    return { keyword: "other", text: e?.message || String(e) };
}

// ---- Print via niimblue-node -----------------------------------------------
const client = initClient("ble", SETTINGS.NAME, false);
let exitCode = 0;

try {
    await client.connect();

    const info = client.getPrinterInfo();
    const meta = client.getModelMetadata && client.getModelMetadata();
    const model = meta?.model || "";
    const metaDir = meta?.printDirection || "top";
    const taskName = client.getPrintTaskType();
    if (!taskName) throw new BridgeError("other", `Unsupported printer model (id ${info.modelId}); set a print task manually`);

    logInfo(`printer model=${model} task=${taskName} protocol=${info.protocolVersion} fw=${info.softwareVersion} serial=${info.serial}`);

    // --- Supplies: battery + label roll (RFID) -> marker-* attributes shown by macOS
    const markers = { names: [], types: [], levels: [], colors: [] };
    if (typeof info.charge === "number") {
        markers.names.push("Battery"); markers.types.push("other");
        markers.levels.push(clamp(info.charge * 25, 0, 100)); markers.colors.push("none");
    }
    let labelTypeFromRoll = null;
    try {
        const rfid = await client.abstraction.rfidInfo();
        if (rfid?.tagPresent) {
            if (rfid.consumablesType > 0) labelTypeFromRoll = rfid.consumablesType;
            if (rfid.allPaper > 0) {
                const remaining = clamp(Math.round(100 * (rfid.allPaper - rfid.usedPaper) / rfid.allPaper), 0, 100);
                markers.names.push("Labels"); markers.types.push("other");
                markers.levels.push(remaining); markers.colors.push("none");
                logInfo(`label roll: ${rfid.allPaper - rfid.usedPaper}/${rfid.allPaper} left, type ${rfid.consumablesType}, barcode ${rfid.barCode}`);
            }
        }
    } catch (e) {
        logInfo(`RFID info unavailable: ${e?.message || e}`);
    }
    if (markers.names.length) {
        attr(`marker-names=${markers.names.join(",")} marker-types=${markers.types.join(",")} marker-colors=${markers.colors.join(",")} marker-levels=${markers.levels.join(",")} marker-low-levels=${markers.names.map(() => 10).join(",")} marker-high-levels=${markers.names.map(() => 100).join(",")}`);
    }

    // --- Pre-flight: lid / paper / ribbon from the heartbeat, battery level
    try {
        const hb = await client.abstraction.heartbeat();
        logInfo(`heartbeat: lidClosed=${hb.lidClosed} paperInserted=${hb.paperInserted} charge=${hb.chargeLevel} temp=${hb.temp} ribbonInserted=${hb.ribbonInserted}`);
        if (hb.lidClosed === false) throw new BridgeError("cover-open", "Printer cover is open");
        if (hb.paperInserted === false) throw new BridgeError("media-empty", "No labels in the printer");
        if (hb.ribbonInserted === false) throw new BridgeError("marker-supply-empty", "No ribbon in the printer");
    } catch (e) {
        if (e instanceof BridgeError) throw e;
        logInfo(`heartbeat unavailable: ${e?.message || e}`);
    }
    const batteryLow = typeof info.charge === "number" && info.charge <= 1; // <= 25 %
    state("none");
    if (batteryLow) { state("+marker-supply-low"); logInfo("battery at or below 25 %"); }

    // --- Effective print parameters
    const density = mapDensity(ipp.darkness, ipp.quality, meta);
    const labelType = SETTINGS.LABEL_TYPE ?? labelTypeFromRoll ?? ((info.labelType ?? 0) > 0 ? info.labelType : 1);
    const speed = SETTINGS.SPEED ?? (ipp.quality === "high" ? 0 : 1);

    // Direction: ENV/CFG override > known quirk > metadata
    let direction = SETTINGS.DIRECTION || metaDir;
    if (!SETTINGS.DIRECTION && /D1(00|10)_?M/i.test(model) && metaDir === "left") {
        direction = "top";
        logInfo(`overriding printDirection left→top for model ${model}`);
    }

    // --- Encode pages
    const encodedPages = [];
    for (const p of pagePaths) {
        let img = sharp(p);
        if (direction === "left" && SETTINGS.ROTATE_FOR_LEFT) {
            img = img.rotate(90);
            logInfo("rotated raster +90° for left-direction compatibility");
        }
        encodedPages.push(await ImageEncoder.encodeImage(img, direction));
    }

    // --- Page plan: copies from the Print dialog × QUANTITY, collated or not
    const perCopy = SETTINGS.QUANTITY;
    let plan;
    if (encodedPages.length > 1 && ipp.collated && ipp.copies > 1) {
        plan = [];
        for (let c = 0; c < ipp.copies; c++) {
            for (const encoded of encodedPages) plan.push({ encoded, quantity: perCopy });
        }
    } else {
        plan = encodedPages.map(encoded => ({ encoded, quantity: ipp.copies * perCopy }));
    }
    const totalPages = plan.reduce((n, p) => n + p.quantity, 0);
    attr(`job-impressions=${totalPages}`);

    logInfo(`quality=${ipp.quality} darkness=${ipp.darkness} density=${density} (range ${meta?.densityMin ?? "?"}-${meta?.densityMax ?? "?"}) labelType=${labelType} speed=${speed} color=${SETTINGS.COLOR ?? "default"} totalPages=${totalPages}`);

    // --- Progress -> job-impressions-completed
    let lastReported = 0;
    client.on("printprogress", (e) => {
        // e.page is the page the printer is on; count it only once print and feed reached 100 %
        if (e.pagePrintProgress >= 100 && e.pageFeedProgress >= 100 && e.page > lastReported) {
            lastReported = e.page;
            attr(`job-impressions-completed=${e.page}`);
        }
    });

    // --- Print task (mirrors niimblue-node printImages, plus speed/color/timeouts)
    const taskOptions = {
        density,
        labelType,
        totalPages,
        speed,
        statusPollIntervalMs: SETTINGS.STATUS_POLL_MS,
        statusTimeoutMs: SETTINGS.STATUS_TIMEOUT_MS,
        pageTimeoutMs: SETTINGS.PAGE_TIMEOUT_MS
    };
    if (SETTINGS.COLOR !== null) taskOptions.color = SETTINGS.COLOR;
    const printTask = client.abstraction.newPrintTask(taskName, taskOptions);

    try {
        await printTask.printInit();
        for (const page of plan) {
            await printTask.printPage(page.encoded, page.quantity);
            await printTask.waitForPageFinished();
        }
        await printTask.waitForFinished();
    } finally {
        try { await printTask.printEnd(); } catch {}
    }

    logInfo(`Printed ${chosenSize.mmW}x${chosenSize.mmH}mm, ${pagePaths.length} page(s), ${totalPages} label(s), density ${density}, direction ${direction}`);

    // Let ippeveprinter know the job is complete so it clears the queue
    attr(`job-impressions-completed=${totalPages}`);
    process.stderr.write('INFO: Print complete\n');
} catch (e) {
    exitCode = 1;
    const { keyword, text } = describeError(e);
    state("none");
    state(`+${keyword}`);
    logError(text);
    if (SETTINGS.DEBUG && e?.stack) process.stderr.write(`DEBUG: ${e.stack}\n`);
} finally {
    try { await client.disconnect(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    process.exit(exitCode);
}
