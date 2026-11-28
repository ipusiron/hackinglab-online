"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const catalog = JSON.parse(read("data/tools.json"));

// A small DOM/history/clock model for the actual browser scripts, not their CJS API.
// It deliberately does not model layout, CSS, accessibility trees or print pagination.
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentNode = null; this.attrs = new Map(); this.dataset = {};
    this.listeners = new Map(); this.hidden = false; this.disabled = false;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  contains(node) { for (let p = node; p; p = p.parentNode) if (p === this) return true; return false; }
  replaceChildren(...children) {
    if (this !== this.ownerDocument.activeElement && this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    this.children.forEach(child => { child.parentNode = null; }); this.children = [];
    children.forEach(child => this.appendChild(child));
  }
  get textContent() { return this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this.appendChild({ textContent: String(value), parentNode: this }); }
  set innerHTML(_) { throw new Error("Handout content must not be inserted as HTML"); }
  setAttribute(key, value) {
    this.attrs.set(key, String(value));
    if (key.startsWith("data-")) this.dataset[key.slice(5)] = String(value);
  }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []; listeners.push(listener); this.listeners.set(type, listeners);
  }
  focus() { this.ownerDocument.activeElement = this; }
  click() {
    if (this.disabled) return;
    for (const listener of this.listeners.get("click") || []) listener({ target: this, currentTarget: this });
  }
}
const descendants = node => node.children.flatMap(child => child instanceof Element ? [child, ...descendants(child)] : []);
const response = (data = catalog) => ({ ok: true, status: 200, json: async () => structuredClone(data) });
const flush = async () => { await new Promise(setImmediate); };

function page({ search = "?tools=day003&lang=en", fetches = [() => response()], stored = {}, storageThrows = false } = {}) {
  const document = { title: "", activeElement: null };
  document.body = new Element("body", document); document.activeElement = document.body;
  document.documentElement = new Element("html", document); document.documentElement.lang = "ja";
  document.createElement = tag => new Element(tag, document);
  const nodes = new Map();
  const html = read("print.html");
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const node = document.createElement(match[1]); node.id = match[3];
    node.hidden = /\bhidden\b/.test(match[2]); node.disabled = /\bdisabled\b/.test(match[2]);
    const tabindex = /\btabindex="([^"]+)"/.exec(match[2]); if (tabindex) node.setAttribute("tabindex", tabindex[1]);
    nodes.set(node.id, node); document.body.appendChild(node);
  }
  const languageButtons = [...html.matchAll(/<button\b[^>]*\bdata-lang="(ja|en)"[^>]*>/g)].map(match => {
    const button = document.createElement("button"); button.dataset.lang = match[1]; document.body.appendChild(button); return button;
  });
  document.getElementById = id => nodes.get(id) || null;
  document.querySelectorAll = selector => {
    assert.equal(selector, "[data-lang]", "Add real support if the production script needs another selector");
    return languageButtons;
  };
  const events = new Map(), timers = new Map(), requests = [], storageCalls = [], values = new Map(Object.entries(stored));
  const entries = ["https://hackinglab.online/print.html" + search]; let position = 0, timerId = 0, now = 0, printed = 0;
  const context = vm.createContext({ document, URL, URLSearchParams, AbortController, console,
    location: new URL(entries[0]),
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, listener) { const all = events.get(type) || []; all.push(listener); events.set(type, all); },
    fetch(url, options) {
      requests.push({ url, options });
      assert.equal(url, "./data/tools.json", "The handout must only request its public catalog");
      const next = fetches[requests.length - 1]; assert.ok(next, "Unexpected additional fetch");
      return Promise.resolve().then(() => next(options));
    },
    print() { printed++; }
  });
  Object.defineProperty(context, "localStorage", { get() {
    if (storageThrows) throw new Error("Storage is unavailable");
    return {
      getItem(key) { storageCalls.push(["get", key]); return values.get(key) ?? null; },
      setItem(key, value) { storageCalls.push(["set", key]); values.set(key, String(value)); }
    };
  }});
  const go = delta => {
    const next = position + delta; if (next < 0 || next >= entries.length) return;
    position = next; context.location = new URL(entries[position]);
    for (const listener of events.get("popstate") || []) listener({ type: "popstate" });
  };
  context.history = {
    pushState(_state, _title, url) { const next = new URL(url, context.location.href).href; entries.splice(++position); entries.push(next); context.location = new URL(next); },
    replaceState(_state, _title, url) { entries[position] = new URL(url, context.location.href).href; context.location = new URL(entries[position]); },
    back() { go(-1); }, forward() { go(1); }
  };
  for (const file of ["js/lang.js", "js/url.js", "js/preparation.js", "js/print.js"]) vm.runInContext(read(file), context, { filename: file });
  return {
    document, context, requests, values, storageCalls, entries,
    el: id => nodes.get(id),
    language: lang => languageButtons.find(button => button.dataset.lang === lang),
    ids: () => nodes.get("handout-list").children.map(node => node.dataset.toolId),
    get printed() { return printed; },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    }
  };
}

