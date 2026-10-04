#!/usr/bin/env node
// Builds dist/module.zip (files at the zip root, as Foundry expects) and dist/module.json.
//   node tools/package.mjs [--version 0.3.0] [--repo user/planar-codex]
// Without --repo the URLs from module.json are kept (local test builds).
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { crc32 } from "../scripts/zip.mjs";
import { stamp } from "./stamp-manifest.mjs";

/** What ships: only what Foundry loads at runtime, plus the docs users read. */
export const SHIP = ["scripts", "styles", "lang", "lib", "README.md", "LICENSE", "CHANGELOG.md"];

export function listFiles(root = ".") {
  const out = [];
  const walk = p => {
    if ( statSync(p).isDirectory() ) for ( const name of readdirSync(p).sort() ) walk(join(p, name));
    else out.push(relative(root, p).split(sep).join("/"));
  };
  for ( const item of SHIP ) if ( existsSync(join(root, item)) ) walk(join(root, item));
  return out;
}

/** A deflate ZIP (Node only). */
export function deflateZip(files) {
  const enc = new TextEncoder();
  const local = [], central = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const day = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for ( const f of files ) {
    const name = enc.encode(f.path);
    const raw = typeof f.data === "string" ? enc.encode(f.data) : new Uint8Array(f.data);
    const packed = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(day, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(name.length, 26);
    local.push(head, Buffer.from(name), packed);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(day, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, Buffer.from(name));
    offset += 30 + name.length + packed.length;
  }
  const cenSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

if ( process.argv[1] === fileURLToPath(import.meta.url) ) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const manifest = JSON.parse(readFileSync("module.json", "utf8"));
  const version = arg("version") ?? manifest.version;
  const repo = arg("repo");
  const out = repo ? stamp(manifest, { version, repo }) : { ...manifest, version };
  const json = JSON.stringify(out, null, 2) + "\n";
  rmSync("dist", { recursive: true, force: true });
  mkdirSync("dist", { recursive: true });
  writeFileSync("dist/module.json", json);
  const files = [{ path: "module.json", data: json }, ...listFiles().map(p => ({ path: p, data: readFileSync(p) }))];
  const zip = deflateZip(files);
  writeFileSync("dist/module.zip", zip);
  console.log(`dist/module.zip (${files.length} files, ${(zip.length / 1024).toFixed(0)} KB) + dist/module.json (v${version})`);
}
