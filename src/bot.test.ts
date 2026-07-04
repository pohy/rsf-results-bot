import { expect, test } from "bun:test";
import { chunkLines } from "./bot.js";

test("chunkLines keeps chunks within the limit and preserves order", () => {
  const lines = ["aaa", "bbb", "ccc", "ddd"];
  // limit 7 fits two 3-char lines joined by "\n" (7 chars) but not three.
  const chunks = chunkLines(lines, 7);
  expect(chunks).toEqual(["aaa\nbbb", "ccc\nddd"]);
  for (const chunk of chunks) {
    expect(chunk.length).toBeLessThanOrEqual(7);
  }
});

test("chunkLines emits an over-limit line as its own chunk", () => {
  expect(chunkLines(["short", "waytoolongline"], 6)).toEqual(["short", "waytoolongline"]);
});

test("chunkLines returns one chunk when everything fits", () => {
  expect(chunkLines(["a", "b"], 2000)).toEqual(["a\nb"]);
});
