#!/usr/bin/env node
// NiiMBOT macOS Printer Bridge
// - Converts incoming jobs to 1-bit images
// - Prints via BLE using @mmote/niimblue-node
// - Reads IPP_* from ippeveprinter
// - Central settings via config/bridge.config.json + env overrides

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { initClient, ImageEncoder, printImage } from "@mmote/niimblue-node";

// ---------- Settings (config + env) ----------
const ROOT = process.cwd();
const CFG_PATH = path.join(ROOT, "config", "bridge.config.json");

function loadJson(p) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}
const fileCfg = loadJson(CFG_PATH);

// Defaults
const defaults = {
    NIIMBLUE_NAME: "",              // set in config/bridge.config.json
    RENDER: "text",                 // "text" | "photo"
    THRESHOLD: "60%",               // used when RENDER="text"
    DIRECTION: "",                  // "", "top"|"left"|"right"|"bottom"
    ROTATE_FOR_LEFT: "0",           // "1" to rotate raster when direction=left
    LABEL_TYPE: 1,                  // SDK labelType (printer default often 1)
    QUANTITY: 1,                    // how many labels per job
    DEBUG: "0"                      // "1" keeps logs & .spool PNGs; "0" quiet mode
};

// Merge order: defaults < file < env
function pick(key) {
    const env = process.env["NIIMBOT_" + key] ?? process.env["NIIMBLUE_" + key] ?? process.env[key];
    if (env !== undefined && env !== "") return env;
    if (fileCfg[key] !== undefined && fileCfg[key] !== "") return String(fileCfg[key]);
    return String(defaults[key]);
}

const SETTINGS = {
    NAME: pick("NIIMBLUE_NAME"),                // required: printer BLE name
    RENDER: pick("RENDER").toLowerCase(),       // "text"|"photo"
    THRESHOLD: pick("THRESHOLD"),
    DIRECTION: pick("DIRECTION").toLowerCase(),
    ROTATE_FOR_LEFT: pick("ROTATE_FOR_LEFT") === "1",
    LABEL_TYPE: Math.max(1, parseInt(pick("LABEL_TYPE"), 10) || 1),
    QUANTITY: Math.max(1, parseInt(pick("QUANTITY"), 10) || 1),
    DEBUG: pick("DEBUG") === "1"
};

if (!SETTINGS.NAME) {
    console.error(`ERROR: Set your printer name in ${CFG_PATH} ({"NIIMBLUE_NAME":"D110_M-...."}) or via env NIIMBLUE_NAME.`);
    process.exit(2);
}

// ---- Logging helpers (respect DEBUG) ----------------------------------------
const logInfo = (msg) => { if (SETTINGS.DEBUG) process.stderr.write(`INFO: ${msg}\n`); };
const logError = (msg) => { process.stderr.write(`ERROR: ${msg}\n`); };

// ---- Parse IPP options ------------------------------------------------------
const ipp = {
    mediaCol: process.env.IPP_MEDIA_COL || "",
    media: process.env.IPP_MEDIA || "",
    quality: (process.env.IPP_PRINT_QUALITY || "").toLowerCase(), // draft|normal|high
    darkness: process.env.IPP_PRINT_DARKNESS || "",
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

let chosenSize =
    parseMediaColToMm(ipp.mediaCol) ||
    parseMediaKeyword(ipp.media) ||
    { mmW: 12, mmH: 40 };

// Map IPP darkness/quality -> thermal density (1..5)
function mapDensity(darknessStr, quality) {
    if (darknessStr) {
        const d = Math.max(0, Math.min(100, parseInt(darknessStr, 10)));
        return Math.min(5, Math.max(1, Math.round(d / 20)));
    }
    switch (quality) {
        case "draft": return 2;
        case "high": return 5;
        default: return 3;
    }
}
const density = mapDensity(ipp.darkness, ipp.quality);

// ---- Rasterise --------------------------------------------------------------
const inPath = process.argv[2] && process.argv[2] !== "-" ? process.argv[2] : null;
if (!inPath || !fs.existsSync(inPath)) {
    logError("No job file path provided");
    process.exit(2);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "niimbot-ipp-"));
const pngOut = path.join(tmpDir, "job.png");

// Optional debug copy
const spoolDir = path.join(ROOT, ".spool");
if (SETTINGS.DEBUG) fs.mkdirSync(spoolDir, { recursive: true });
const spoolCopy = path.join(spoolDir, `job-${Date.now()}.png`);

