# How to publish documentation

This project's docs are a static website built with [MkDocs Material](https://squidfunk.github.io/mk-docs-material/) from the Markdown files in `docs/`.

---

## Preview locally

From the project root:

```powershell
pip install -r requirements-docs.txt
mkdocs serve
```

Open **http://127.0.0.1:8000** — the site reloads when you edit Markdown.

Use a different port if 8000 is taken:

```powershell
mkdocs serve -a 127.0.0.1:8001
```

---

## Build static files

```powershell
mkdocs build
```

Output goes to `site/` (gitignored). Upload that folder to any static host.

---

## Deploy to GitHub Pages

If the repo is on GitHub:

```powershell
mkdocs gh-deploy
```

This builds the site and pushes to the `gh-pages` branch. Enable Pages in repo settings → **Source: gh-pages branch**.

Set `site_url` in `mkdocs.yml` to your Pages URL, e.g.:

```yaml
site_url: https://your-org.github.io/material_tracking/
```

---

## Deploy to IIS or nginx

1. Run `mkdocs build`
2. Copy contents of `site/` to the web server document root
3. Configure the server for static files (no Python required on the server)

---

## Editing docs

| File | Role |
|------|------|
| `mkdocs.yml` | Site name, left sidebar navigation, theme |
| `docs/**/*.md` | Page content (Diátaxis sections) |
| `requirements-docs.txt` | MkDocs dependencies |

After adding a new page, add it to the `nav:` section in `mkdocs.yml`.

---

## Related

- [Documentation home](../README.md)
- [MkDocs Material documentation](https://squidfunk.github.io/mk-docs-material/setup/)
