# Category Expand

Discourse theme component that expands subcategories **inline** on the
categories overview page (`/categories`, `/c`) instead of navigating away
when a parent category is clicked.

## Behavior

- Click a parent category card → its subcategories appear as a tile grid
  directly below the card (animated open)
- Click the same card again, click another parent, or press `Escape` → close
- Categories that have **no subcategories** are not intercepted — clicks
  navigate normally to the category page (no awkward "no subcategories"
  empty band)
- The expanded parent stays sticky to the top while scrolling through the
  subcategory grid
- URL gets `?parent=<slug>` so the open state is shareable / bookmarkable
- Browser back / forward buttons sync the open state correctly

### Flat subcategory display (CSS)

Bundled in the same component because it operates on the same page and
the same content:

- Level-3 subcategory lists (`.subcategories` blocks inside a level-2
  row of a `subcategories-with-subcategories` table) are hidden — the
  in-flow view stays one level deep, with deep navigation handled by the
  click-to-expand behavior above.
- Subcategory pills render at normal font-weight (400) so they read as
  secondary content; parent box / row titles stay bold (700).

## What this is a refactor of

This replaces the legacy inline component that used the deprecated
`<script type="text/discourse-plugin">` wrapper. Functional behavior is
identical; the implementation is modernized:

- Uses `withPluginApi("1.39.0", …)` via `apiInitializer` (deprecation-safe)
- `popstate` handler so the back / forward buttons no longer leave the UI
  out of sync with the URL
- Keyboard support: `Enter` / `Space` toggles, `Escape` collapses
- ARIA: `aria-expanded`, `aria-controls`, `role="region"` on the grid
- Fetch failures show an error tile instead of silent empty state
- DOM-built tiles (`textContent`) instead of `innerHTML` + manual escape
- `MutationObserver` cleans up after itself (10 s safety + disconnect on hit)
- Ajax via Discourse `ajax` helper (CSRF + error normalization)
- `prefers-reduced-motion` honored

## Install

In Discourse admin → Customize → Themes → Components → **Install** →
**From a git repository**:

```
https://gitlab.com/Maxiii12/discourse-category-expand.git
```

Then add the component to your active theme.

## File layout

```
about.json
common/common.scss
javascripts/discourse/api-initializers/category-expand.js
README.md
```
