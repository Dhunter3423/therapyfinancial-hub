# Deploying the Therapy+ Financial Performance Tool

The page is static, but months loaded through the "Load a month" panel are
saved in Netlify Blobs through one small Netlify Function, so every viewer sees
them. That only works when the whole folder is deployed from a Git repo.

## Layout

```
build/index.html                 the page (regenerate with python3 refresh.py)
netlify/functions/months.mjs     GET/PUT/DELETE /api/months  (Blobs store therapy-fin)
netlify.toml                     publish "build", functions dir, /api route
package.json                     one dependency, @netlify/blobs
refresh.py, page_*.html/js, data/, assets/   the rebuild kit
```

## One-time setup

1. Put this folder in a GitHub repo (`git init`, commit, push).
2. Netlify: Add new site, Import an existing project, pick the repo. Build
   command blank, publish directory `build`, functions `netlify/functions`
   (netlify.toml already says so). Deploy.
3. Keep the site password (Site settings, Access control) if it had one.
4. Smoke test: the badge in the "Load a month" bar reads **Shared**, and
   `https://<site>/api/months` answers `{}` rather than a 404 page.

## Monthly

Open the site, drop the close pack on "Load a month", review, press Add.
Done for everyone. No redeploy, no CSV, no refresh.py.

## Do not drag-and-drop deploy

Dragging `build/` onto Netlify's drop zone replaces the site with the page
alone: the function disappears, the badge flips to **This browser**, and
loaded months stop being shared. Nothing is lost (Blobs survive); push the
repo again to restore.

## Baking months into the page (optional)

If you ever want loaded months to be part of the page itself (so they show
even if the function is off), "Download all months as CSV" gives the
`data/merged_data.csv` layout: replace that file, run `python3 refresh.py`,
commit and push.
