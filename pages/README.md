# Pizza product docs

Static, dependency-free documentation site for GitHub Pages.

## Structure

- `index.html` — English documentation (default, English-first).
- `zh/index.html` — Chinese documentation.
- `assets/docs.css` — shared design system and responsive layout.
- `assets/docs.js` — theme toggle, scroll spy, TOC highlighting, copy buttons.
- `assets/screenshots/` — Chinese screenshots plus `en-*.png` English UI screenshots.
- `assets/team-routing*.svg` — team routing diagrams.
- `.nojekyll` — serve assets as-is; no Jekyll processing.

## Publish with GitHub Pages

1. Push this repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the branch (for example `main` or `dev`) and set the folder to `/pages`.
5. Save. GitHub will publish `pages/index.html` at `https://<user>.github.io/<repo>/`; Chinese docs live at `/zh/`.

The site uses only relative paths, so it works both at a project subpath and at a custom domain.
