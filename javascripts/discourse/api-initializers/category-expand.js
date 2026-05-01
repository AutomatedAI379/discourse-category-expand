import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";
import DiscourseURL from "discourse/lib/url";

const ANIM_MS = 240;
const ROOT_SEL =
  ".category-list, .categories-list, .category-boxes, .categories-and-latest, .categories-and-topics";
const CARD_SEL = ".category, .category-box";
const CAT_PATH_RE = /^\/c(ategories)?(\/|$)/;
const CAT_HREF_RE = /^\/c\/([^/]+)\/(\d+)(?:\/|$)/;

const attachedRoots = new WeakSet();

function getRoot() {
  return document.querySelector(ROOT_SEL);
}

function waitForRoot(cb) {
  const r = getRoot();
  if (r) return cb(r);
  const mo = new MutationObserver(() => {
    const r2 = getRoot();
    if (r2) {
      mo.disconnect();
      cb(r2);
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 10000);
}

function parseCatHref(href) {
  const m = href?.match?.(CAT_HREF_RE);
  return m ? { slug: m[1], id: Number(m[2]) } : null;
}

function findCardFromEventTarget(target, root) {
  // Don't treat clicks inside an open subcategory grid as card clicks
  if (target.closest?.(".subcategory-grid")) return null;
  const card = target.closest(CARD_SEL);
  if (!card || !root.contains(card)) return null;
  if (card.dataset.categoryId) return card;
  const a =
    card.querySelector("a[href^='/c/']") || target.closest("a[href^='/c/']");
  const parsed = a && parseCatHref(a.getAttribute("href"));
  if (!parsed) return null;
  card.dataset.categorySlug = parsed.slug;
  card.dataset.categoryId = String(parsed.id);
  return card;
}

function hasSubcategories(site, id) {
  const cat =
    site?.categoriesById?.[id] ||
    site?.categories?.findBy?.("id", id);
  if (!cat) return null;
  if (typeof cat.subcategory_count === "number")
    return cat.subcategory_count > 0;
  if (typeof cat.has_children === "boolean") return cat.has_children;
  if (Array.isArray(cat.subcategories)) return cat.subcategories.length > 0;
  if (Array.isArray(cat.subcategory_ids))
    return cat.subcategory_ids.length > 0;
  if (Array.isArray(cat.subcategory_list))
    return cat.subcategory_list.length > 0;
  return null;
}

async function loadSubcats(parentSlug, parentId) {
  const json = await ajax(
    `/c/${encodeURIComponent(parentSlug)}/${parentId}.json`
  );
  const list =
    json?.category?.subcategory_list || json?.subcategory_list || [];
  return list.map((s) => ({
    id: s.id,
    name: s.name,
    url:
      s.url && s.url.startsWith("/c/")
        ? s.url
        : `/c/${parentSlug}/${s.slug}/${s.id}`,
  }));
}

function renderTiles(grid, subs) {
  grid.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const s of subs) {
    const a = document.createElement("a");
    a.className = "subcategory-tile";
    a.href = s.url;
    a.title = s.name ?? "";
    const title = document.createElement("div");
    title.className = "subcategory-title";
    title.textContent = s.name ?? "";
    a.appendChild(title);
    frag.appendChild(a);
  }
  grid.appendChild(frag);
}

function renderError(grid) {
  grid.replaceChildren();
  const err = document.createElement("div");
  err.className = "subcategory-error";
  err.textContent = "Could not load subcategories.";
  grid.appendChild(err);
}

function collapse(card, { updateUrl = false } = {}) {
  if (!card) return;
  card.classList.remove("category--expanded");
  card.setAttribute("aria-expanded", "false");
  const grid = card.querySelector(":scope > .subcategory-grid");
  if (grid) {
    grid.style.maxHeight = grid.scrollHeight + "px";
    requestAnimationFrame(() => {
      grid.style.maxHeight = "0px";
      grid.addEventListener("transitionend", () => grid.remove(), {
        once: true,
      });
    });
  }
  if (updateUrl) {
    const url = new URL(location.href);
    if (url.searchParams.has("parent")) {
      url.searchParams.delete("parent");
      history.replaceState({}, "", url);
    }
  }
}

async function expand(card, { pushUrl = true } = {}) {
  const root = getRoot();
  if (!root) return;
  const slug = card.dataset.categorySlug;
  const id = Number(card.dataset.categoryId);

  // Fetch first — avoids any flicker for empty categories
  let subs;
  try {
    subs = await loadSubcats(slug, id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[category-expand] loadSubcats error", e);
    subs = null;
  }

  // Empty category → just navigate, never show an empty band
  if (Array.isArray(subs) && subs.length === 0) {
    DiscourseURL.routeTo(`/c/${slug}/${id}`);
    return;
  }

  // Close any other open card
  root
    .querySelectorAll(".category--expanded")
    .forEach((el) => el !== card && collapse(el));

  card.classList.add("category--expanded");
  card.setAttribute("aria-expanded", "true");

  // Append grid as a CHILD of the card (positioning context)
  card.querySelector(":scope > .subcategory-grid")?.remove();
  const grid = document.createElement("div");
  grid.className = "subcategory-grid";
  grid.id = `subcat-grid-${id}`;
  grid.setAttribute("role", "region");
  grid.setAttribute("aria-label", `Subcategories of ${slug}`);
  grid.style.setProperty("--anim-ms", ANIM_MS + "ms");
  card.setAttribute("aria-controls", grid.id);
  card.appendChild(grid);

  if (subs === null) {
    renderError(grid);
  } else {
    renderTiles(grid, subs);
  }

  grid.style.maxHeight = "0px";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      grid.classList.add("open");
      grid.style.maxHeight = grid.scrollHeight + "px";
    });
  });

  if (pushUrl) {
    const url = new URL(location.href);
    url.searchParams.set("parent", slug);
    history.pushState({}, "", url);
  }
}

