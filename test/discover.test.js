"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const decode = value => value.replaceAll("&amp;", "&");

test("DC1: discovery assets, downloads and local links exist in the public deployment", () => {
  const html = read("discover.html");
  const origin = "https://hackinglab.online/discover.html";
  const deploy = read(".github/workflows/deploy-pages.yml");
  const publicFiles = new Set(["index.html", "list.html", "discover.html", "404.html", "CNAME"]);
  const publicDirs = new Set(["css", "js", "data", "favicon", "assets"]);
  const publicIds = new Set(JSON.parse(read("data/tools.json")).tools.filter(tool => tool.hub !== false).map(tool => tool.id));
  for (const [, value] of html.matchAll(/\b(?:href|src|poster)="([^"]+)"/g)) {
    const url = new URL(decode(value), origin);
    if (url.origin !== new URL(origin).origin) continue;
    const file = decodeURIComponent(url.pathname).replace(/^\//, "") || "index.html";
    assert.ok(publicFiles.has(file) || publicDirs.has(file.split("/")[0]), `Not in deployment: ${file}`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `Missing local resource: ${file}`);
    if (file === "discover.html" && url.hash) assert.ok(html.includes(`id="${url.hash.slice(1)}"`), `Missing section: ${url.hash}`);
    if (file === "index.html" && url.searchParams.has("tools")) {
      const ids = url.searchParams.get("tools").split(",");
      for (const id of ids) assert.ok(publicIds.has(id), `Unknown collection tool: ${id}`);
      if (url.hash) assert.ok(ids.includes(url.hash.slice(1)), `Focused tool is outside its collection: ${url.hash}`);
    }
  }
  assert.match(deploy, /cp index\.html list\.html discover\.html 404\.html CNAME _site\//);
  assert.match(deploy, /cp -R css js data favicon assets _site\//);
  assert.match(deploy, /find index\.html list\.html discover\.html 404\.html CNAME css js data favicon assets -type l/);
});

test("DC2: public social previews are real 1200 by 630 PNG files", () => {
  for (const file of ["index.html", "discover.html"]) {
    const html = read(file);
    const raw = html.match(/<meta property="og:image" content="([^"]+)"/);
    assert.ok(raw, file);
    const url = new URL(raw[1]);
    assert.equal(url.origin, "https://hackinglab.online");
    assert.ok(url.pathname.startsWith("/assets/social/"));
    const png = fs.readFileSync(path.join(ROOT, url.pathname));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    assert.ok(png.length < 1500000, "Keep social images reasonably small");
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
  }
});

test("DC3: discovery remains a local, readable page with opt-in media", () => {
  const html = read("discover.html");
  assert.match(html, /default-src 'none'/);
  assert.match(html, /media-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline|\son\w+\s*=|\sstyle\s*=/i);
  assert.doesNotMatch(html, /<iframe\b|<video[^>]*\bautoplay\b/i);
  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(attrs, /src="\.\/js\//);
    assert.equal(body.trim(), "");
  }
  const video = html.match(/<video\b[^>]*>/);
  assert.ok(video);
  assert.match(video[0], /\bcontrols\b/);
  assert.match(video[0], /preload="none"/);
  const tools = JSON.parse(read("data/tools.json")).tools;
  for (const id of ["day023", "day075", "day128"]) {
    const tool = tools.find(item => item.id === id);
    assert.ok(tool && tool.hub !== false);
    assert.ok(html.includes(tool.demo_url), `No direct demo for ${id}`);
    assert.ok(html.includes(tool.title), `No readable title for ${id}`);
  }
});