logInfo(`Converting ${inPath} -> ${pngOut}${SETTINGS.DEBUG ? ` (debug copy: ${spoolCopy})` : ""}`);

// ~203 dpi ≈ 8 px/mm; width must be divisible by 8
const px = (mm) => Math.round(mm * 8);
const widthPxRaw = px(chosenSize.mmW);
const widthPx = Math.max(8, widthPxRaw - (widthPxRaw % 8));
const heightPx = Math.max(px(chosenSize.mmH), 16);

const ext = path.extname(inPath).toLowerCase();
try {
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff"].includes(ext)) {
        // Image inputs: use sharp pipeline (fit + pad + threshold)
        await sharp(inPath)
            .flatten({ background: "#fff" })
            .resize(widthPx, heightPx, { fit: "contain", kernel: sharp.kernel.nearest, background: "#fff" })
            .toColorspace('b-w')
            .threshold(SETTINGS.RENDER === "photo" ? 128 : Math.floor(parseInt(SETTINGS.THRESHOLD) || 153))
            .toFile(pngOut);
    } else {
        // PDF/other vector inputs: use ImageMagick "convert" with quality presets
        const common = [
            "-units", "PixelsPerInch", "-density", "406",
            inPath, "-colorspace", "Gray", "-alpha", "remove", "-background", "white", "-flatten",
            "-filter", "box", "-resize", `${widthPx}x${heightPx}`, // fit (no "!")
            "-gravity", "center", "-extent", `${widthPx}x${heightPx}`
        ];
        const args = (SETTINGS.RENDER === "photo")
            ? [...common, "-dither", "FloydSteinberg", "-colors", "2", "-type", "bilevel", pngOut]
            : [...common, "-unsharp", "0x1+0.8+0.02", "-threshold", SETTINGS.THRESHOLD, "-type", "bilevel", pngOut];

        const conv = spawnSync("convert", args, { stdio: SETTINGS.DEBUG ? "inherit" : "ignore" });
        if (conv.status !== 0) {
            logError("convert failed");
            process.exit(3);
        }
    }

    if (SETTINGS.DEBUG) {
        fs.copyFileSync(pngOut, spoolCopy);
        logInfo(`Saved debug copy to ${spoolCopy}`);
    }
} catch (e) {
    logError(`Rasterisation failed: ${e.message}`);
    process.exit(3);
}

logInfo(`IPP_MEDIA=${ipp.media}`);
logInfo(`IPP_MEDIA_COL=${ipp.mediaCol}`);
logInfo(`chosen mm = ${chosenSize.mmW}×${chosenSize.mmH}`);
logInfo(`quality=${ipp.quality} darkness=${ipp.darkness} density=${density}`);
logInfo(`render=${SETTINGS.RENDER} threshold=${SETTINGS.THRESHOLD}`);

// ---- Print via niimblue-node -----------------------------------------------
const client = initClient("ble", SETTINGS.NAME, false);
let exitCode = 0;

try {
    await client.connect();

    const meta = client.getModelMetadata && client.getModelMetadata();
    const model = meta?.model || "";
    const metaDir = meta?.printDirection || "top";

    // Direction: ENV/CFG override > known quirk > metadata
    let direction = SETTINGS.DIRECTION || metaDir;
    if (!SETTINGS.DIRECTION && /D1(00|10)_?M/i.test(model) && metaDir === "left") {
        direction = "top";
        logInfo(`overriding printDirection left→top for model ${model}`);
    }

    // Optional rotate when using "left"
    let img = sharp(pngOut);
    if (direction === "left" && SETTINGS.ROTATE_FOR_LEFT) {
        img = img.rotate(90);
        logInfo("rotated raster +90° for left-direction compatibility");
    }

    const encoded = await ImageEncoder.encodeImage(img, direction);
    const task = client.getPrintTaskType();
    const quantity = SETTINGS.QUANTITY;

    await printImage(client, task, encoded, {
        density,
        labelType: SETTINGS.LABEL_TYPE,
        quantity
    });

    logInfo(`Printed ${chosenSize.mmW}x${chosenSize.mmH}mm, density ${density}, direction ${direction}, qty ${quantity}`);

    // Let ippeveprinter know the job is complete so it clears the queue
    process.stderr.write(`ATTR: job-impressions=${quantity} job-impressions-completed=${quantity}\n`);
    process.stderr.write('INFO: Print complete\n');
} catch (e) {
    exitCode = 1;
    logError(e?.stack || String(e));
} finally {
    try { await client.disconnect(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    process.exit(exitCode);
}
