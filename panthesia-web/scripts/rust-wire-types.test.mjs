import test from "node:test";
import assert from "node:assert/strict";
import { domainDeclaration, splitTopLevel } from "./rust-wire-types.mjs";
const types = rust => ({ u8: "number", u64: "number", String: "string", "Option<String>": "string | null", "Vec<u8>": "Array<number>" }[rust] ?? (() => { throw Error(`unknown: ${rust}`); })());
test("serde field names, defaults and options follow the Rust input contract", () => {
  const source = `#[derive(Serialize, Deserialize)] #[serde(rename_all = "camelCase")] pub struct Input {
    /// Preserved default is an input omission, not a nullable numeric value.
    #[serde(default = "default_rate")] pub rate_milli: u64,
    #[serde(rename = "displayTitle")] pub title: Option<String>,
    pub count: u8,
  }`;
  assert.equal(domainDeclaration(source, "Input", types), `export interface Input {\n  "rateMilli"?: number;\n  "displayTitle"?: string | null;\n  "count": number;\n}`);
});
test("unit enums retain serde names and provide checked UI values", () => {
  const source = `#[serde(rename_all = "snake_case")] pub enum Hand { LeftHand, #[default] RightHand, #[serde(rename = "other")] Unspecified }`;
  assert.equal(domainDeclaration(source, "Hand", types), `export const HandValues = ["left_hand", "right_hand", "other"] as const;\nexport type Hand = typeof HandValues[number];`);
});
test("container defaults and omitted empty collections stay optional", () => {
  const source = `#[serde(default)] pub struct Input { pub count: u8, #[serde(default, skip_serializing_if = "Vec::is_empty")] pub values: Vec<u8> }`;
  assert.match(domainDeclaration(source, "Input", types), /"count"\?: number/);
  assert.match(domainDeclaration(source, "Input", types), /"values"\?: Array<number>/);
});
test("comments do not add fields or corrupt string literals", () => {
  const source = `/* outer /* nested */ comment */ pub enum Source { // first variant\n #[serde(rename = "https://example.test")] Local }`;
  assert.match(domainDeclaration(source, "Source", types), /"https:\/\/example.test"/);
});
test("new serde shapes and conditional members require an explicit migration", () => {
  for (const source of [
    `#[serde(untagged)] pub enum Input { One }`,
    `pub struct Input { #[serde(flatten)] pub nested: String }`,
    `pub struct Input { #[cfg(test)] pub hidden: u8 }`,
    `pub struct Input { #[serde(skip_serializing_if = "custom")] pub count: u8 }`,
    `#[serde(rename_all = "UPPERCASE")] pub enum Input { One }`,
  ]) assert.throws(() => domainDeclaration(source, "Input", types), /Unsupported/);
});
test("unknown nested types, data enums and incomplete declarations fail generation", () => {
  assert.throws(() => domainDeclaration(`pub struct Input { pub nested: NewDomain }`, "Input", types), /unknown/);
  assert.throws(() => domainDeclaration(`pub enum Input { Value(u8) }`, "Input", types), /data variant/);
  assert.throws(() => domainDeclaration(`pub struct Input { pub count: u8`, "Input", types), /Unterminated/);
  assert.throws(() => domainDeclaration(`pub struct Other { pub count: u8 }`, "Input", types), /missing/);
});
test("nested tuples and strings retain their original field boundaries", () => {
  assert.deepEqual(splitTopLevel(`Vec<(u8, u8)>, #[serde(rename = "x,y")] value: String`), ["Vec<(u8, u8)>", '#[serde(rename = "x,y")] value: String']);
  assert.throws(() => splitTopLevel("Option<Vec<u8>"), /Unbalanced/);
});

test("responses keep nullable and defaulted fields required unless serialization omits them", () => {
  const source = `pub struct Response { pub selected: Option<String>, #[serde(default)] pub count: u8, #[serde(default, skip_serializing_if = "Vec::is_empty")] pub values: Vec<u8> }`;
  assert.equal(domainDeclaration(source, "Response", types, "output"), `export interface Response {\n  "selected": string | null;\n  "count": number;\n  "values"?: Array<number>;\n}`);
  assert.throws(() => domainDeclaration(source, "Response", types, "ouptut"), /direction/);
});
test("serde input includes private fields and uses their declared wire names", () => {
  const source = `#[serde(rename_all = "camelCase")] pub struct Action { before_track: u8, pub(crate) at_tick: u64 }`;
  assert.match(domainDeclaration(source, "Action", types), /"beforeTrack": number/);
  assert.match(domainDeclaration(source, "Action", types), /"atTick": number/);
});

test("output omission removes only the outer Option and preserves an explicit inner null", () => {
  const types = rust => ({ "u8": "number", "Option<u8>": "number | null" }[rust] ?? (() => { throw Error(rust); })());
  const source = `pub struct Output { #[serde(skip_serializing_if = "Option::is_none")] pub position: Option<u8>, #[serde(skip_serializing_if = "Option::is_none")] pub nested: Option<Option<u8>> }`;
  assert.equal(domainDeclaration(source, "Output", types, "output"), `export interface Output {\n  "position"?: number;\n  "nested"?: number | null;\n}`);
  assert.throws(() => domainDeclaration(`pub struct Output { #[serde(skip_serializing_if = "Option::is_none")] pub value: u8 }`, "Output", types, "output"), /Option omission/);
});
