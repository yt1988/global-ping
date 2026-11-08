#!/usr/bin/env node
// Renders the link-preview images with resvg (dev dependency), 1200 × 630: public/og/<lang>.png for each language.
// Run when the headline or the subtitle changes, and commit the output. Uses system fonts for the text (Windows:
// Segoe UI, Microsoft YaHei, Microsoft JhengHei, Yu Gothic UI, Malgun Gothic, Consolas), as the other 1ms.dog tools do.
// Usage: node scripts/assets.mjs
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url);
const HOST = new URL(process.env.SITE_URL || "https://ping.1ms.dog").host;
const FONTS = { "zh-CN": "Microsoft YaHei", "zh-TW": "Microsoft JhengHei", ja: "Yu Gothic UI", ko: "Malgun Gothic" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const b64 = async f => Buffer.from(await readFile(new URL(f, pub))).toString("base64");
const render = svg => new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" } }).render().asPng();

// A decorative 16-packet strip: varied heights, one reply missing, so the picture says "every packet visible".
const BARS = [.35, .5, .42, .7, .55, .4, .62, .48, .9, .52, .45, .68, .38, .86, .58, 0];

async function card(lang, d) {
  const ff = `${FONTS[lang] ? `'${FONTS[lang]}', ` : ""}'Segoe UI', 'Microsoft YaHei', sans-serif`;
  const logo = await b64("assets/logo-dark.svg");
  const wide = ch => /[　-鿿가-힯＀-￯]/.test(ch), est = (t, px) => [...t].reduce((a, ch) => a + (wide(ch) ? 1 : .56) * px, 0);
  const wrap = (text, px, max) => {
    const out = []; let cur = "";
    for (const word of text.split(/(?<=[ ，、？?,：:])/)) {
      for (const piece of est(word, px) > 560 ? [...word] : [word]) {
        if (cur && est(cur + piece, px) > 560) { out.push(cur.trim()); cur = ""; }
        cur += piece;
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out.slice(0, max);
  };
  let size = 60, lines;
  for (; (lines = wrap(d.h1, size, 2)).length > 1 && size > 40; size -= 4);
  const head = lines.map((l, i) => `<text x="72" y="${238 + i * (size + 14)}" font-size="${size}" font-weight="700" fill="#ededed">${esc(l)}</text>`).join("");
  const subY = 238 + (lines.length - 1) * (size + 14) + 52;
  const sub = wrap(d.og_sub, 26, 2).map((l, i) => `<text x="72" y="${subY + i * 36}" font-size="26" fill="#a0a0a0">${esc(l)}</text>`).join("");
  const barY = 500;
  const bars = BARS.map((h, i) => h
    ? `<rect x="${80 + i * 62}" y="${barY - Math.round(h * 110)}" width="34" height="${Math.round(h * 110)}" rx="5" fill="#f59e0b"/>`
    : `<rect x="${80 + i * 62}" y="${barY - 20}" width="34" height="20" rx="5" fill="#332a1c"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="${ff}">
<rect width="1200" height="630" fill="#1c1c1c"/>
<image x="72" y="56" width="180" height="72" href="data:image/svg+xml;base64,${logo}"/>
${head}
${sub}
${bars}
<text x="72" y="574" font-size="26" font-weight="600" fill="#f59e0b">${HOST}</text>
<text x="1128" y="574" font-size="22" fill="#a0a0a0" text-anchor="end">ICMP · 16 packets · 18 locations</text>
</svg>`;
}

await mkdir(new URL("og/", pub), { recursive: true });
for (const f of (await readdir(new URL("i18n/", src))).filter(f => f.endsWith(".mjs"))) {
  const lang = f.slice(0, -4), d = (await import(new URL("i18n/" + f, src).href)).default;
  const png = render(await card(lang, d));
  await writeFile(new URL(`og/${lang.toLowerCase()}.png`, pub), png);
  console.log(`og/${lang.toLowerCase()}.png ${Math.round(png.length / 1024)} KB`);
}
