// One truedone.pages.dev page load (WEB-01): the route decides the view; a PR route loads the PR through lib/github.mjs and
// renders core.analyse's result. core's analyse and classify are passed in, so the tests run this with recorded
// GitHub responses and app.mjs runs it with ./core.mjs.
import { route, parseTarget } from './route.mjs';
import { API, RAW, loadPR, RateLimited, GitHubError } from './github.mjs';
import { prView, precomputedView, homeView, rateLimitView, errorView, notFoundView, shell } from './view.mjs';
import { mount } from './dom.mjs';
import { start, finish, readToken } from './signin.mjs';

export async function page(loc, { fetch, doc, root, analyse, classify, storage = null, random = null, api = API, raw = RAW }) {
  const r = route(loc.pathname);
  const show = (view) => mount(shell(view), root, doc);
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
      const got = await loadPR(r, { fetch, classify, token: readToken(storage), api, raw });
      calls = got.calls;
      show(prView(analyse(got.input), got.pr, { truncated: got.truncated, analysed: got.input.files.length }));
    } else if (r.kind === 'precomputed') {
      const res = await fetch(`/precomputed/${r.owner}--${r.repo}.json`);
      if (!res.ok) throw new GitHubError(res.status);
      show(precomputedView(await res.json(), r.owner, r.repo));
    } else if (r.kind === 'signin') {
      start(loc, storage, random);
    } else if (r.kind === 'callback') {
      const done = await finish(loc, storage, fetch);
      if (!done.ok) show(errorView(done.why));
    } else {
      show(notFoundView());
    }
  } catch (e) {
    if (e instanceof RateLimited) show(rateLimitView(loc.pathname));
    else if (e instanceof GitHubError && e.status === 404) show(errorView('GitHub has no such pull request, or it is not public.'));
    else show(errorView(e instanceof GitHubError ? e.message : 'Something failed while reading the pull request.'));
  }
  return { route: r, calls };
}
