import { expect, test } from "vite-plus/test";
import { concatPcm, downsamplePcm, encodeWav } from "../modules/dictation/index.ts";

test("PCM is downsampled without aliasing adjacent samples", () => {
  const result = downsamplePcm(new Float32Array([1, 0, 0, -1, 0, 0]), 48_000, 16_000);
  expect(result).toHaveLength(2);
  expect(result[0]).toBeCloseTo(1 / 3);
  expect(result[1]).toBeCloseTo(-1 / 3);
  expect(concatPcm([result, result], 4)).toEqual(new Float32Array([...result, ...result]));
});

test("WAV is mono 16-bit PCM with the requested sample rate", () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16_000);
  expect(wav.byteLength).toBe(52);
  const bytes = new Uint8Array(wav);
  const view = new DataView(wav);
  const text = (from, length) => String.fromCharCode(...bytes.slice(from, from + length));
  expect(text(0, 4)).toBe("RIFF");
  expect(text(8, 4)).toBe("WAVE");
  expect(view.getUint16(20, true)).toBe(1);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(16_000);
  expect(view.getUint16(34, true)).toBe(16);
  expect(view.getInt16(44, true)).toBe(0);
  expect(view.getInt16(46, true)).toBe(32767);
  expect(view.getInt16(48, true)).toBe(-32768);
  expect(view.getInt16(50, true)).toBe(16383);
});
