import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize, relevance, resolve } from "../src/search.ts";

test("normalize: no accents, no capitals, no spaces around", () => {
  assert.equal(normalize("  Énergie Électrique "), "energie electrique");
});

test("relevance: start of the name, then start of a word, then anywhere", () => {
  assert.equal(relevance("Iron Plate", "iron"), 3);
  assert.equal(relevance("Reinforced Iron Plate", "iron"), 2);
  assert.equal(relevance("Ironclad", "clad"), 1);
  assert.equal(relevance("Copper Wire", "iron"), 0);
  assert.equal(relevance("Anything", ""), 1);
});

const places = [
  { id: "station:1", name: "Iron Station" },
  { id: "station:2", name: "Copper Station" },
  { id: "hub", name: "HUB" },
  { id: "marker:1", name: "Iron Station" },
];
const find = (typed: string) => resolve(places, typed, (p) => p.id, (p) => p.name);

test("resolve: an identifier wins over names", () => {
  assert.equal(find("marker:1").found?.id, "marker:1");
});

test("resolve: exact name, accents and capitals ignored", () => {
  assert.equal(find("hüb").found?.id, "hub");
});

test("resolve: the only name containing the text", () => {
  assert.equal(find("copper").found?.id, "station:2");
});

test("resolve: several names contain the text, each name listed once", () => {
  assert.deepEqual(find("station"), { ambiguous: ["Iron Station", "Copper Station"] });
});

test("resolve: nothing typed or nothing found", () => {
  assert.deepEqual(find(""), { ambiguous: [] });
  assert.deepEqual(find("oil"), { ambiguous: [] });
});
