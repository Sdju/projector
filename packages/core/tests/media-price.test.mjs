import { expect, test } from "vite-plus/test";
import {
  formatMediaPrice,
  mediaModalityTitle,
  mediaPriceUnitTitle,
} from "../modules/media/index.ts";

const price = (value = {}) => ({ amount: 0.006, currency: "USD", unit: "minute", ...value });

test("prices are formatted for people, with the unit and the tier", () => {
  expect(formatMediaPrice(price({}))).toBe("$0,006 / минута");
  expect(formatMediaPrice(price({ amount: 0.04, unit: "image", variant: "1K" }))).toBe(
    "$0,04 / изображение (1K)",
  );
  expect(formatMediaPrice(price({ amount: 15, unit: "1m-characters" }))).toBe(
    "$15 / 1 млн символов",
  );
  expect(formatMediaPrice(price({ amount: 0.15, unit: "1m-tokens", appliesTo: "input" }))).toBe(
    "$0,15 / 1 млн токенов (вход)",
  );
  expect(formatMediaPrice(price({ amount: 0.1, unit: "second", variant: "720P" }))).toBe(
    "$0,1 / секунда (720P)",
  );
});

test("another locale keeps its decimal separator", () => {
  expect(formatMediaPrice(price({}), "en-US")).toBe("$0.006 / минута");
});

test("an estimated rate says so, and other currencies keep their code", () => {
  expect(formatMediaPrice(price({ amount: 0.003, estimated: true }))).toContain("· оценка");
  expect(formatMediaPrice(price({ amount: 0.11, currency: "EUR", unit: "request" }))).toBe(
    "€0,11 / запрос",
  );
  expect(formatMediaPrice(price({ amount: 2, currency: "CNY", unit: "request" }))).toBe(
    "¥2 / запрос",
  );
  expect(formatMediaPrice(price({ amount: 1, currency: "XYZ", unit: "request" }))).toBe(
    "1 XYZ / запрос",
  );
});

test("units and modalities have Russian titles", () => {
  expect(mediaPriceUnitTitle("minute")).toBe("минута");
  expect(mediaPriceUnitTitle("10k-characters")).toBe("10 тыс. символов");
  expect(mediaModalityTitle("audio")).toBe("звук");
  expect(mediaModalityTitle("video")).toBe("видео");
});
