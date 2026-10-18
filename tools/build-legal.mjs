// node tools/build-legal.mjs (WEB-10): renders docs/privacy.md and docs/terms.md, the documents OPS-05 approves and the
// only source, into packages/web/privacy.html and packages/web/terms.html, so the footer's Privacy and Terms stay on
// the site. Each page has why.html's static shell, with the header and footer from packages/web/lib/view.mjs, the title
// "<heading> - truedone", and no script, style element or inline style (the CSP is unchanged).
// The markdown it knows is what the two documents use: # and ## headings, paragraphs whose lines wrap, "- " lists
// with indented continuation lines, and inline **bold**, `code` and [text](href). Anything else is an error naming its
// line. Links to privacy.md and terms.md become /privacy and /terms, another relative path becomes the file on
// github.com, an https: link stays, and any other scheme is an error. packages/web/test/legal-pages.test.mjs renders
// both again and requires the committed bytes, so the pages cannot drift from the documents.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAGLINE, FOOTER_LINKS, signinHref, SITE_TITLE } from '../packages/web/lib/view.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'https://github.com/mgillr/truedone/blob/main/';
const PAGES = { '/privacy': 'privacy.md', '/terms': 'terms.md' };
export const LEGAL = [['docs/privacy.md', 'packages/web/privacy.html', '/privacy'], ['docs/terms.md', 'packages/web/terms.html', '/terms']];

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class MarkdownError extends Error {}

// a link's target on the site: the two documents are pages here, another repository file is on github.com
function href(target, at) {
  for (const [page, file] of Object.entries(PAGES)) if (target === file || target === `docs/${file}`) return page;
  if (/^https:\/\//.test(target)) return target;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) throw new MarkdownError(`${at}: link ${target} is not https: or a repository path`);
  const resolved = path.posix.normalize(path.posix.join('docs', target));
  if (resolved.startsWith('..')) throw new MarkdownError(`${at}: link ${target} leaves the repository`);
  return REPO + resolved;
}

// inline: **bold**, `code` and [text](href); every other character is text
function inline(text, at) {
  let out = '';
  let rest = text;
  while (rest.length) {
    let m;
    if ((m = rest.match(/^`([^`]+)`/))) out += `<code>${escape(m[1])}</code>`;
    else if ((m = rest.match(/^\*\*([^*]+)\*\*/))) out += `<strong>${inline(m[1], at)}</strong>`;
    else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) out += `<a href="${escape(href(m[2], at))}">${inline(m[1], at)}</a>`;
    else if ((m = rest.match(/^[^`*_<[!]+/) ?? rest.match(/^!(?!\[)/))) out += escape(m[0]);
    else throw new MarkdownError(`${at}: unknown inline markdown at "${rest.slice(0, 20)}"`);
    rest = rest.slice(m[0].length);
  }
  return out;
}

// blocks: headings, paragraphs and "- " lists, from the document's lines
export function render(markdown, file = 'the document') {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const blocks = [];
  let h1 = null;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const at = `${file}:${i + 1}`;
    if (!line.trim()) { i += 1; continue; }
    let m;
    if ((m = line.match(/^(#{1,2}) (\S.*)$/))) {
      const level = m[1].length;
      if (level === 1 && h1 !== null) throw new MarkdownError(`${at}: a second # heading`);
      if (level === 1) h1 = m[2];
      blocks.push(`<h${level}>${inline(m[2], at)}</h${level}>`);
      i += 1;
    } else if (/^- \S/.test(line)) {
      const items = [];
      while (i < lines.length && /^- \S/.test(lines[i])) {
        const start = i;
        let text = lines[i].slice(2);
        i += 1;
        while (i < lines.length && /^ {2}\S/.test(lines[i])) { text += ` ${lines[i].trim()}`; i += 1; }
        items.push(`<li>${inline(text, `${file}:${start + 1}`)}</li>`);
      }
      blocks.push(`<ul>\n${items.join('\n')}\n</ul>`);
    } else if (/^(#{3,}|>|\d+[.)] |\||```|~~~|<|!\[|\* |\+ |---|===|\s)/.test(line)) {
      throw new MarkdownError(`${at}: unknown markdown "${line.slice(0, 30)}"`);
    } else {
      const start = i;
      const text = [];
      while (i < lines.length && lines[i].trim() && !/^(#|- |\s)/.test(lines[i])) { text.push(lines[i].trim()); i += 1; }
      blocks.push(`<p>${inline(text.join(' '), `${file}:${start + 1}`)}</p>`);
    }
  }
  if (h1 === null) throw new MarkdownError(`${file}: no # heading`);
  return { h1, body: blocks.join('\n') };
}

// the page: why.html's shell around the rendered document
export function page(markdown, file, sitePath) {
  const { h1, body } = render(markdown, file);
  const footer = [...FOOTER_LINKS.map(([text, link]) => `<li><a href="${escape(link)}">${escape(text)}</a></li>`), `<li class="signin-item"><a href="${escape(signinHref(sitePath))}">Sign in with GitHub</a></li>`].join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(h1)}${SITE_TITLE}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site-header">
<p class="name"><a href="/">truedone</a></p>
<p class="tagline">${escape(TAGLINE)}</p>
</header>
<main class="legal">
${body}
</main>
<footer class="site-footer">
<ul>${footer}</ul>
</footer>
</body>
</html>
`;
}

export function build(root = ROOT) {
  for (const [doc, out, sitePath] of LEGAL) fs.writeFileSync(path.join(root, out), page(fs.readFileSync(path.join(root, doc), 'utf8'), doc, sitePath));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    build();
  } catch (e) {
    if (!(e instanceof MarkdownError)) throw e;
    console.error(`build-legal: ${e.message}`);
    process.exitCode = 1;
  }
}
