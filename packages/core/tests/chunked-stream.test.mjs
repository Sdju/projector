import { Duplex } from "node:stream";
import { expect, test } from "vite-plus/test";
import { chunkedStream } from "../modules/node-http/index.ts";

test("closing the tunnel while a split write waits for drain settles the writer once", async () => {
  const frames = [];
  const transport = new Duplex({
    writableHighWaterMark: 4,
    read() {},
    write(frame) {
      frames.push(frame);
      this.destroy();
    },
  });
  const stream = chunkedStream(transport, 4);
  const errors = [];
  stream.on("error", (error) => errors.push(error));
  const closed = new Promise((resolve) => stream.once("close", resolve));
  const results = [];
  stream.write(Buffer.alloc(32), (error) => results.push(error));
  await closed;
  expect(frames.map((frame) => frame.length)).toEqual([4]);
  expect(results).toEqual([expect.objectContaining({ message: "Туннель закрыт" })]);
  expect(errors.length).toBeLessThanOrEqual(1);
  expect(transport.listenerCount("drain")).toBe(0);
});
