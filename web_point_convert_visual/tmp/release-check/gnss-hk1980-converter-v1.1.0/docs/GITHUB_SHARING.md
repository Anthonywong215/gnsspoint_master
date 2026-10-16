# Share this project on GitHub

Author: **Anthony Wong**.

## Repository source

Use the contents of the extracted release folder as the repository source. It includes the app, local launcher, user guide, synthetic-demo screenshots, samples, tests, workflow, packaging script and Leaflet license.

1. Create an empty repository in your GitHub account.
2. Upload the extracted folder's **contents**, including `.github`, `.gitignore`, `.gitattributes` and `.editorconfig`.
3. Keep `README.md` at the root so the overview and relative links display correctly.
4. Commit the source. Check application runs offline tests and packaging on Node.js 22 and 24.
5. Create a release tagged `v1.1.0`; attach the ZIP, `.sha256` and manifest JSON from `release/`.

For Git command-line use, initialize the folder, add files, commit, then add your repository's own remote URL and push. No account, remote URL or credentials are preconfigured.

## Rebuild the downloadable ZIP

```text
npm test
npm run package
```

The package command uses a fixed source/documentation allowlist. It excludes `.git`, temporary files, the release folder itself, original survey inputs and generated survey results. Only synthetic inputs under `samples/` are distributed. The SHA-256 file verifies the ZIP; the manifest lists every included file and hash.

## Optional static hosting

The app is buildless HTML/CSS/JavaScript. A static host such as GitHub Pages can serve the source root with `index.html` as entry point. Preserve relative asset folders. The Node server is only for local launch/preview; browser conversion calls LandsD directly.

The workflow checks and packages; it does not publish a website or create a release automatically. No license is chosen for Anthony Wong's original application code. Leaflet's BSD 2-Clause license is included in its vendor folder.
