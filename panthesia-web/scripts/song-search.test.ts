import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSongSearch, matchesSongSearch } from "../src/features/library/songSearch.ts";

const song = {
  title: "Look at the Sky", composer: "Porter Robinson", arranger: "练习改编", artist: "",
  collection: "", tags: "电子 练习", difficulty: "中级", notes: "",
  path: "D:\\Music\\MIDI\\Look at the Sky.mid", source: "本地 原始演奏",
};

test("field predicates combine with phrases and exclusions", () => {
  assert.equal(matchesSongSearch(song, parseSongSearch('composer:"Porter Robinson" tags:练习 "the sky" -tags:古典')), true);
  assert.equal(matchesSongSearch(song, parseSongSearch('composer:Sky')), false);
  assert.equal(matchesSongSearch(song, parseSongSearch('arranger:练习改编')), true);
  assert.equal(matchesSongSearch(song, parseSongSearch('-composer:Porter')), false);
  assert.equal(matchesSongSearch(song, parseSongSearch('tags:练习 composer:Beethoven')), false);
});

test("explicit predicates override the selected default field", () => {
  assert.equal(matchesSongSearch(song, parseSongSearch('Sky composer:Porter'), "title"), true);
  assert.equal(matchesSongSearch(song, parseSongSearch('Porter'), "title"), false);
  assert.equal(matchesSongSearch(song, parseSongSearch('Porter'), "all"), true);
});

test("Windows paths, unknown prefixes and incomplete input remain literal", () => {
  assert.equal(matchesSongSearch(song, parseSongSearch('"D:\\Music\\MIDI"')), true);
  assert.deepEqual(parseSongSearch('custom:"a b"'), [{text: "custom:a b", exclude: false}]);
  assert.deepEqual(parseSongSearch('composer:"Porter Robinson'), [{text: "porter robinson", exclude: false, field: "composer"}]);
  assert.deepEqual(parseSongSearch(' - composer: "" '), []);
});

test("empty queries and Unicode search preserve ordinary browsing", () => {
  assert.equal(matchesSongSearch(song, []), true);
  assert.equal(matchesSongSearch(song, parseSongSearch('练习 中级')), true);
  assert.equal(matchesSongSearch(song, parseSongSearch('-"原始演奏"')), false);
  assert.equal(matchesSongSearch(song, parseSongSearch('COMPOSER:PORTER')), true);
});
