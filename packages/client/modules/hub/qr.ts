import { renderSVG } from "uqr";

/** Black-on-white SVG for phone cameras; quiet zone is part of the matrix. */
export function loginQrSvg(url: string): string {
  return renderSVG(url, { ecc: "M", border: 4, pixelSize: 8 });
}