test("real initial handout URL fetches its catalog, renders the selection and enables explicit printing", async () => {
  let release;
  const p = page({ search: "?tools=day007,day003&lang=en&q=private-query#private-fragment", fetches: [() => new Promise(resolve => { release = resolve; })], stored: { progress_example: "3", later_day077: "1" } });
  assert.equal(p.el("handout-print").disabled, true);
  assert.equal(p.el("handout-list").getAttribute("aria-busy"), "true");
  await flush(); assert.equal(p.requests.length, 1); release(response()); await flush();
  assert.deepEqual(p.ids(), ["day007", "day003"]);
  assert.match(p.el("handout-list").textContent, /Day003.*Caesar/);
  assert.match(p.el("handout-list").textContent, /HELLO/);
  assert.equal(p.el("handout-print").disabled, false);
  assert.equal(p.el("handout-list").getAttribute("aria-busy"), "false");
  assert.equal(p.printed, 0); p.el("handout-print").click(); assert.equal(p.printed, 1);
  assert.deepEqual([...p.context.location.searchParams.keys()], ["tools", "lang"]);
  assert.equal(p.context.location.hash, "");
  assert.doesNotMatch(p.document.body.textContent, /private-query|private-fragment|progress_example|later_day077/);
  assert.equal(p.storageCalls.some(([, key]) => /^(progress_|later_)/.test(key)), false);
});

