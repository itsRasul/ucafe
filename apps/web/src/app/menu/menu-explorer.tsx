"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Picture, Price, formatToman, type PublicMenu, type PublicMenuItem } from "../tenant-public";

function normalizeSearch(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fa");
}

function itemSearchText(item: PublicMenuItem) {
  return normalizeSearch([item.name, item.description, ...item.variants.map((variant) => variant.name)].filter(Boolean).join(" "));
}

function categoryElementId(categoryId: string) {
  return `menu-category-${categoryId}`;
}

export function MenuExplorer({ menu, initialItemId }: { menu: PublicMenu; initialItemId?: string }) {
  const [query, setQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState(menu[0]?.id ?? "");
  const [selectedItemId, setSelectedItemId] = useState(initialItemId ?? null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const itemEntries = useMemo(() => menu.flatMap((category) => category.items.map((item) => ({ item, category }))), [menu]);
  const selectedEntry = itemEntries.find((entry) => entry.item.id === selectedItemId) ?? null;
  const normalizedQuery = normalizeSearch(query);
  const filteredMenu = useMemo(() => {
    if (!normalizedQuery) return menu;
    return menu.flatMap((category) => {
      const categoryMatches = normalizeSearch(`${category.name} ${category.description ?? ""}`).includes(normalizedQuery);
      const items = categoryMatches ? category.items : category.items.filter((item) => itemSearchText(item).includes(normalizedQuery));
      return items.length || categoryMatches ? [{ ...category, items }] : [];
    });
  }, [menu, normalizedQuery]);

  const syncSelectedItemFromUrl = useCallback(() => {
    const itemId = new URL(window.location.href).searchParams.get("item");
    setSelectedItemId(itemEntries.some((entry) => entry.item.id === itemId) ? itemId : null);
  }, [itemEntries]);

  useEffect(() => {
    addEventListener("popstate", syncSelectedItemFromUrl);
    return () => removeEventListener("popstate", syncSelectedItemFromUrl);
  }, [syncSelectedItemFromUrl]);

  useEffect(() => {
    if (initialItemId && !itemEntries.some((entry) => entry.item.id === initialItemId)) {
      const url = new URL(window.location.href);
      url.searchParams.delete("item");
      history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [initialItemId, itemEntries]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.documentElement.style.overflow;
    if (selectedEntry && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
    }
    if (!selectedEntry && dialog.open) {
      dialog.close();
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [selectedEntry]);

  useEffect(() => {
    if (!selectedItemId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeItem();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selectedItemId]);

  useEffect(() => {
    const visibleIds = filteredMenu.map((category) => category.id);
    if (!visibleIds.length) {
      setActiveCategoryId("");
      return;
    }
    setActiveCategoryId((currentId) => visibleIds.includes(currentId) ? currentId : (visibleIds[0] ?? ""));

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveCategoryId((visible.target as HTMLElement).dataset.categoryId ?? "");
      },
      { rootMargin: "-28% 0px -62%", threshold: 0 },
    );
    visibleIds.forEach((id) => {
      const section = document.getElementById(categoryElementId(id));
      if (section) observer.observe(section);
    });
    return () => observer.disconnect();
  }, [filteredMenu]);

  function openItem(itemId: string, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    const url = new URL(window.location.href);
    url.searchParams.set("item", itemId);
    history.pushState({ ...history.state, cafexaMenuItem: itemId }, "", `${url.pathname}${url.search}${url.hash}`);
    setSelectedItemId(itemId);
  }

  function closeItem() {
    const url = new URL(window.location.href);
    url.searchParams.delete("item");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setSelectedItemId(null);
  }

  function scrollToCategory(categoryId: string) {
    const section = document.getElementById(categoryElementId(categoryId));
    if (!section) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeItem();
  }

  return <section className="public-menu-content" aria-labelledby="menu-explorer-title">
    <div className="public-menu-intro">
      <h2 id="menu-explorer-title">انتخاب امروز شما</h2>
      <p>قیمت‌ها به تومان هستند و موجودی ممکن است در طول روز تغییر کند.</p>
    </div>

    {menu.length ? <>
      <div className="public-menu-toolbar">
        <div className="public-menu-toolbar-inner">
          <label className="public-menu-search">
            <span>جست‌وجوی منو</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="نام نوشیدنی یا خوراکی" autoComplete="off" />
          </label>
          <nav className="public-menu-categories" aria-label="دسته‌بندی‌های منو">
            {filteredMenu.map((category) => <button key={category.id} type="button" className={activeCategoryId === category.id ? "is-active" : ""} onClick={() => scrollToCategory(category.id)} aria-current={activeCategoryId === category.id ? "true" : undefined}>{category.name}</button>)}
          </nav>
        </div>
      </div>

      <div className="public-menu-sections" aria-live="polite">
        {filteredMenu.map((category) => <section className="public-menu-category" id={categoryElementId(category.id)} data-category-id={category.id} key={category.id} aria-labelledby={`menu-category-title-${category.id}`}>
          <header>
            <h3 id={`menu-category-title-${category.id}`}>{category.name}</h3>
            {category.description && <p>{category.description}</p>}
          </header>
          {category.items.length ? <div className="public-menu-grid">
            {category.items.map((item) => <article className={`public-menu-card${item.isAvailable ? "" : " is-unavailable"}`} key={item.id}>
              <button type="button" onClick={(event) => openItem(item.id, event.currentTarget)} aria-label={`مشاهده جزئیات ${item.name}`}>
                <Picture asset={item.image} fallback="menu" alt={item.image ? item.name : `تصویر جایگزین برای ${item.name}`} className="public-menu-card-image" />
                <span className="public-menu-card-copy">
                  <span className="public-menu-card-heading"><strong>{item.name}</strong>{item.isFeatured && <small>پیشنهاد ما</small>}</span>
                  {item.description && <span className="public-menu-card-description">{item.description}</span>}
                  {!item.isAvailable && <span className="public-menu-unavailable">امروز موجود نیست</span>}
                  <span className="public-menu-card-price"><Price item={item} /></span>
                </span>
              </button>
            </article>)}
          </div> : <p className="public-menu-category-empty">هنوز آیتمی در این دسته ثبت نشده است.</p>}
        </section>)}
        {!filteredMenu.length && <div className="public-menu-no-results" role="status"><strong>نتیجه‌ای پیدا نشد</strong><p>عبارت دیگری را جست‌وجو کنید یا جست‌وجو را پاک کنید.</p><button type="button" onClick={() => setQuery("")}>پاک کردن جست‌وجو</button></div>}
      </div>
    </> : <div className="public-menu-empty">منوی این کافه به‌زودی منتشر می‌شود.</div>}

    <dialog className="menu-item-dialog" ref={dialogRef} aria-labelledby="menu-dialog-title" aria-describedby={selectedEntry?.item.description ? "menu-dialog-description" : undefined} onCancel={(event) => { event.preventDefault(); closeItem(); }} onMouseDown={closeFromBackdrop}>
      {selectedEntry && <div className="menu-item-dialog-panel">
        <button className="menu-dialog-close" type="button" onClick={closeItem}>بستن</button>
        <Picture asset={selectedEntry.item.image} fallback="menu" alt={selectedEntry.item.image ? selectedEntry.item.name : `تصویر جایگزین برای ${selectedEntry.item.name}`} className="menu-dialog-image" />
        <div className="menu-dialog-copy">
          <p>{selectedEntry.category.name}</p>
          <h2 id="menu-dialog-title">{selectedEntry.item.name}</h2>
          {selectedEntry.item.description && <p id="menu-dialog-description">{selectedEntry.item.description}</p>}
          {!selectedEntry.item.isAvailable && <strong className="menu-dialog-unavailable">امروز موجود نیست</strong>}
          {selectedEntry.item.variants.filter((variant) => variant.isAvailable).length ? <dl className="menu-dialog-variants">{selectedEntry.item.variants.filter((variant) => variant.isAvailable).map((variant) => <div key={variant.id}><dt>{variant.name}</dt><dd>{formatToman(variant.priceToman)}</dd></div>)}</dl> : <div className="menu-dialog-base-price"><Price item={selectedEntry.item} /></div>}
        </div>
      </div>}
    </dialog>
  </section>;
}
