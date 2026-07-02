// Generates the smplmark wordmark (dark + light PNG, with a thin trailing TM) and the "sm" favicon
// (SVG + PNG sizes) from SVG sources via sharp. Re-run: `node scripts/gen-brand.mjs`.
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
const ACCENT = "#4f8cff";
const ACCENT_LIGHT = "#2f6fe0"; // deeper blue for contrast on a light background
const TEXT_DARK = "#e6edf3"; // wordmark ink on dark theme
const TEXT_LIGHT = "#0e1116"; // wordmark ink on light theme
const TILE = "#0e1116"; // favicon tile (site dark bg)

const wordmarkSvg = (text, accent) => `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="440">
  <text x="20" y="310" font-family="${FONT}" font-size="220" font-weight="700" letter-spacing="-8">
    <tspan fill="${text}">smpl</tspan><tspan fill="${accent}">mark</tspan><tspan font-size="74" dy="-120" font-weight="300" letter-spacing="3" fill="${text}">TM</tspan>
  </text>
</svg>`;

const faviconSvg = (sColor, mColor, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="116" fill="${bg}"/>
  <text x="256" y="366" text-anchor="middle" font-family="${FONT}" font-size="310" font-weight="700" letter-spacing="-12">
    <tspan fill="${sColor}">s</tspan><tspan fill="${mColor}">m</tspan>
  </text>
</svg>`;

async function wordmark(name, text, accent) {
  await sharp(Buffer.from(wordmarkSvg(text, accent)))
    .trim()
    .extend({ top: 6, bottom: 6, left: 6, right: 10, background: "#00000000" })
    .png()
    .toFile(`public/img/${name}.png`);
}

await wordmark("logo-dark", TEXT_DARK, ACCENT);
await wordmark("logo-light", TEXT_LIGHT, ACCENT_LIGHT);

// Favicon: dark tile, light "s" + accent "m" (the logo's two colors). Works on any tab.
const favSvg = faviconSvg(TEXT_DARK, ACCENT, TILE);
writeFileSync("public/img/favicon.svg", favSvg);
const favBuf = Buffer.from(favSvg);
await sharp(favBuf).resize(180, 180).png().toFile("public/img/apple-touch-icon.png");
await sharp(favBuf).resize(32, 32).png().toFile("public/img/favicon-32.png");
await sharp(favBuf).resize(16, 16).png().toFile("public/img/favicon-16.png");

console.log("brand assets written to public/img/");