test("HTTP and parse failures retain retry, with keyboard focus restored after each attempt", async () => {
  const p = page({ fetches: [() => ({ ok: false, status: 500 }), () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Invalid JSON"); } }), () => response()] });
  await flush();
  assert.equal(p.el("handout-retry").hidden, false); assert.equal(p.el("handout-print").disabled, true);
  p.el("handout-retry").focus(); p.el("handout-retry").click();
  assert.equal(p.document.activeElement, p.el("handout-status"));
  assert.equal(p.el("handout-status").getAttribute("tabindex"), "-1");
  await flush();
  assert.equal(p.document.activeElement, p.el("handout-retry"));
  assert.equal(p.el("handout-retry").hidden, false);
  p.el("handout-retry").click(); await flush();
  assert.equal(p.document.activeElement, p.el("handout-print"));
  assert.equal(p.el("handout-print").disabled, false); assert.deepEqual(p.ids(), ["day003"]);
});

test("the twelve-second deadline bounds both unresponsive fetch and JSON decoding, without late overwrite", async t => {
  for (const stage of ["fetch", "json"]) await t.test(stage, async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const p = page({ fetches: [() => stage === "fetch" ? pending : { ok: true, status: 200, json: () => pending }, () => response()] });
    await flush(); p.advance(11999); await flush();
    assert.equal(p.el("handout-list").getAttribute("aria-busy"), "true");
    p.advance(1); await flush();
    assert.equal(p.requests[0].options.signal.aborted, true);
    assert.equal(p.el("handout-list").getAttribute("aria-busy"), "false");
    assert.equal(p.el("handout-retry").hidden, false); assert.equal(p.el("handout-print").disabled, true);
    p.el("handout-retry").focus(); p.el("handout-retry").click(); await flush();
    assert.deepEqual(p.ids(), ["day003"]); assert.equal(p.el("handout-print").disabled, false);
    const empty = { schema_version: 1, tools: [] }; release(stage === "fetch" ? response(empty) : empty); await flush();
    assert.deepEqual(p.ids(), ["day003"], "A response arriving after its deadline cannot replace a successful retry");
  });
});

test("authorization failures stop and malformed catalogs fail without a partial handout", async t => {
  await t.test("401", async () => {
    const p = page({ fetches: [() => ({ ok: false, status: 401 })] }); await flush();
    assert.match(p.el("handout-status").textContent, /authorization/i);
    assert.equal(p.el("handout-retry").hidden, true); assert.equal(p.el("handout-print").disabled, true);
    assert.equal(p.requests.length, 1); assert.deepEqual(p.ids(), []);
  });
  await t.test("invalid catalog", async () => {
    const p = page({ fetches: [() => response({ schema_version: 1, tools: [{ id: "day003", title: "" }] })] }); await flush();
    assert.equal(p.el("handout-retry").hidden, false); assert.deepEqual(p.ids(), []); assert.equal(p.el("handout-print").disabled, true);
  });
});

test("explicit language and Back/Forward work when saving the language is unavailable", async () => {
  const p = page({ search: "?tools=day003&lang=ja&unknown=private", storageThrows: true }); await flush();
  assert.equal(p.document.documentElement.lang, "ja");
  assert.match(p.el("handout-source").textContent, /lang=ja/);
  p.language("en").focus(); p.language("en").click();
  assert.equal(p.document.documentElement.lang, "en"); assert.equal(p.context.location.searchParams.get("lang"), "en");
  assert.equal(p.language("en").getAttribute("aria-pressed"), "true");
  assert.deepEqual(p.ids(), ["day003"]);
  p.context.history.back(); await flush();
  assert.equal(p.document.documentElement.lang, "ja"); assert.match(p.el("handout-source").textContent, /lang=ja/);
  p.context.history.forward(); await flush();
  assert.equal(p.document.documentElement.lang, "en"); assert.equal(p.requests.length, 1);
  assert.equal(p.entries.some(entry => entry.includes("private")), false);
});

test("catalog markup remains text and unsafe destinations never become links", async () => {
  const data = structuredClone(catalog); const tool = data.tools.find(tool => tool.id === "day003");
  tool.title = '<img src=x onerror="alert(1)">'; tool.description_en = '<script>alert("text")</script>';
  tool.demo_url = "javascript:alert(1)"; tool.repo_url = "https://user:secret@github.com/ipusiron/example";
  const p = page({ fetches: [() => response(data)] }); await flush();
  assert.ok(p.el("handout-list").textContent.includes(tool.title));
  assert.ok(p.el("handout-list").textContent.includes(tool.description_en));
  assert.equal(descendants(p.el("handout-list")).some(node => ["SCRIPT", "IMG", "A"].includes(node.tagName)), false);
  assert.doesNotMatch(p.el("handout-list").textContent, /user:secret|javascript:/);
  assert.equal(p.el("handout-print").disabled, false);
});

test("runtime selection preserves order, excludes hidden and unknown tools, and caps twelve", async () => {
  const data = structuredClone(catalog); data.tools.find(tool => tool.id === "day001").hub = false;
  const publicIds = data.tools.filter(tool => tool.hub !== false).slice(0, 13).map(tool => tool.id).reverse();
  const p = page({ search: "?tools=day001,day999," + publicIds.join(",") + "," + publicIds[0] + "&lang=en", fetches: [() => response(data)] }); await flush();
  assert.deepEqual(p.ids(), publicIds.slice(0, 12));
  assert.match(p.el("handout-status").textContent, /Unavailable tools were omitted/);
  assert.match(p.el("handout-status").textContent, /first 12/);
  assert.equal(p.context.location.searchParams.get("tools"), publicIds.slice(0, 12).join(","));
  assert.equal(descendants(p.el("handout-list")).some(node => ["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName)), false);
  const empty = page({ search: "?tools=day999&lang=ja" }); await flush();
  assert.deepEqual(empty.ids(), []); assert.equal(empty.el("handout-print").disabled, true);
  assert.equal(empty.el("handout-source").hidden, true);
});
