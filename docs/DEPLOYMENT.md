# Deployment

The observatory is deployed to **GitHub Pages** via GitHub Actions. One-time setup plus a merge to `main` is all that's needed.

## Prerequisites

- Repository with Pages enabled and configured to build from **GitHub Actions**:
  **Settings → Pages → Build source → GitHub Actions**.
- The `github-pages` environment in this repository has **branch-protection rules** that only permit deployments **from `main`**. This is intentional (production deployments are only made from the default branch).

## Deploying

1. Make changes on a feature/session branch.
2. CI on the branch (if the workflow is present) builds and tests — but **cannot deploy**, because the `github-pages` environment rejects non-`main` deployments. This is expected.
3. Open a pull request into `main` and merge it.
4. The workflow runs on the push to `main`:
   - `npm ci` (lockfile install — zero dependencies)
   - `npm test` (14 engine tests)
   - `npm run build` (validates sources, copies `src/` → `dist/`, writes `build-info.json`)
   - Uploads **only `dist/`** as the Pages artifact and deploys it.
5. Verify the site at the Pages URL shown in the workflow run summary.

Manual deployment is also possible from the Actions tab: **Run workflow** on the `main` branch (Settings → Pages must still use GitHub Actions as source).

## The three errors this workflow corrects

1. **Pages site "Not Found"** — Pages was not enabled, so `actions/configure-pages` could not resolve a site. Fixed by enabling Pages with the Actions source.
2. **"Branch … is not allowed to deploy to github-pages due to environment protection rules"** — deployments were triggered from a session branch. The workflow now only deploys from `main` (push or manual dispatch).
3. **Uploading the entire repository root** — the template workflow published `path: '.'` (README + `.github/`). The corrected workflow publishes **only the built `dist/`** directory.

## Local verification

```bash
npm test
npm run build
npm run serve   # → http://localhost:8080/
```

Check `dist/` contents (5 assets + `build-info.json`, ~40 KB total) before pushing.
