import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

type RgbTuple = [number, number, number];

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function linearToSrgb(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  const v = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return clampByte(v * 255);
}

/** Converts CSS Color 4 CIE Lab (D50) coordinates to sRGB byte tuple. */
function labToRgb(L: number, a: number, b: number): RgbTuple {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const xr = Math.pow(fx, 3) > epsilon ? Math.pow(fx, 3) : (116 * fx - 16) / kappa;
  const yr = L > kappa * epsilon ? Math.pow((L + 16) / 116, 3) : L / kappa;
  const zr = Math.pow(fz, 3) > epsilon ? Math.pow(fz, 3) : (116 * fz - 16) / kappa;

  const X = xr * 0.9642956764295677;
  const Y = yr * 1.0;
  const Z = zr * 0.8251046025104602;

  // CSS Color 4 XYZ D50 -> linear sRGB matrix
  const lr = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z;
  const lg = -0.9787684 * X + 1.9161415 * Y + 0.033454 * Z;
  const lb = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;

  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

function hexToRgb(hex: string): RgbTuple | null {
  const h = hex.replace(/^#/, "").trim();
  if (h.length === 3 || h.length === 4) {
    const c0 = h.charAt(0);
    const c1 = h.charAt(1);
    const c2 = h.charAt(2);
    return [parseInt(c0 + c0, 16), parseInt(c1 + c1, 16), parseInt(c2 + c2, 16)];
  }
  if (h.length === 6 || h.length === 8) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return null;
}

function collectCssColorVars(css: string): Map<string, RgbTuple> {
  const vars = new Map<string, RgbTuple>();
  const re = /(--color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const key = m[1];
    const hex = m[2];
    if (!key || !hex) continue;
    const rgb = hexToRgb(hex);
    if (rgb) vars.set(key, rgb);
  }
  return vars;
}

function stripBalancedAtSupports(css: string, predicateRegex: RegExp): string {
  let out = css;
  let searchFrom = 0;
  while (searchFrom < out.length) {
    const idx = out.indexOf("@supports", searchFrom);
    if (idx === -1) break;
    const braceStart = out.indexOf("{", idx);
    if (braceStart === -1) break;
    const header = out.slice(idx, braceStart);
    if (!predicateRegex.test(header)) {
      searchFrom = braceStart + 1;
      continue;
    }
    let depth = 0;
    let end = braceStart;
    for (; end < out.length; end++) {
      const ch = out[end];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
    out = out.slice(0, idx) + out.slice(end);
    searchFrom = idx;
  }
  return out;
}

function replaceLabExpressions(css: string): string {
  return css.replace(
    /lab\(\s*([+-]?\d*\.?\d+)%?\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)(?:\s*\/\s*([+-]?\d*\.?\d+%?))?\s*\)/gi,
    (_full, lStr: string, aStr: string, bStr: string, alphaStr?: string) => {
      const [r, g, b] = labToRgb(parseFloat(lStr), parseFloat(aStr), parseFloat(bStr));
      if (alphaStr) {
        const alpha = alphaStr.endsWith("%") ? parseFloat(alphaStr) / 100 : parseFloat(alphaStr);
        return `rgba(${r},${g},${b},${Number(alpha.toFixed(4))})`;
      }
      return `rgb(${r},${g},${b})`;
    }
  );
}

function findMatchingParen(str: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function replaceColorMixExpressions(css: string, vars: Map<string, RgbTuple>): string {
  let out = css;
  let guard = 0;
  while (guard++ < 500) {
    const match = /color-mix\(/i.exec(out);
    if (!match) break;
    const openIdx = match.index + "color-mix".length;
    const closeIdx = findMatchingParen(out, openIdx);
    if (closeIdx === -1) break;
    const inner = out.slice(openIdx + 1, closeIdx);
    const pctMatch = /([+-]?\d*\.?\d+)%\s*,\s*transparent$/i.exec(inner.trim());
    const alpha = pctMatch?.[1] ? Math.max(0, Math.min(1, parseFloat(pctMatch[1]) / 100)) : 1;
    const varMatch = /var\(\s*(--color-[a-z0-9-]+)\s*\)/i.exec(inner);
    const hexMatch = /#[0-9a-fA-F]{3,8}\b/.exec(inner);
    const rgbMatch = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(inner);
    let rgb: RgbTuple | null = null;
    if (varMatch?.[1]) rgb = vars.get(varMatch[1]) ?? null;
    else if (hexMatch) rgb = hexToRgb(hexMatch[0]);
    else if (rgbMatch) rgb = [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];

    const replacement = rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Number(alpha.toFixed(4))})` : "currentColor";
    out = out.slice(0, match.index) + replacement + out.slice(closeIdx + 1);
  }
  return out;
}

/**
 * Rewrites Tailwind v4 CSS Color Level 4 syntax (`in oklab`, `lab()`, `color-mix()`)
 * so Chromium 109 / Edge WebView2 v109 on Windows 7 SP1 renders every background,
 * border, gradient and shadow cleanly without dropping modern color rules.
 */
function chrome109CssCompatPlugin(): Plugin {
  return {
    name: "chrome109-css-compat",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".css")) continue;
        let css = typeof asset.source === "string" ? asset.source : asset.source.toString();
        const vars = collectCssColorVars(css);
        // Remove @supports blocks whose hex fallbacks are already emitted immediately before them
        css = stripBalancedAtSupports(css, /color:\s*(?:color-mix|lab)\(/i);
        // Strip modern interpolation color spaces from linear/radial gradients (Chrome 111+)
        css = css.replace(/\s+in\s+(?:oklab|oklch|lab|lch|srgb)\b/gi, "");
        // Convert any remaining lab() or color-mix() outside @supports
        css = replaceLabExpressions(css);
        css = replaceColorMixExpressions(css, vars);
        asset.source = css;
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), chrome109CssCompatPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: ["chrome100", "edge100", "firefox100", "safari13"],
    cssTarget: "chrome100",
    sourcemap: true,
  },
});
