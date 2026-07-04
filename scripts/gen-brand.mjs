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
    <tspan fill="${text}">smpl</tspan><tspan fill="${accent}">mark</tspan><tspan font-size="42" dy="-132" font-weight="300" letter-spacing="2" fill="${text}">TM</tspan>
  </text>
</svg>`;

// Favicon = just the "sm" letters, transparent background (no tile).
// Static version drives the PNG rasterization (resvg ignores @media): explicit colors.
const faviconSvgStatic = (sColor, mColor) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <text x="256" y="348" text-anchor="middle" font-family="${FONT}" font-size="344" font-weight="700" letter-spacing="-10">
    <tspan fill="${sColor}">s</tspan><tspan fill="${mColor}">m</tspan>
  </text>
</svg>`;
// Adaptive version shipped as favicon.svg — browsers honour prefers-color-scheme, so the light
// "s" stays visible on light-mode tabs too.
const faviconSvgAdaptive = () => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <style>
    .s { fill: ${TEXT_DARK}; } .m { fill: ${ACCENT}; }
    @media (prefers-color-scheme: light) { .s { fill: ${TEXT_LIGHT}; } .m { fill: ${ACCENT_LIGHT}; } }
  </style>
  <text x="256" y="348" text-anchor="middle" font-family="${FONT}" font-size="344" font-weight="700" letter-spacing="-10">
    <tspan class="s">s</tspan><tspan class="m">m</tspan>
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

// Ship the adaptive SVG (primary favicon for modern browsers).
writeFileSync("public/img/favicon.svg", faviconSvgAdaptive());
// PNG fallbacks: transparent, dark-tab colors (light "s" + accent "m").
const favBuf = Buffer.from(faviconSvgStatic(TEXT_DARK, ACCENT));
await sharp(favBuf).resize(180, 180).png().toFile("public/img/apple-touch-icon.png");
await sharp(favBuf).resize(120, 120).png().toFile("public/img/favicon-120.png");
await sharp(favBuf).resize(32, 32).png().toFile("public/img/favicon-32.png");
await sharp(favBuf).resize(16, 16).png().toFile("public/img/favicon-16.png");

console.log("brand assets written to public/img/");
