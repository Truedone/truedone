// Mounts a view.mjs tree (WEB-01, S7). Text goes in through textContent only; attributes come from a fixed list, and
// an href must be https: or a same-site path, so nothing taken from a PR can become markup or a script URL.
const ATTRS = new Set(['class', 'id', 'href', 'type', 'name', 'placeholder', 'aria-label', 'aria-labelledby', 'for']);
const TAGS = new Set(['div', 'header', 'footer', 'main', 'section', 'h1', 'h2', 'p', 'pre', 'ul', 'li', 'a', 'span', 'form', 'input', 'button']);

const safeHref = (v) => /^https:\/\//.test(v) || (/^\//.test(v) && !/^\/\//.test(v));

export function build(node, doc) {
  if (!TAGS.has(node.tag)) throw new Error(`dom.mjs: tag ${node.tag} is not on the list`);
  const e = doc.createElement(node.tag);
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (!ATTRS.has(k)) throw new Error(`dom.mjs: attribute ${k} is not on the list`);
    if (k === 'href' && !safeHref(v)) continue;
    e.setAttribute(k, String(v));
  }
  if (node.text !== undefined) e.textContent = node.text;
  for (const c of node.children ?? []) e.appendChild(build(c, doc));
  return e;
}

// index.html marks #app aria-busy while it shows "Loading"; a mounted view ends that (WEB-09)
export function mount(node, root, doc) {
  root.replaceChildren(build(node, doc));
  root.removeAttribute('aria-busy');
}
