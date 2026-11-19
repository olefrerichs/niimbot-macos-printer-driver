import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function convertPage(input, output, widthPx, heightPx, render, threshold) {
    const common = [
        "-units", "PixelsPerInch", "-density", "406",
        input, "-colorspace", "Gray", "-background", "white", "-alpha", "remove", "-alpha", "off",
        "-filter", "box", "-resize", `${widthPx}x${heightPx}`, // fit (no "!")
        "-gravity", "center", "-extent", `${widthPx}x${heightPx}`
    ];
    const args = render === "photo"
        ? [...common, "-dither", "FloydSteinberg", "-colors", "2", "-type", "bilevel", "+adjoin", output]
        : [...common, "-unsharp", "0x1+0.8+0.02", "-threshold", threshold, "-type", "bilevel", "+adjoin", output];
    const conv = spawnSync("convert", args, { stdio: ["ignore", "ignore", "pipe"] });
    if (conv.error?.code === "ENOENT") throw new Error("ImageMagick 'convert' not found (brew install imagemagick)");
    if (conv.status !== 0) {
        const detail = (conv.stderr || "").toString().split("\n")
            .map(l => l.trim()).filter(l => l && !/deprecated/i.test(l)).slice(-3).join(" | ");
        throw new Error(`convert failed (exit ${conv.status})${detail ? ": " + detail : ""}`);
    }
}

/** Render each PDF page as its own label; ImageMagick's PDF reader may silently render only page one. */
export function rasterizeVectorPages(input, outputDir, widthPx, heightPx, render, threshold) {
    if (path.extname(input).toLowerCase() === ".pdf") {
        const rawPattern = path.join(outputDir, "raw-%03d.png");
        const gs = spawnSync("gs", [
            "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pnggray", "-r406",
            `-sOutputFile=${rawPattern}`, input
        ], { stdio: ["ignore", "ignore", "pipe"] });
        if (gs.error?.code === "ENOENT") throw new Error("Ghostscript 'gs' not found (brew install ghostscript)");
        if (gs.status !== 0) throw new Error(`gs failed (exit ${gs.status}): ${(gs.stderr || "").toString().trim()}`);
        const rawPages = fs.readdirSync(outputDir).filter(f => /^raw-\d+\.png$/.test(f)).sort();
        if (rawPages.length === 0) throw new Error("gs produced no pages");
        rawPages.forEach((name, i) => convertPage(
            path.join(outputDir, name), path.join(outputDir, `page-${String(i).padStart(3, "0")}.png`),
            widthPx, heightPx, render, threshold
        ));
    } else {
        convertPage(input, path.join(outputDir, "page-%03d.png"), widthPx, heightPx, render, threshold);
    }
    const pages = fs.readdirSync(outputDir).filter(f => /^page-\d+\.png$/.test(f)).sort();
    if (pages.length === 0) throw new Error("Rasterisation produced no pages");
    return pages.map(f => path.join(outputDir, f));
}
