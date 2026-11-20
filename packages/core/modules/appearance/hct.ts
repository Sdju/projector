/** HCT: CAM16 hue/chroma and L* tone. Used to rebuild Frozen Glass from a seed. */

export type Hct = { h: number; c: number; t: number };

const WHITE = [95.047, 100, 108.883] as const;
const XYZ_TO_SRGB = [
  [3.2413774792388685, -1.5376652402851851, -0.49885366846268053],
  [-0.9691452513005321, 1.8758853451067872, 0.04156585616912061],
  [0.05562093689691305, -0.20395524564742123, 1.0571799111220335],
] as const;

function clamp(min: number, value: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function signum(value: number) {
  return value < 0 ? -1 : value === 0 ? 0 : 1;
}

function sanitizeHue(hue: number) {
  const wrapped = hue % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function labF(value: number) {
  return value > 216 / 24389 ? Math.cbrt(value) : ((24389 / 27) * value + 16) / 116;
}

function labInvF(value: number) {
  const cubed = value ** 3;
  return cubed > 216 / 24389 ? cubed : (116 * value - 16) / (24389 / 27);
}

function yFromLstar(lstar: number) {
  return 100 * labInvF((lstar + 16) / 116);
}

function lstarFromY(y: number) {
  return 116 * labF(y / 100) - 16;
}

function linearized(channel: number) {
  const normalized = channel / 255;
  return (
    (normalized <= 0.040449936 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4) * 100
  );
}

function delinearized(channel: number) {
  const normalized = channel / 100;
  const encoded =
    normalized <= 0.0031308 ? normalized * 12.92 : 1.055 * normalized ** (1 / 2.4) - 0.055;
  return clamp(0, Math.round(encoded * 255), 255);
}

function viewingConditions() {
  const adapting = ((200 / Math.PI) * yFromLstar(50)) / 100;
  const rW = WHITE[0] * 0.401288 + WHITE[1] * 0.650173 + WHITE[2] * -0.051461;
  const gW = WHITE[0] * -0.250268 + WHITE[1] * 1.204414 + WHITE[2] * 0.045854;
  const bW = WHITE[0] * -0.002079 + WHITE[1] * 0.048952 + WHITE[2] * 0.953127;
  const f = 1;
  const c = 0.69;
  const d = clamp(0, f * (1 - (1 / 3.6) * Math.exp((-adapting - 42) / 92)), 1);
  const rgbD = [d * (100 / rW) + 1 - d, d * (100 / gW) + 1 - d, d * (100 / bW) + 1 - d];
  const k = 1 / (5 * adapting + 1);
  const k4 = k ** 4;
  const k4F = 1 - k4;
  const fl = k4 * adapting + 0.1 * k4F * k4F * Math.cbrt(5 * adapting);
  const n = yFromLstar(50) / WHITE[1];
  const nbb = 0.725 / n ** 0.2;
  const rgbAFactors = [
    ((fl * rgbD[0] * rW) / 100) ** 0.42,
    ((fl * rgbD[1] * gW) / 100) ** 0.42,
    ((fl * rgbD[2] * bW) / 100) ** 0.42,
  ];
  const rgbA = rgbAFactors.map((value) => (400 * value) / (value + 27.13));
  return {
    n,
    aw: (2 * rgbA[0] + rgbA[1] + 0.05 * rgbA[2]) * nbb,
    nbb,
    ncb: nbb,
    c,
    nc: f,
    rgbD,
    fl,
    fLRoot: fl ** 0.25,
    z: 1.48 + Math.sqrt(n),
  };
}

const view = viewingConditions();

function xyzFromArgb(argb: number) {
  const r = linearized((argb >> 16) & 255);
  const g = linearized((argb >> 8) & 255);
  const b = linearized(argb & 255);
  return [
    0.41233895 * r + 0.35762064 * g + 0.18051042 * b,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    0.01932141 * r + 0.11916382 * g + 0.95034478 * b,
  ];
}

function argbFromXyz(x: number, y: number, z: number) {
  const r = delinearized(XYZ_TO_SRGB[0][0] * x + XYZ_TO_SRGB[0][1] * y + XYZ_TO_SRGB[0][2] * z);
  const g = delinearized(XYZ_TO_SRGB[1][0] * x + XYZ_TO_SRGB[1][1] * y + XYZ_TO_SRGB[1][2] * z);
  const b = delinearized(XYZ_TO_SRGB[2][0] * x + XYZ_TO_SRGB[2][1] * y + XYZ_TO_SRGB[2][2] * z);
  return ((255 << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

function cam16FromArgb(argb: number) {
  const [x, y, z] = xyzFromArgb(argb);
  const rC = 0.401288 * x + 0.650173 * y - 0.051461 * z;
  const gC = -0.250268 * x + 1.204414 * y + 0.045854 * z;
  const bC = -0.002079 * x + 0.048952 * y + 0.953127 * z;
  const rD = view.rgbD[0] * rC;
  const gD = view.rgbD[1] * gC;
  const bD = view.rgbD[2] * bC;
  const rAF = ((view.fl * Math.abs(rD)) / 100) ** 0.42;
  const gAF = ((view.fl * Math.abs(gD)) / 100) ** 0.42;
  const bAF = ((view.fl * Math.abs(bD)) / 100) ** 0.42;
  const rA = (signum(rD) * 400 * rAF) / (rAF + 27.13);
  const gA = (signum(gD) * 400 * gAF) / (gAF + 27.13);
  const bA = (signum(bD) * 400 * bAF) / (bAF + 27.13);
  const a = (11 * rA - 12 * gA + bA) / 11;
  const b = (rA + gA - 2 * bA) / 9;
  const u = (20 * rA + 20 * gA + 21 * bA) / 20;
  const p2 = (40 * rA + 20 * gA + bA) / 20;
  const hue = sanitizeHue((Math.atan2(b, a) * 180) / Math.PI);
  const ac = p2 * view.nbb;
  const j = 100 * (ac / view.aw) ** (view.c * view.z);
  const huePrime = hue < 20.14 ? hue + 360 : hue;
  const eHue = 0.25 * (Math.cos((huePrime * Math.PI) / 180 + 2) + 3.8);
  const p1 = (50000 / 13) * eHue * view.nc * view.ncb;
  const t = (p1 * Math.hypot(a, b)) / (u + 0.305);
  const alpha = t ** 0.9 * (1.64 - 0.29 ** view.n) ** 0.73;
  return { h: hue, c: alpha * Math.sqrt(j / 100), j };
}

function argbFromCam16(hue: number, chroma: number, j: number) {
  const alpha = chroma === 0 || j === 0 ? 0 : chroma / Math.sqrt(j / 100);
  const t = (alpha / (1.64 - 0.29 ** view.n) ** 0.73) ** (1 / 0.9);
  const hRad = (hue * Math.PI) / 180;
  const eHue = 0.25 * (Math.cos(hRad + 2) + 3.8);
  const ac = view.aw * (j / 100) ** (1 / view.c / view.z);
  const p1 = eHue * (50000 / 13) * view.nc * view.ncb;
  const p2 = ac / view.nbb;
  const gamma =
    (23 * (p2 + 0.305) * t) / (23 * p1 + 11 * t * Math.cos(hRad) + 108 * t * Math.sin(hRad));
  const a = gamma * Math.cos(hRad);
  const b = gamma * Math.sin(hRad);
  const rA = (460 * p2 + 451 * a + 288 * b) / 1403;
  const gA = (460 * p2 - 891 * a - 261 * b) / 1403;
  const bA = (460 * p2 - 220 * a - 6300 * b) / 1403;
  const toC = (value: number) =>
    signum(value) *
    (100 / view.fl) *
    Math.max(0, (27.13 * Math.abs(value)) / (400 - Math.abs(value))) ** (1 / 0.42);
  const rF = toC(rA) / view.rgbD[0];
  const gF = toC(gA) / view.rgbD[1];
  const bF = toC(bA) / view.rgbD[2];
  return argbFromXyz(
    1.86206786 * rF - 1.01125463 * gF + 0.14918677 * bF,
    0.38752654 * rF + 0.62144744 * gF - 0.00897398 * bF,
    -0.0158415 * rF - 0.03412294 * gF + 1.04996444 * bF,
  );
}

function argbFromLstar(lstar: number) {
  const y = yFromLstar(lstar);
  const channel = delinearized(y);
  return ((255 << 24) | (channel << 16) | (channel << 8) | channel) >>> 0;
}

function matchTone(hue: number, chroma: number, tone: number) {
  const yTarget = yFromLstar(tone);
  let low = 0;
  let high = 100;
  let argb = argbFromLstar(tone);
  for (let step = 0; step < 16; step++) {
    const j = (low + high) / 2;
    argb = argbFromCam16(hue, chroma, j);
    if (xyzFromArgb(argb)[1] < yTarget) low = j;
    else high = j;
  }
  return argb;
}

function argbFromHex(hex: string) {
  return (0xff000000 | parseInt(hex.slice(1, 7), 16)) >>> 0;
}

function hexFromArgb(argb: number) {
  return `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
}

export function hueDistance(left: number, right: number) {
  return Math.min(Math.abs(left - right), 360 - Math.abs(left - right));
}

export function hctFromHex(hex: string): Hct {
  const argb = argbFromHex(hex);
  const cam = cam16FromArgb(argb);
  return { h: cam.h, c: cam.c, t: lstarFromY(xyzFromArgb(argb)[1]) };
}

export function hexFromHct(hue: number, chroma: number, tone: number): string {
  const h = sanitizeHue(hue);
  const t = clamp(0, tone, 100);
  if (chroma < 1e-4 || t < 0.01 || t > 99.99) return hexFromArgb(argbFromLstar(t));
  let remaining = chroma;
  let best = argbFromLstar(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    const argb = matchTone(h, remaining, t);
    const got = hctFromHex(hexFromArgb(argb));
    if (Math.abs(got.t - t) < 1.2 && hueDistance(got.h, h) < 4) {
      best = argb;
      if (got.c >= remaining - 1.2 || remaining < 0.8) break;
    }
    remaining *= 0.82;
  }
  return hexFromArgb(best);
}

export function shiftHexHue(hex: string, deltaHue: number): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return hex;
  const hct = hctFromHex(`#${match[1]}`);
  const shifted = hexFromHct(hct.h + deltaHue, hct.c, hct.t);
  return match[2] ? `${shifted}${match[2].toLowerCase()}` : shifted;
}
