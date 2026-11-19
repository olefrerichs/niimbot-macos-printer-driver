import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { rasterizeVectorPages } from "../src/rasterize.mjs";

for (const [count, render] of [[1, "text"], [5, "text"], [5, "photo"]]) {
    test(`rasterizes all ${count} PDF pages in ${render} mode`, async (t) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "niimbot-raster-test-"));
        t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
        const ps = path.join(dir, "labels.ps");
        const pdf = path.join(dir, "labels.pdf");
        fs.writeFileSync(ps, "%!PS-Adobe-3.0\n" + Array.from({ length: count }, (_, i) =>
            `<< /PageSize [141.73 85.04] >> setpagedevice\n/Helvetica findfont 16 scalefont setfont\n20 20 moveto (Label ${i + 1}) show showpage\n`
        ).join(""));
        const gs = spawnSync("gs", ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite", `-sOutputFile=${pdf}`, ps]);
        assert.equal(gs.status, 0, gs.stderr?.toString());

        const pages = rasterizeVectorPages(pdf, dir, 400, 240, render, "60%");
        assert.equal(pages.length, count);
        assert.deepEqual(pages.map(p => path.basename(p)),
            Array.from({ length: count }, (_, i) => `page-${String(i).padStart(3, "0")}.png`));
        for (const page of pages) {
            const { width, height } = await sharp(page).metadata();
            assert.deepEqual([width, height], [400, 240]);
        }
        assert.equal(new Set(pages.map(p => createHash("sha256").update(fs.readFileSync(p)).digest("hex"))).size, count);
    });
}
