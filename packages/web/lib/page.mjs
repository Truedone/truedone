// One truedone.pages.dev page load (WEB-01): the route decides the view; a PR route loads the PR through lib/github.mjs and
// renders core.analyse's result. core's analyse and classify are passed in, so the tests run this with recorded
// GitHub responses and app.mjs runs it with ./core.mjs. WEB-08: a PR read that GitHub refuses with 401 while a token is
// kept drops the token and reads the PR again anonymously; a failed sign-in callback is mounted with the kept page, so
// its links return there. WEB-09: every mounted view sets document.title (view.mjs titleOf).
import { route, parseTarget } from './route.mjs';
import { API, RAW, loadPR, RateLimited, GitHubError } from './github.mjs';
import { prView, precomputedView, homeView, rateLimitView, errorView, notFoundView, noListView, signinErrorView, shell, titleOf } from './view.mjs';
import { mount } from './dom.mjs';
import { start, finish, readToken, dropToken } from './signin.mjs';

export async function page(loc, { fetch, doc, root, analyse, classify, storage = null, random = null, api = API, raw = RAW }) {
  const r = route(loc.pathname);
  const show = (view, path = loc.pathname, title = titleOf(view)) => {
    mount(shell(view, path), root, doc);
    doc.title = title;
  };
  let calls = 0;
  try {
    if (r.kind === 'home') {
      show(homeView());
      doc.getElementById?.('go')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const t = parseTarget(e.target.elements.target.value);
        if (t) loc.assign(t.path);
      });
    } else if (r.kind === 'pr') {
      const token = readToken(storage);
      const read = (t) => loadPR(r, { fetch, classify, token: t, api, raw });
      let got, expired = null;
      try {
        got = await read(token);
      } catch (e) {
        // a token GitHub no longer accepts, such as an expired sign-in: forget it and read as an anonymous visitor
        if (!(token && e instanceof GitHubError && e.status === 401)) throw e;
        dropToken(storage);
        expired = loc.pathname;
        got = await read(null);
      }
      calls = got.calls;
      const result = analyse(got.input);
      show(prView(result, got.pr, { truncated: got.truncated, analysed: got.input.files.length, expired }), loc.pathname, titleOf(null, { result, pr: got.pr }));
    } else if (r.kind === 'precomputed') {
      const res = await fetch(`/precomputed/${r.owner}--${r.repo}.json`);
      // a missing list is the site's single page, served 200 as text/html: only a JSON answer is a list (WEB-07)
      const json = /^application\/json\b/i.test(res.headers?.get?.('content-type') ?? '');
      if (res.status === 404 || (res.ok && !json)) show(noListView(r.owner, r.repo));
      else if (!res.ok) throw new GitHubError(res.status);
      else show(precomputedView(await res.json(), r.owner, r.repo));
    } else if (r.kind === 'signin') {
      start(loc, storage, random);
    } else if (r.kind === 'callback') {
      const done = await finish(loc, storage, fetch);
      if (!done.ok) show(signinErrorView(done.why, done.back), done.back);
    } else {
      show(notFoundView());
    }
  } catch (e) {
    if (e instanceof RateLimited) show(rateLimitView(loc.pathname, e.reset));
    else if (e instanceof GitHubError && e.status === 404) show(errorView('GitHub has no such pull request, or it is not public.'));
    else show(errorView(e instanceof GitHubError ? e.message : 'Something failed while reading the pull request.'));
  }
  return { route: r, calls };
}