function findCardBySlug(root, slug) {
  const cards = Array.from(root.querySelectorAll(CARD_SEL));
  for (const c of cards) {
    const a = c.querySelector("a[href^='/c/']");
    const p = a && parseCatHref(a.getAttribute("href"));
    if (p && p.slug === slug) {
      c.dataset.categorySlug = p.slug;
      c.dataset.categoryId = String(p.id);
      return c;
    }
  }
  return null;
}

function syncFromUrl(root) {
  const slug = new URLSearchParams(location.search).get("parent");
  if (!slug) {
    const open = root.querySelector(".category--expanded");
    if (open) collapse(open);
    return;
  }
  const card = findCardBySlug(root, slug);
  if (card && !card.classList.contains("category--expanded")) {
    expand(card, { pushUrl: false });
  }
}

function onKeydown(evt, root, site) {
  if (evt.target.closest?.(".subcategory-grid")) return;
  if (evt.key === "Escape") {
    const open = root.querySelector(".category--expanded");
    if (open) {
      collapse(open, { updateUrl: true });
      open.focus?.();
    }
    return;
  }
  if (evt.key !== "Enter" && evt.key !== " ") return;
  const card = findCardFromEventTarget(evt.target, root);
  if (!card) return;
  if (hasSubcategories(site, Number(card.dataset.categoryId)) === false) {
    return;
  }
  evt.preventDefault();
  if (card.classList.contains("category--expanded")) {
    collapse(card, { updateUrl: true });
  } else {
    expand(card);
  }
}

function attach(root, site) {
  if (attachedRoots.has(root)) return;
  attachedRoots.add(root);

  root.querySelectorAll(CARD_SEL).forEach((card) => {
    if (!card.hasAttribute("aria-expanded")) {
      card.setAttribute("aria-expanded", "false");
    }
    if (!card.hasAttribute("tabindex")) {
      card.setAttribute("tabindex", "0");
    }
  });

  root.addEventListener(
    "click",
    (evt) => {
      const card = findCardFromEventTarget(evt.target, root);
      if (!card) return;
      if (evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey) return;
      // Pre-check via Site service: if known empty, skip fetch + navigate
      if (hasSubcategories(site, Number(card.dataset.categoryId)) === false) {
        return;
      }
      evt.preventDefault();
      evt.stopPropagation();
      if (card.classList.contains("category--expanded")) {
        collapse(card, { updateUrl: true });
      } else {
        expand(card);
      }
    },
    true
  );

  root.addEventListener("keydown", (evt) => onKeydown(evt, root, site));
}

let outsideClickBound = false;
function bindOutsideClick() {
  if (outsideClickBound) return;
  outsideClickBound = true;
  document.addEventListener(
    "click",
    (evt) => {
      const root = getRoot();
      if (!root) return;
      const open = root.querySelector(".category--expanded");
      if (!open) return;
      if (open.contains(evt.target)) return;
      collapse(open, { updateUrl: true });
    },
    true
  );
}

export default apiInitializer("1.39.0", (api) => {
  const site = api.container.lookup("service:site");
  let popstateBound = false;

  function bindPopstate() {
    if (popstateBound) return;
    popstateBound = true;
    window.addEventListener("popstate", () => {
      if (!CAT_PATH_RE.test(location.pathname)) return;
      const root = getRoot();
      if (root) syncFromUrl(root);
    });
  }

  api.onPageChange(() => {
    if (!CAT_PATH_RE.test(location.pathname)) return;
    waitForRoot((root) => {
      attach(root, site);
      bindPopstate();
      bindOutsideClick();
      syncFromUrl(root);
    });
  });
});
