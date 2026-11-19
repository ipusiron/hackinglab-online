"use strict";
// DOM/history integration tests: no CSS layout or accessibility tree. History and events are modeled explicitly.
// Unsupported DOM APIs fail normally; do not add a Proxy that silently supplies no-op methods.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" }[e];
});
const descendants = (node) => node.childNodes.flatMap((n) => n.nodeType === 1 ? [n, ...descendants(n)] : []);
function matchesSimple(node, selector) {
  if (node.nodeType !== 1) return false;
  let ok = true;
  let rest = selector.replace(/:not\(([^()]+)\)/g, (_, s) => { ok &&= !matchesSimple(node, s); return ""; });
  rest = rest.replace(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g, (_, name, value) => {
    ok &&= value === undefined ? node.hasAttribute(name) : node.getAttribute(name) === value;
    return "";
  });
  rest = rest.replace(/([.#])([\w-]+)/g, (_, type, name) => {
    ok &&= type === "#" ? node.id === name : node.classList.contains(name);
    return "";
  });
  assert.match(rest, /^(?:[\w-]+|\*)?$/, `Unsupported selector: ${selector}`);
  return ok && (!rest || rest === "*" || node.tagName === rest.toUpperCase());
}
function matches(node, selector) {
  return selector.split(/\s*,\s*/).some((part) => {
    const pieces = part.trim().split(/\s+/);
    if (!matchesSimple(node, pieces.pop())) return false;
    let ancestor = node.parentNode;
    while (pieces.length) {
      const wanted = pieces.pop();
      while (ancestor && !matchesSimple(ancestor, wanted)) ancestor = ancestor.parentNode;
      if (!ancestor) return false;
      ancestor = ancestor.parentNode;
    }
    return true;
  });
}
class Element {
  constructor(tag, document, nodeType = 1) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.nodeType = nodeType;
    this.childNodes = []; this.parentNode = null; this.attrs = new Map(); this.dataset = {};
    this.listeners = new Map(); this.style = { setProperty(k, v) { this[k] = String(v); }, removeProperty(k) { delete this[k]; } };
    this.classList = {
      contains: (s) => this.className.split(/\s+/).includes(s),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((n) => !names.includes(n)).join(" "); },
      toggle: (s, force) => { const on = force === undefined ? !this.classList.contains(s) : force; this.classList[on ? "add" : "remove"](s); return on; }
    };
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { return this.ownerDocument.contains(this); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); if (String(value)) this.appendChild(this.ownerDocument.createTextNode(String(value))); }
  set innerHTML(value) { assert.equal(value, "", "The rendering harness supports clearing innerHTML only"); this.replaceChildren(); }
  get value() { return this._value ?? (this.tagName === "SELECT" ? this.children.find((c) => c.selected)?.value ?? this.children[0]?.value ?? "" : this.getAttribute("value") ?? ""); }
  set value(v) { this._value = String(v); }
  get options() { return this.children; }
  get offsetHeight() { return 0; }
  get clientWidth() { return 1280; }
  appendChild(child) {
    if (child.nodeType === 11) { for (const n of [...child.childNodes]) this.appendChild(n); return child; }
    if (child.parentNode) child.parentNode.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1);
    this.childNodes.push(child); child.parentNode = this; return child;
  }
  replaceChildren(...children) { if (this !== this.ownerDocument.activeElement && this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body; this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; children.forEach((c) => this.appendChild(c)); }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    if (name.startsWith("data-")) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) {
    this.attrs.delete(name);
    if (name.startsWith("data-")) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
  }
  querySelectorAll(selector) { return descendants(this).filter((n) => matches(n, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let n = this; n; n = n.parentElement) if (matches(n, selector)) return n; return null; }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  getClientRects() { for (let n = this; n; n = n.parentElement) if (n.hidden) return []; return [{}]; }
  getBoundingClientRect() { return this.rect || { top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0 }; }
  addEventListener(type, listener) { const all = this.listeners.get(type) || []; all.push(listener); this.listeners.set(type, all); }
  dispatch(type, fields = {}) {
    const event = { target: this, currentTarget: this, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const fn of this.listeners.get(type) || []) fn(event);
    if (type === "click" && this.tagName === "SUMMARY" && !event.defaultPrevented) this.parentElement.open = !this.parentElement.open;
    return event;
  }
  focus(options) {
    const previous = this.ownerDocument.activeElement;
    this.ownerDocument.activeElement = this;
    (this.ownerDocument.focusCalls ||= []).push({ element: this, options });
    if (previous !== this) this.dispatch("focus", { relatedTarget: previous });
  }
  click() { if (this.disabled) return; this.ownerDocument.onElementClick?.(this); return this.dispatch("click"); }
  remove() { if (this.parentNode) { this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; } }
  select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
  scrollIntoView(options) { (this.ownerDocument.scrollCalls ||= []).push({ element: this, options }); }
}
for (const [prop, attr] of Object.entries({ id: "id", className: "class", lang: "lang", rel: "rel", target: "target", type: "type", tabIndex: "tabindex" })) {
  Object.defineProperty(Element.prototype, prop, { get() { return this.getAttribute(attr) || ""; }, set(v) { this.setAttribute(attr, v); } });
}
for (const prop of ["hidden", "open", "disabled", "selected"]) {
  Object.defineProperty(Element.prototype, prop, { get() { return this.hasAttribute(prop); }, set(v) { if (v) this.setAttribute(prop, ""); else this.removeAttribute(prop); } });
}
Object.defineProperty(Element.prototype, "href", { get() { return new URL(this.getAttribute("href") || "", this.ownerDocument.location.href).href; }, set(v) { this.setAttribute("href", v); } });
function parseHtml(html, location) {
  const document = new Element("document", null, 9); document.ownerDocument = document; document.location = location;
  document.createElement = (tag) => new Element(tag, document);
  document.createTextNode = (text) => ({ nodeType: 3, textContent: text, parentNode: null });
  document.createDocumentFragment = () => new Element("fragment", document, 11);
  document.getElementById = (id) => descendants(document).find((n) => n.id === id) || null;
  const stack = [document];
  const voids = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  for (const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      const tag = token.match(/^<\/([\w-]+)/)[1].toUpperCase();
      assert.equal(stack.pop().tagName, tag, `Unbalanced HTML closing tag ${tag}`);
    } else if (token.startsWith("<")) {
      const tag = token.match(/^<([\w-]+)/)[1].toLowerCase();
      const element = document.createElement(tag);
      const attrs = token.slice(tag.length + 1).replace(/\/?\s*>$/, "");
      for (const match of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        element.setAttribute(match[1], decode(match[2] ?? match[3] ?? match[4] ?? ""));
      }
      stack.at(-1).appendChild(element);
      if (!voids.has(tag) && !token.endsWith("/>")) stack.push(element);
    } else stack.at(-1).appendChild(document.createTextNode(decode(token)));
  }
  assert.equal(stack.length, 1, "Unclosed HTML elements");
  document.documentElement = document.querySelector("html"); document.body = document.querySelector("body"); document.head = document.querySelector("head");
  document.activeElement = document.body;
  Object.defineProperty(document, "title", { get() { return document.querySelector("title")?.textContent || ""; }, set(value) { document.querySelector("title").textContent = value; } });
  return document;
}
async function runPage({ search = "", storageFailure = "none", dataOverrides = {}, deferData = false, dataFailures = {}, clipboard = "success", storedValues = {}, allowLoadFailure = false, fetchResponse = null, clock = null, storageHooks = {}, confirmResult = false, downloadFailure = null, width = 1280 } = {}) {
  const location = new URL("https://hackinglab.online/" + search);
  const document = parseHtml(read("index.html"), location);
  const messages = []; const fetched = []; const values = new Map(Object.entries(storedValues)); const calls = { getter: 0, read: 0, write: 0 };
  const store = {
    getItem(k) { calls.read++; if (storageFailure === "read") throw new Error("storage read blocked"); if (storageHooks.read) { const result = storageHooks.read(k, values); if (result !== undefined) return result; } return values.get(k) ?? null; },
    setItem(k, v) { calls.write++; if (storageFailure === "write") throw new Error("storage full"); if (storageHooks.write) storageHooks.write(k, String(v), values); values.set(k, String(v)); }
  };
  const localFile = (url) => {
    const parsed = new URL(url, location);
    assert.equal(parsed.origin, location.origin, `Unexpected external request: ${url}`);
    const file = path.resolve(ROOT, "." + decodeURIComponent(parsed.pathname));
    assert.ok(file.startsWith(ROOT + path.sep), `Request outside project: ${url}`);
    return file;
  };
  const frames = [];
  const listeners = new Map();
  const events = [];
  const emit = (type, fields = {}) => {
    events.push(type);
    for (const listener of listeners.get(type) || []) listener({ type, ...fields });
  };
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const entries = [{ url: location.href, state: null }];
  let historyIndex = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  if (!deferData) release();
  const copied = [];
  const downloads = []; const objectUrls = new Map(); const revokedUrls = []; const confirmations = [];
  class TestURL extends URL {
    static createObjectURL(blob) { if (downloadFailure === "create") throw new Error("Download unavailable"); const url = "blob:https://hackinglab.online/" + objectUrls.size; objectUrls.set(url, blob); return url; }
    static revokeObjectURL(url) { revokedUrls.push(url); }
  }
  document.onElementClick = (element) => {
    if (element.tagName !== "A" || !element.download) return;
    if (downloadFailure === "click") throw new Error("Download rejected");
    assert.ok(objectUrls.has(element.href), "Download did not use a local Blob URL");
    downloads.push({ filename: element.download, blob: objectUrls.get(element.href), href: element.href });
  };
  const scrolls = [];
  const context = {
    document, location, URL: TestURL, URLSearchParams, AbortController, DOMException, TextEncoder, Blob,
    setTimeout: clock ? clock.setTimeout : setTimeout, clearTimeout: clock ? clock.clearTimeout : clearTimeout,
    innerWidth: width, innerHeight: 900, scrollY: 0,
    matchMedia: (query) => {
      const bound = /\((min|max)-width:\s*([\d.]+)px\)/.exec(query);
      return { matches: !!bound && (bound[1] === "min" ? context.innerWidth >= Number(bound[2]) : context.innerWidth <= Number(bound[2])) };
    },
    addEventListener(type, listener) { const all = listeners.get(type) || []; all.push(listener); listeners.set(type, all); },
    scrollTo(...args) { const y = typeof args[0] === "object" ? args[0].top : args[1]; context.scrollY = y; scrolls.push({ type: "to", y }); },
    scrollBy(...args) { const y = typeof args[0] === "object" ? args[0].top : args[1]; context.scrollY += y; scrolls.push({ type: "by", y }); },
    open() { throw new Error("Unexpected popup in integration test"); }, confirm: (message) => { confirmations.push(message); return typeof confirmResult === "function" ? confirmResult(message, values) : confirmResult; },
    navigator: { clipboard: { async writeText(value) { if (clipboard === "reject") throw new Error("Clipboard denied"); copied.push(value); } } },
    getComputedStyle: () => ({ position: "sticky" }),
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    performance: { mark() {} },
    history: {
      get state() { return clone(entries[historyIndex].state); },
      get length() { return entries.length; },
      scrollRestoration: "auto",
      replaceState(state, _, url) { if (url) location.href = new URL(url, location).href; entries[historyIndex] = { url: location.href, state: clone(state) }; },
      pushState(state, _, url) { if (url) location.href = new URL(url, location).href; entries.splice(historyIndex + 1); entries.push({ url: location.href, state: clone(state) }); historyIndex++; },
      go(delta) {
        const next = historyIndex + delta;
        if (next < 0 || next >= entries.length || next === historyIndex) return;
        setImmediate(() => {
          const oldURL = location.href;
          historyIndex = next;
          location.href = entries[historyIndex].url;
          emit("popstate", { state: clone(entries[historyIndex].state) });
          if (new URL(oldURL).hash !== location.hash) emit("hashchange", { oldURL, newURL: location.href });
        });
      },
      back() { this.go(-1); }, forward() { this.go(1); }
    },
    fetch: async (url, options = {}) => {
      const file = localFile(url); fetched.push(path.relative(ROOT, file).replaceAll(path.sep, "/"));
      const name = fetched.at(-1);
      await gate;
      if (fetchResponse) {
        const result = await fetchResponse(name, options, fetched.filter((item) => item === name).length);
        if (result !== undefined) return result;
      }
      if (dataFailures[name] === "reject") throw new Error("Fixture fetch failed");
      if (dataFailures[name]) return { ok: false, status: dataFailures[name] };
      const json = JSON.parse(Object.hasOwn(dataOverrides, name) ? JSON.stringify(dataOverrides[name]) : fs.readFileSync(file, "utf8"));
      return { ok: true, json: async () => json };
    },
    console: Object.fromEntries(["warn", "error", "log", "info"].map((level) => [level, (...args) => messages.push({ level, text: args.map(String).join(" ") })]))
  };
  Object.defineProperty(context, "localStorage", { get() { calls.getter++; if (storageFailure === "getter") throw new Error("storage denied"); return store; } });
  context.window = context; vm.createContext(context);
  const scripts = document.querySelectorAll("script[src]");
  assert.ok(scripts.length > 0, "No external scripts connected in index.html");
  // Parser-blocking lang.js runs before deferred main.js, despite appearing after it in HTML.
  for (const script of [...scripts.filter((s) => !s.hasAttribute("defer")), ...scripts.filter((s) => s.hasAttribute("defer"))]) {
    assert.ok(!script.hasAttribute("async"), "This deterministic harness does not model async scripts");
    const file = localFile(script.getAttribute("src"));
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: path.relative(ROOT, file), timeout: 5000 });
  }
  document.dispatch("DOMContentLoaded");
  const flush = async () => {
    await new Promise(setImmediate);
    for (let i = 0; i < 100 && frames.length; i++) frames.shift()();
    await new Promise(setImmediate);
  };
  const checkLoaded = () => {
    if (allowLoadFailure) return;
    assert.deepEqual(messages.filter((m) => m.level === "warn" || m.level === "error"), [], "Rendering reported an error/warning");
    assert.equal(document.getElementById("tool-list")?.getAttribute("aria-busy"), "false", "loadData did not finish rendering");
    assert.equal(document.getElementById("share-on-x")?.disabled, false, "Dashboard actions never became ready");
  };
  await flush();
  if (!deferData) checkLoaded();
  return {
    document, context, messages, fetched, storageCalls: calls, values, copied, events, scrolls, entries, downloads, confirmations, revokedUrls,
    resize(width) { context.innerWidth = width; emit("resize"); },
    flush, dispatch: emit, evaluate: (source) => vm.runInContext(source, context),
    async releaseData() { release(); await flush(); checkLoaded(); },
    async navigateHash(hash, beforePaint) {
      const oldURL = location.href;
      context.history.pushState(null, "", hash);
      if (new URL(oldURL).hash !== location.hash) emit("hashchange", { oldURL, newURL: location.href });
      if (beforePaint) beforePaint();
      await flush();
    },
    async back() { context.history.back(); await flush(); },
    async forward() { context.history.forward(); await flush(); }
  };
}
function chooseProgress(control, level) {
  assert.equal(control.tagName, "SELECT", "Progress changes must use a native select");
  control.value = String(level);
  control.dispatch("change");
}
module.exports = { runPage, ROOT, read, chooseProgress };
