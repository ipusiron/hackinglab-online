"use strict";
// Rendering smoke tests only: this DOM has no CSS/layout, browser navigation or accessibility tree.
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
  replaceChildren(...children) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; children.forEach((c) => this.appendChild(c)); }
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
  getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0 }; }
  addEventListener(type, listener) { const all = this.listeners.get(type) || []; all.push(listener); this.listeners.set(type, all); }
  dispatch(type, fields = {}) {
    const event = { target: this, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const fn of this.listeners.get(type) || []) fn(event);
    if (type === "click" && this.tagName === "SUMMARY" && !event.defaultPrevented) this.parentElement.open = !this.parentElement.open;
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
}
for (const [prop, attr] of Object.entries({ id: "id", className: "class", lang: "lang", rel: "rel", target: "target", type: "type" })) {
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
  return document;
}
async function runPage({ search = "", storageFailure = "none", dataOverrides = {} } = {}) {
  const location = new URL("https://hackinglab.online/" + search);
  const document = parseHtml(read("index.html"), location);
  const messages = []; const fetched = []; const values = new Map(); const calls = { getter: 0, read: 0, write: 0 };
  const store = {
    getItem(k) { calls.read++; if (storageFailure === "read") throw new Error("storage read blocked"); return values.get(k) ?? null; },
    setItem(k, v) { calls.write++; if (storageFailure === "write") throw new Error("storage full"); values.set(k, String(v)); }
  };
  const localFile = (url) => {
    const parsed = new URL(url, location);
    assert.equal(parsed.origin, location.origin, `Unexpected external request: ${url}`);
    const file = path.resolve(ROOT, "." + decodeURIComponent(parsed.pathname));
    assert.ok(file.startsWith(ROOT + path.sep), `Request outside project: ${url}`);
    return file;
  };
  const frames = [];
  const context = {
    document, location, URL, URLSearchParams, setTimeout, clearTimeout,
    innerWidth: 1280, innerHeight: 900, scrollY: 0,
    matchMedia: () => ({ matches: false }),
    addEventListener() {}, scrollTo() {}, scrollBy() {}, open() {}, confirm: () => false,
    getComputedStyle: () => ({ position: "sticky" }),
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    performance: { mark() {} },
    history: {
      state: null,
      replaceState(state, _, url) { this.state = state; if (url) location.href = new URL(url, location).href; },
      pushState(state, _, url) { this.state = state; if (url) location.href = new URL(url, location).href; }
    },
    fetch: async (url) => {
      const file = localFile(url); fetched.push(path.relative(ROOT, file).replaceAll(path.sep, "/"));
      const json = JSON.parse(Object.hasOwn(dataOverrides, fetched.at(-1)) ? JSON.stringify(dataOverrides[fetched.at(-1)]) : fs.readFileSync(file, "utf8"));
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
  // All fixture fetches resolve locally. One event-loop turn drains the loadData Promise chain.
  await new Promise(setImmediate);
  for (let i = 0; i < 10 && frames.length; i++) frames.shift()();
  assert.deepEqual(messages.filter((m) => m.level === "warn" || m.level === "error"), [], "Rendering reported an error/warning");
  assert.equal(document.getElementById("tool-list")?.getAttribute("aria-busy"), "false", "loadData did not finish rendering");
  assert.equal(document.getElementById("share-on-x")?.disabled, false, "Dashboard actions never became ready");
  return { document, context, messages, fetched, storageCalls: calls, values };
}
module.exports = { runPage, ROOT, read };
