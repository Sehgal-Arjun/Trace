import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saysItUsedToWork } from "./run.ts";

describe("saysItUsedToWork", () => {
  it("recognizes reports of something that broke", () => {
    for (const text of [
      "It used to pick up Chinese automatically",
      "This worked fine in the previous version.",
      "Since we upgraded, nobody can sign up",
      "After the latest update, our Postgres steps return the wrong thing",
      "The save button no longer does anything",
      "Reports stopped updating last week",
    ]) assert.equal(saysItUsedToWork(text), true, text);
  });
  it("doesn't fire on plain bug descriptions", () => {
    for (const text of ["Clicking save empties the cart", "The date picker shows the wrong month", "Exports are missing the header row"]) {
      assert.equal(saysItUsedToWork(text), false, text);
    }
  });
});
