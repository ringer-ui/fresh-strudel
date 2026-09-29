# Publishing the public build

`dist/` is a fully static site: no server, no database, nothing that can reach your computer. Build it and put the folder on any static host.

    STRUDEL_EASY_SOURCE_URL=https://github.com/<you>/strudel-easy node scripts/build-public.mjs
    node scripts/serve-public.mjs        # preview at http://localhost:4322 with the production headers

## Before you publish (required)
1. **Put the source somewhere public and set `STRUDEL_EASY_SOURCE_URL`.** The site serves AGPL-3.0 code (Strudel, `@strudel/soundfonts`), so the corresponding source of the whole app has to be offered. `licenses.html` links it. The build warns if it's unset.
2. **Read "Shared links" below.** It's the one real risk of a public live-coding site.

## Hosts (pick one)
| Host | How | Notes |
|---|---|---|
| Cloudflare Pages | `npx wrangler pages deploy dist` (or connect a repo, build command `node scripts/build-public.mjs`, output `dist`) | Honours `_headers`. Custom domain is easy. |
| Netlify | drag `dist/` into the dashboard, or `npx netlify deploy --dir dist --prod` | Honours `_headers`. |
| GitHub Pages | publish `dist/` to a `gh-pages` branch | Ignores `_headers`; the `<meta>` CSP still applies, but `frame-ancestors`/`X-Frame-Options` won't. |

## What "walled off" means here
- The site is only the files listed in `scripts/build-public.mjs`. `server.mjs`, `songs/`, `tools/`, `docs/`, tests and any machine-specific code are not copied (a test enforces it: `test/public-build.test.mjs`).
- The build refuses to finish if any file contains a local path, a private hostname or an API key.
- There is no `/api`. Chat runs in the visitor's browser with **their own** Anthropic key: held in memory (gone on reload) unless they tick "keep it", and sent only to `api.anthropic.com`. Your key is not involved and can't be spent by visitors.
- A Content-Security-Policy limits the page to itself plus: `raw.githubusercontent.com` (sample packs), `felixroos.github.io` (General-MIDI soundfonts), `esm.sh` (one small library), `api.anthropic.com` (chat). Verified in a real browser: nothing else was contacted.
- Never expose your local server (`npm start`) to the internet: it holds your API key and is not built for that.

## Shared links: the residual risk
A song is JavaScript. Opening someone's `#s=…` link loads their code into the editor; it only runs when you press Play, and the page says so. Once running it can do anything the page can, but the CSP blocks sending data anywhere except the hosts above, and a key held in memory isn't in browser storage where pasted code could read it. Someone who ticks "keep it" stores the key in local storage, where a malicious song could read it (it still could not send it out). Tell people to use a key with a spending limit.

## Costs and limits
Hosting is free at this size (~900 KB). Sample and soundfont downloads come from GitHub and esm.sh, not your host. Visitors' chat usage is billed to their own Anthropic accounts.

## Password protection
Add `--protect` to put a password in front of the whole site (every page and file):

    node scripts/build-public.mjs --protect
    npx wrangler pages deploy dist --project-name <your project>      # or upload dist/ in the dashboard

Then set the password as a **secret in Cloudflare** (never in a file): dashboard → Workers & Pages → your project → Settings → Variables and Secrets → add a *Secret* named `SITE_PASSWORD` (do this for Production, and Preview if you use it), or `npx wrangler pages secret put SITE_PASSWORD --project-name <your project>`. Then **redeploy once** so it takes effect.

- Visitors get the browser's own login box. **Any username works**; the password is `SITE_PASSWORD`.
- **Fails closed:** if the secret isn't set, the site answers 503 to everyone.
- The check runs on Cloudflare before any file is sent (`_worker.js`, tested in `test/protect-worker.test.mjs`), so it can't be bypassed by reading the page's code.
- Change the password by editing the secret and redeploying. Everyone is logged out when you do.
- **Old deployments stay reachable.** Cloudflare Pages keeps every earlier deployment at its own `<hash>.<project>.pages.dev` address. Deployments made *before* you turned protection on are still open. Delete them: Workers & Pages → your project → Deployments → the old ones → Delete.
- For a few named people, Cloudflare Access (Zero Trust) is stronger than a shared password: it emails each person a one-time code and needs no password to hand out. Same `dist/`, configured in the dashboard.
