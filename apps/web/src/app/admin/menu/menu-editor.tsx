"use client";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useAdminSession } from "../admin-session";
type Variant = {
  id?: string;
  name: string;
  priceToman: string;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
};
type ItemImage = {
  id: string;
  focalX: number;
  focalY: number;
  sources: { smallWebp: string; largeWebp: string };
};
type Item = {
  id: string;
  name: string;
  description: string | null;
  basePriceToman: string | null;
  isAvailable: boolean;
  isFeatured: boolean;
  sortOrder: number;
  image: ItemImage | null;
  variants: Variant[];
};
type Category = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  items: Item[];
};
type CategoryForm = {
  id?: string;
  name: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
};
type ItemForm = {
  id?: string;
  categoryId: string;
  name: string;
  description: string;
  basePriceToman: string;
  isAvailable: boolean;
  isFeatured: boolean;
  sortOrder: number;
  image: ItemImage | null;
  variants: Variant[];
};
const emptyCategory: CategoryForm = {
  name: "",
  description: "",
  sortOrder: 0,
  isActive: true,
};
const emptyItem = (categoryId = ""): ItemForm => ({
  categoryId,
  name: "",
  description: "",
  basePriceToman: "",
  isAvailable: true,
  isFeatured: false,
  sortOrder: 0,
  image: null,
  variants: [],
});
const fa = new Intl.NumberFormat("fa-IR");
function price(value: string) {
  return `${fa.format(Number(value))} تومان`;
}
export function MenuEditor() {
  const { access, api } = useAdminSession();
  const canRead = access.permissions.includes("menu.read"),
    canManage = access.permissions.includes("menu.manage");
  const [categories, setCategories] = useState<Category[]>([]),
    [categoryForm, setCategoryForm] = useState<CategoryForm | null>(null),
    [itemForm, setItemForm] = useState<ItemForm | null>(null),
    [pendingItemImage, setPendingItemImage] = useState<File | null>(null),
    [deleteTarget, setDeleteTarget] = useState<{
      kind: "category" | "item";
      id: string;
      name: string;
    } | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(
    async () => setCategories(await api<Category[]>("/tenant/menu")),
    [api],
  );
  useEffect(() => {
    if (!canRead) return;
    load()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setBusy(false));
  }, [canRead, load]);
  if (!canRead)
    return (
      <section className="admin-section-state">
        <p className="eyebrow">دسترسی محدود</p>
        <h1>منو</h1>
        <p>نقش شما اجازه مشاهده منوی کافه را ندارد.</p>
      </section>
    );
  function editCategory(category: Category) {
    setCategoryForm({
      id: category.id,
      name: category.name,
      description: category.description ?? "",
      sortOrder: category.sortOrder,
      isActive: category.isActive,
    });
    setItemForm(null);
    setPendingItemImage(null);
  }
  function editItem(category: Category, item: Item) {
    setItemForm({
      id: item.id,
      categoryId: category.id,
      name: item.name,
      description: item.description ?? "",
      basePriceToman: item.basePriceToman ?? "",
      isAvailable: item.isAvailable,
      isFeatured: item.isFeatured,
      sortOrder: item.sortOrder,
      image: item.image,
      variants: item.variants.map((variant) => ({
        ...variant,
        priceToman: String(variant.priceToman),
      })),
    });
    setCategoryForm(null);
    setPendingItemImage(null);
  }
  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    if (!categoryForm) return;
    setBusy(true);
    setError("");
    try {
      const path = categoryForm.id
        ? `/tenant/menu/categories/${categoryForm.id}`
        : "/tenant/menu/categories";
      await api(path, {
        method: categoryForm.id ? "PATCH" : "POST",
        body: JSON.stringify({
          name: categoryForm.name.trim(),
          description: categoryForm.description.trim() || null,
          sortOrder: categoryForm.sortOrder,
          isActive: categoryForm.isActive,
        }),
      });
      await load();
      setCategoryForm(null);
      setNotice(
        categoryForm.id ? "دسته‌بندی ویرایش شد." : "دسته‌بندی جدید ساخته شد.",
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!itemForm) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        categoryId: itemForm.categoryId,
        name: itemForm.name.trim(),
        description: itemForm.description.trim() || null,
        basePriceToman:
          itemForm.basePriceToman === ""
            ? null
            : Number(itemForm.basePriceToman),
        isAvailable: itemForm.isAvailable,
        isFeatured: itemForm.isFeatured,
        sortOrder: itemForm.sortOrder,
        variants: itemForm.variants.map((variant, index) => ({
          name: variant.name.trim(),
          priceToman: Number(variant.priceToman),
          isDefault: variant.isDefault,
          isAvailable: variant.isAvailable,
          sortOrder: index,
        })),
      };
      const path = itemForm.id
        ? `/tenant/menu/items/${itemForm.id}`
        : "/tenant/menu/items";
      const saved = await api<{ id: string }>(path, {
        method: itemForm.id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      if (pendingItemImage) {
        try {
          await uploadImage(saved.id, pendingItemImage);
        } catch (reason) {
          await load();
          setItemForm({ ...itemForm, id: saved.id });
          setPendingItemImage(null);
          throw new Error(
            `آیتم ذخیره شد، اما تصویر بارگذاری نشد: ${(reason as Error).message}`,
          );
        }
      }
      await load();
      setItemForm(null);
      setPendingItemImage(null);
      setNotice(
        itemForm.id
          ? "آیتم منو ویرایش شد."
          : pendingItemImage
            ? "آیتم جدید همراه تصویر به منو اضافه شد."
            : "آیتم جدید به منو اضافه شد.",
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/tenant/menu/${deleteTarget.kind === "category" ? "categories" : "items"}/${deleteTarget.id}`,
        { method: "DELETE" },
      );
      await load();
      setDeleteTarget(null);
      setNotice("مورد انتخاب‌شده حذف شد.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadImage(itemId: string, file: File) {
    const body = new FormData();
    body.set("focalX", "0.5");
    body.set("focalY", "0.5");
    body.set("file", file);
    return api<ItemImage>(`/tenant/menu/items/${itemId}/image`, {
      method: "POST",
      body,
    });
  }
  async function uploadItemImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !itemForm) return;
    if (!itemForm.id) {
      setPendingItemImage(file);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const image = await uploadImage(itemForm.id, file);
      setItemForm({ ...itemForm, image });
      setPendingItemImage(null);
      await load();
      setNotice("تصویر آیتم با نسخه‌های بهینه منتشر شد.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }
  async function updateItemImage(
    patch: Partial<Pick<ItemImage, "focalX" | "focalY">>,
  ) {
    if (!itemForm?.id || !itemForm.image) return;
    setBusy(true);
    setError("");
    try {
      const image = await api<ItemImage>(
        `/tenant/menu/items/${itemForm.id}/image`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      setItemForm({ ...itemForm, image });
      await load();
      setNotice("تمرکز تصویر ذخیره شد.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeItemImage() {
    if (!itemForm?.id || !itemForm.image || !confirm("تصویر این آیتم حذف شود؟"))
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/tenant/menu/items/${itemForm.id}/image`, {
        method: "DELETE",
      });
      setItemForm({ ...itemForm, image: null });
      await load();
      setNotice("تصویر آیتم حذف شد.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function updateVariant(index: number, patch: Partial<Variant>) {
    if (!itemForm) return;
    const variants = itemForm.variants.map((variant, position) =>
      position === index
        ? { ...variant, ...patch }
        : patch.isDefault
          ? { ...variant, isDefault: false }
          : variant,
    );
    setItemForm({ ...itemForm, variants });
  }
  return (
    <section className="admin-editor-shell">
      <header className="admin-page-heading">
        <div>
          <p className="eyebrow">محصولات و قیمت‌ها</p>
          <h1>منو</h1>
          <p>
            دسته‌ها، آیتم‌ها، اندازه‌ها، تصویر و وضعیت نمایش در سایت را مدیریت
            کنید.
          </p>
        </div>
        <div className="heading-actions">
          <a
            className="admin-preview-link"
            href="/#menu"
            target="_blank"
            rel="noreferrer"
          >
            مشاهده منو ↗
          </a>
          {canManage && (
            <button
              onClick={() => {
                setCategoryForm({ ...emptyCategory });
                setItemForm(null);
                setPendingItemImage(null);
              }}
            >
              دسته جدید
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="admin-message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-message success" role="status">
          {notice}
        </p>
      )}
      {busy && !categories.length ? (
        <div className="admin-inline-loading">
          <span className="admin-spinner" />
          در حال بارگذاری منو…
        </div>
      ) : (
        <div className="menu-editor-layout">
          <div className="menu-editor-list">
            {categories.map((category) => (
              <article className="editor-category" key={category.id}>
                <header>
                  <div>
                    <div className="category-title">
                      <h2>{category.name}</h2>
                      <span
                        className={category.isActive ? "active" : "inactive"}
                      >
                        {category.isActive ? "فعال" : "پنهان"}
                      </span>
                    </div>
                    {category.description && <p>{category.description}</p>}
                  </div>
                  {canManage && (
                    <div className="row-actions">
                      <button
                        className="quiet"
                        onClick={() => editCategory(category)}
                      >
                        ویرایش
                      </button>
                      <button
                        className="quiet"
                        onClick={() => {
                          setItemForm(emptyItem(category.id));
                          setCategoryForm(null);
                          setPendingItemImage(null);
                        }}
                      >
                        افزودن آیتم
                      </button>
                      <button
                        className="danger-link"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "category",
                            id: category.id,
                            name: category.name,
                          })
                        }
                      >
                        حذف
                      </button>
                    </div>
                  )}
                </header>
                <div className="editor-items">
                  {category.items.map((item) => (
                    <div
                      className={`editor-item ${item.isAvailable ? "" : "unavailable"}`}
                      key={item.id}
                    >
                      <div>
                        {item.image && (
                          <img
                            className="editor-item-preview"
                            src={item.image.sources.smallWebp}
                            alt=""
                            style={{
                              objectPosition: `${item.image.focalX * 100}% ${item.image.focalY * 100}%`,
                            }}
                          />
                        )}
                        <div className="item-heading">
                          <strong>{item.name}</strong>
                          {item.isFeatured && <span>پیشنهاد</span>}
                          {!item.isAvailable && (
                            <span className="muted">ناموجود</span>
                          )}
                        </div>
                        <p>{item.description || "بدون توضیح"}</p>
                        <small>
                          {item.variants.length
                            ? item.variants
                                .map(
                                  (variant) =>
                                    `${variant.name}: ${price(variant.priceToman)}`,
                                )
                                .join(" · ")
                            : item.basePriceToman
                              ? price(item.basePriceToman)
                              : "قیمت ثبت نشده"}
                        </small>
                      </div>
                      {canManage && (
                        <div className="row-actions">
                          <button
                            className="quiet"
                            onClick={() => editItem(category, item)}
                          >
                            ویرایش
                          </button>
                          <button
                            className="danger-link"
                            onClick={() =>
                              setDeleteTarget({
                                kind: "item",
                                id: item.id,
                                name: item.name,
                              })
                            }
                          >
                            حذف
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {!category.items.length && (
                    <div className="admin-empty">
                      <strong>این دسته هنوز آیتمی ندارد.</strong>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {!categories.length && (
              <div className="admin-empty">
                <strong>منوی شما خالی است</strong>
                <p>با ساخت اولین دسته‌بندی شروع کنید.</p>
              </div>
            )}
          </div>
          {(categoryForm || itemForm) && (
            <aside
              className="editor-panel"
              aria-label={categoryForm ? "فرم دسته‌بندی" : "فرم آیتم منو"}
            >
              {categoryForm ? (
                <form onSubmit={saveCategory}>
                  <header>
                    <h2>{categoryForm.id ? "ویرایش دسته" : "دسته جدید"}</h2>
                    <button
                      type="button"
                      className="close"
                      aria-label="بستن"
                      onClick={() => setCategoryForm(null)}
                    >
                      ×
                    </button>
                  </header>
                  <label>
                    نام دسته
                    <input
                      maxLength={100}
                      value={categoryForm.name}
                      onChange={(e) =>
                        setCategoryForm({
                          ...categoryForm,
                          name: e.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    توضیح
                    <textarea
                      maxLength={240}
                      value={categoryForm.description}
                      onChange={(e) =>
                        setCategoryForm({
                          ...categoryForm,
                          description: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    ترتیب نمایش
                    <input
                      type="number"
                      min={0}
                      value={categoryForm.sortOrder}
                      onChange={(e) =>
                        setCategoryForm({
                          ...categoryForm,
                          sortOrder: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="compact-toggle">
                    <input
                      type="checkbox"
                      checked={categoryForm.isActive}
                      onChange={(e) =>
                        setCategoryForm({
                          ...categoryForm,
                          isActive: e.target.checked,
                        })
                      }
                    />
                    در سایت نمایش داده شود
                  </label>
                  <button disabled={busy}>
                    {busy ? "در حال ذخیره…" : "ذخیره دسته"}
                  </button>
                </form>
              ) : (
                itemForm && (
                  <form onSubmit={saveItem}>
                    <header>
                      <h2>{itemForm.id ? "ویرایش آیتم" : "آیتم جدید"}</h2>
                      <button
                        type="button"
                        className="close"
                        aria-label="بستن"
                        onClick={() => {
                          setItemForm(null);
                          setPendingItemImage(null);
                        }}
                      >
                        ×
                      </button>
                    </header>
                    <label>
                      دسته
                      <select
                        value={itemForm.categoryId}
                        onChange={(e) =>
                          setItemForm({
                            ...itemForm,
                            categoryId: e.target.value,
                          })
                        }
                        required
                      >
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      نام آیتم
                      <input
                        maxLength={140}
                        value={itemForm.name}
                        onChange={(e) =>
                          setItemForm({ ...itemForm, name: e.target.value })
                        }
                        required
                      />
                    </label>
                    <label>
                      توضیح
                      <textarea
                        maxLength={500}
                        value={itemForm.description}
                        onChange={(e) =>
                          setItemForm({
                            ...itemForm,
                            description: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      قیمت پایه (تومان)
                      <input
                        type="number"
                        min={0}
                        value={itemForm.basePriceToman}
                        onChange={(e) =>
                          setItemForm({
                            ...itemForm,
                            basePriceToman: e.target.value,
                          })
                        }
                        placeholder={
                          itemForm.variants.length
                            ? "در صورت وجود اندازه اختیاری است"
                            : "مثلاً ۱۲۰۰۰۰"
                        }
                      />
                    </label>
                    <div className="inline-checks">
                      <label className="compact-toggle">
                        <input
                          type="checkbox"
                          checked={itemForm.isAvailable}
                          onChange={(e) =>
                            setItemForm({
                              ...itemForm,
                              isAvailable: e.target.checked,
                            })
                          }
                        />
                        موجود است
                      </label>
                      <label className="compact-toggle">
                        <input
                          type="checkbox"
                          checked={itemForm.isFeatured}
                          onChange={(e) =>
                            setItemForm({
                              ...itemForm,
                              isFeatured: e.target.checked,
                            })
                          }
                        />
                        پیشنهاد کافه
                      </label>
                    </div>
                    <label>
                      ترتیب نمایش
                      <input
                        type="number"
                        min={0}
                        value={itemForm.sortOrder}
                        onChange={(e) =>
                          setItemForm({
                            ...itemForm,
                            sortOrder: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <section
                      className="menu-image-manager"
                      aria-labelledby="menu-image-title"
                    >
                      <header>
                        <div>
                          <strong id="menu-image-title">تصویر آیتم</strong>
                          <small>
                            JPEG، PNG یا WebP؛ حداقل ۶۰۰×۶۰۰ پیکسل
                          </small>
                        </div>
                        <label className="media-upload">
                          {itemForm.image || pendingItemImage
                            ? "جایگزینی تصویر"
                            : "انتخاب تصویر"}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={busy}
                            onChange={uploadItemImage}
                          />
                        </label>
                      </header>
                      {itemForm.image ? (
                        <div className="menu-image-controls">
                          <img
                            src={itemForm.image.sources.smallWebp}
                            alt={`پیش‌نمایش ${itemForm.name}`}
                            style={{
                              objectPosition: `${itemForm.image.focalX * 100}% ${itemForm.image.focalY * 100}%`,
                            }}
                          />
                          <div>
                            <label>
                              تمرکز افقی
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={itemForm.image.focalX}
                                disabled={busy}
                                onChange={(event) =>
                                  updateItemImage({
                                    focalX: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              تمرکز عمودی
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={itemForm.image.focalY}
                                disabled={busy}
                                onChange={(event) =>
                                  updateItemImage({
                                    focalY: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="danger"
                              disabled={busy}
                              onClick={removeItemImage}
                            >
                              حذف تصویر
                            </button>
                          </div>
                        </div>
                      ) : pendingItemImage ? (
                        <p>
                          <strong>{pendingItemImage.name}</strong>
                          <br />
                          تصویر پس از ذخیره آیتم بارگذاری می‌شود.
                        </p>
                      ) : (
                        <p>
                          یک تصویر مربعی انتخاب کنید؛ برای آیتم جدید، تصویر
                          همراه ذخیره فرم بارگذاری می‌شود.
                        </p>
                      )}
                    </section>
                    <div className="variant-section">
                      <div>
                        <strong>اندازه‌ها و مدل‌ها</strong>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() =>
                            setItemForm({
                              ...itemForm,
                              variants: [
                                ...itemForm.variants,
                                {
                                  name: "",
                                  priceToman: "",
                                  isDefault: !itemForm.variants.length,
                                  isAvailable: true,
                                  sortOrder: itemForm.variants.length,
                                },
                              ],
                            })
                          }
                        >
                          افزودن اندازه
                        </button>
                      </div>
                      {itemForm.variants.map((variant, index) => (
                        <div className="variant-row" key={index}>
                          <input
                            aria-label={`نام اندازه ${index + 1}`}
                            placeholder="مثلاً بزرگ"
                            maxLength={80}
                            value={variant.name}
                            onChange={(e) =>
                              updateVariant(index, { name: e.target.value })
                            }
                            required
                          />
                          <input
                            aria-label={`قیمت اندازه ${index + 1}`}
                            type="number"
                            min={0}
                            placeholder="قیمت"
                            value={variant.priceToman}
                            onChange={(e) =>
                              updateVariant(index, {
                                priceToman: e.target.value,
                              })
                            }
                            required
                          />
                          <label title="اندازه پیش‌فرض">
                            <input
                              type="radio"
                              name="defaultVariant"
                              checked={variant.isDefault}
                              onChange={() =>
                                updateVariant(index, { isDefault: true })
                              }
                            />
                            پیش‌فرض
                          </label>
                          <button
                            type="button"
                            className="remove-variant"
                            aria-label={`حذف اندازه ${variant.name || index + 1}`}
                            onClick={() =>
                              setItemForm({
                                ...itemForm,
                                variants: itemForm.variants
                                  .filter((_, position) => position !== index)
                                  .map((entry, position, all) => ({
                                    ...entry,
                                    isDefault: all.some((row) => row.isDefault)
                                      ? entry.isDefault
                                      : position === 0,
                                  })),
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button disabled={busy}>
                      {busy ? "در حال ذخیره…" : "ذخیره آیتم"}
                    </button>
                  </form>
                )
              )}
            </aside>
          )}
        </div>
      )}
      {deleteTarget && (
        <div
          className="admin-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
        >
          <div>
            <p className="eyebrow">حذف از منو</p>
            <h2 id="delete-title">«{deleteTarget.name}» حذف شود؟</h2>
            <p>
              {deleteTarget.kind === "category"
                ? "دسته‌ای که آیتم دارد قابل حذف نیست."
                : "این آیتم از سایت عمومی هم حذف می‌شود."}
            </p>
            <div>
              <button className="quiet" onClick={() => setDeleteTarget(null)}>
                انصراف
              </button>
              <button className="danger" disabled={busy} onClick={remove}>
                حذف قطعی
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
