import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

const ANIM_MS = 240;
const STICKY_TOP = 0;
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
  // Safety: stop watching after 10s if root never appears
  setTimeout(() => mo.disconnect(), 10000);
}

function parseCatHref(href) {
  const m = href?.match?.(CAT_HREF_RE);
  return m ? { slug: m[1], id: Number(m[2]) } : null;
}

function findCardFromEventTarget(target, root) {
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

async function loadSubcats(parentSlug, parentId) {
  try {
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
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[category-expand] loadSubcats error", e);
    throw e;
  }
}

function renderTiles(grid, subs) {
  grid.replaceChildren();
  if (!subs.length) {
    const empty = document.createElement("div");
    empty.className = "subcategory-empty";
    empty.textContent = "No subcategories";
    grid.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const s of subs) {
    const a = document.createElement("a");
    a.className = "subcategory-tile";
    a.href = s.url;
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
  const grid = card.nextElementSibling;
  if (grid?.classList?.contains("subcategory-grid")) {
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
  root
    .querySelectorAll(".category--expanded")
    .forEach((el) => collapse(el));

  const slug = card.dataset.categorySlug;
  const id = Number(card.dataset.categoryId);

  card.classList.add("category--expanded");
  card.setAttribute("aria-expanded", "true");
  card.style.setProperty("--sticky-top", STICKY_TOP + "px");

  if (card.nextElementSibling?.classList?.contains("subcategory-grid")) {
    card.nextElementSibling.remove();
  }

  const grid = document.createElement("div");
  grid.className = "subcategory-grid";
  grid.id = `subcat-grid-${id}`;
  grid.setAttribute("role", "region");
  grid.setAttribute("aria-label", `Subcategories of ${slug}`);
  grid.style.setProperty("--anim-ms", ANIM_MS + "ms");
  card.setAttribute("aria-controls", grid.id);
  card.insertAdjacentElement("afterend", grid);

  try {
    const subs = await loadSubcats(slug, id);
    renderTiles(grid, subs);
  } catch (_e) {
    renderError(grid);
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

function onKeydown(evt, root) {
  // Escape closes any open expansion
  if (evt.key === "Escape") {
    const open = root.querySelector(".category--expanded");
    if (open) {
      collapse(open, { updateUrl: true });
      open.focus?.();
    }
    return;
  }
  // Enter / Space on a card toggles expansion
  if (evt.key !== "Enter" && evt.key !== " ") return;
  const card = findCardFromEventTarget(evt.target, root);
  if (!card) return;
  evt.preventDefault();
  if (card.classList.contains("category--expanded")) {
    collapse(card, { updateUrl: true });
  } else {
    expand(card);
  }
}

function attach(root) {
  if (attachedRoots.has(root)) return;
  attachedRoots.add(root);

  // Mark cards as button-like for assistive tech
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
      // Allow modifier-clicks to open in new tab / window
      if (evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey) return;
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

  root.addEventListener("keydown", (evt) => onKeydown(evt, root));
}

export default apiInitializer("1.39.0", (api) => {
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
      attach(root);
      bindPopstate();
      syncFromUrl(root);
    });
  });
});
