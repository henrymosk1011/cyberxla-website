# cyberxla-website

Static site for cyberx.la, served by GitHub Pages from `main` (custom domain in `CNAME`). Merging into `main` publishes it in about a minute. The homepage is a single `index.html` with its CSS and JS inline; `build-your-quote/`, `terms/` and `privacy/` are their own pages.

## How the owner wants changes shipped

- When the owner asks for a change, ship it live without asking first: make the change, check it, open a pull request into `main`, merge it, then confirm cyberx.la serves the new version. Don't stop for a go-ahead or a preview.
- Mobile-only requests (700px and narrower for layout, 800px and narrower for the nav menu) must leave desktop unchanged. Compare desktop screenshots against `main` before merging.
- The site sells ADA and WCAG work, so keep it at WCAG 2.1 AA or better on phone and desktop: keyboard access, visible focus, contrast, and reduced motion.
- The `v1` branch keeps the site as it was before the October 2026 phone redesign. To undo one change, use the Revert button on its pull request.
