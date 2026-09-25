"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAdminSession } from "../admin-session";

type RewardType = "PERCENTAGE" | "FIXED_AMOUNT" | "FIXED_PRICE";
type AdvancedRewardType = Exclude<RewardType, "FIXED_PRICE">;
type AdvancedType = "BUY_X_GET_Y" | "BUNDLE" | "QUANTITY_TIER";
type Target = { type: "PRODUCT" | "CATEGORY"; id: string; name: string | null };
type Weekday = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
type ScheduleWindow = { daysOfWeek: Weekday[]; startTime: string; endTime: string; isAllDay: boolean };
type RuleGroup = { quantity: number; targets: Array<{ menuItemId?: string; categoryId?: string }> };
type RuleTier = { minimumQuantity: number; rewardType: AdvancedRewardType; rewardValue: number };
type AdvancedRule = { type: AdvancedType; repeatable?: boolean; buy?: RuleGroup; get?: RuleGroup; bundleComponents?: RuleGroup[]; quantityTarget?: RuleGroup; tiers?: RuleTier[] };
type CustomerConditionType = "FIRST_ORDER" | "ORDER_COUNT" | "TOTAL_SPENT" | "LAST_ORDER_AGE" | "REGISTRATION_AGE" | "CUSTOMER_SEGMENT";
type CustomerCondition = { type: CustomerConditionType; operator: "AT_LEAST" | "AT_MOST" | "EXACTLY" | "WITHIN_LAST" | null; value: string | null; customerSegmentId: string | null; customerSegmentName: string | null };
type CustomerSegment = { id: string; name: string; description: string | null; isActive: boolean; archived: boolean; memberCount: number };
type Promotion = { id: string; name: string; description: string | null; isActive: boolean; status: string; startAt: string | null; endAt: string | null; priority: number; rewardType: RewardType; rewardValue: string; targets: Target[]; entireOrder: boolean; minimumSubtotalToman: string | null; maxDiscountToman: string | null; advancedRule: AdvancedRule | null; customerConditions: CustomerCondition[]; schedule: { windows: Array<{ daysOfWeek: Weekday[]; startTime: string | null; endTime: string | null; isAllDay: boolean }> } | null; coupon: { code: string; isActive: boolean; startsAt: string | null; expiresAt: string | null; totalUsageLimit: number | null; perCustomerUsageLimit: number | null } | null };
type MenuItem = { id: string; name: string; isAvailable: boolean };
type Category = { id: string; name: string; isActive: boolean; items: MenuItem[] };
type GroupForm = { quantity: string; targetKeys: string[] };
type TierForm = { minimumQuantity: string; rewardType: AdvancedRewardType; rewardValue: string };
type FormState = { id?: string; name: string; description: string; rewardType: RewardType; rewardValue: string; priority: number; startAt: string; endAt: string; isActive: boolean; targetKeys: string[]; entireOrder: boolean; advancedType: AdvancedType | "SIMPLE"; buy: GroupForm; get: GroupForm; repeatable: boolean; bundleComponents: GroupForm[]; quantityTarget: GroupForm; tiers: TierForm[]; couponMode: boolean; couponCode: string; couponActive: boolean; couponStartsAt: string; couponExpiresAt: string; minimumSubtotalToman: string; maxDiscountToman: string; totalUsageLimit: string; perCustomerUsageLimit: string; scheduleEnabled: boolean; scheduleWindows: ScheduleWindow[]; firstOrder: boolean; orderCountOperator: "AT_LEAST" | "AT_MOST" | "EXACTLY"; orderCountValue: string; totalSpentValue: string; lastOrderAge: string; registrationAgeOperator: "" | "AT_LEAST" | "WITHIN_LAST"; registrationAgeValue: string; customerSegmentId: string };

const emptyWindow = (): ScheduleWindow => ({ daysOfWeek: [], startTime: "16:00", endTime: "19:00", isAllDay: false });
const weekdays: Array<{ value: Weekday; label: string }> = [{ value: "SATURDAY", label: "شنبه" }, { value: "SUNDAY", label: "یکشنبه" }, { value: "MONDAY", label: "دوشنبه" }, { value: "TUESDAY", label: "سه‌شنبه" }, { value: "WEDNESDAY", label: "چهارشنبه" }, { value: "THURSDAY", label: "پنجشنبه" }, { value: "FRIDAY", label: "جمعه" }];
const weekdayLabels = Object.fromEntries(weekdays.map(({ value, label }) => [value, label])) as Record<Weekday, string>;
const emptyGroup = (): GroupForm => ({ quantity: "1", targetKeys: [] });
const emptyForm = (): FormState => ({ name: "", description: "", rewardType: "PERCENTAGE", rewardValue: "20", priority: 0, startAt: "", endAt: "", isActive: false, targetKeys: [], entireOrder: false, advancedType: "SIMPLE", buy: emptyGroup(), get: emptyGroup(), repeatable: true, bundleComponents: [emptyGroup(), emptyGroup()], quantityTarget: emptyGroup(), tiers: [{ minimumQuantity: "3", rewardType: "PERCENTAGE", rewardValue: "10" }, { minimumQuantity: "5", rewardType: "PERCENTAGE", rewardValue: "15" }], couponMode: false, couponCode: "", couponActive: true, couponStartsAt: "", couponExpiresAt: "", minimumSubtotalToman: "", maxDiscountToman: "", totalUsageLimit: "", perCustomerUsageLimit: "", scheduleEnabled: false, scheduleWindows: [], firstOrder: false, orderCountOperator: "AT_LEAST", orderCountValue: "", totalSpentValue: "", lastOrderAge: "", registrationAgeOperator: "", registrationAgeValue: "", customerSegmentId: "" });
const rewardNames: Record<RewardType, string> = { PERCENTAGE: "درصدی", FIXED_AMOUNT: "مبلغ ثابت", FIXED_PRICE: "قیمت ویژه" };
const statusNames: Record<string, string> = { INACTIVE: "غیرفعال", UPCOMING: "در انتظار شروع", RUNNING: "فعال الآن", OUTSIDE_SCHEDULE: "خارج از ساعت تخفیف", EXPIRED: "پایان‌یافته", ARCHIVED: "بایگانی‌شده" };
const toman = new Intl.NumberFormat("fa-IR");

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string) { return value ? new Date(value).toISOString() : null; }
function localTime(value: string | null) { return value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "بدون محدودیت"; }
function targetKey(target: Pick<Target, "type" | "id">) { return `${target.type}:${target.id}`; }
function groupForm(group?: RuleGroup): GroupForm { return group ? { quantity: String(group.quantity), targetKeys: group.targets.map((target) => target.menuItemId ? `PRODUCT:${target.menuItemId}` : `CATEGORY:${target.categoryId}`) } : emptyGroup(); }
function ruleTargets(keys: string[]) { return keys.map((key) => { const [type, id] = key.split(":"); return type === "PRODUCT" ? { menuItemId: id } : { categoryId: id }; }); }

export function PromotionsAdmin() {
  const { access, api } = useAdminSession();
  const canRead = access.permissions.includes("menu.read") || access.permissions.includes("menu.manage");
  const canManage = access.permissions.includes("menu.manage");
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [segments, setSegments] = useState<CustomerSegment[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "منطقه زمانی دستگاه", []);

  const load = useCallback(async () => {
    const [rows, menu, customerSegments] = await Promise.all([api<Promotion[]>("/tenant/promotions"), api<Category[]>("/tenant/menu"), api<CustomerSegment[]>("/tenant/customer-segments")]);
    setPromotions(rows);
    setCategories(menu);
    setSegments(customerSegments);
  }, [api]);

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    load().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, [canRead, load]);

  function edit(promotion?: Promotion) {
    setError(""); setNotice("");
    const condition = (type: CustomerConditionType) => promotion?.customerConditions?.find((current) => current.type === type);
    setForm(promotion ? {
      id: promotion.id, name: promotion.name, description: promotion.description ?? "", rewardType: promotion.rewardType,
      rewardValue: promotion.rewardValue, priority: promotion.priority, startAt: toLocalInput(promotion.startAt), endAt: toLocalInput(promotion.endAt),
      isActive: promotion.isActive, targetKeys: promotion.targets.map(targetKey), entireOrder: promotion.entireOrder,
      advancedType: promotion.advancedRule?.type ?? "SIMPLE", buy: groupForm(promotion.advancedRule?.buy), get: groupForm(promotion.advancedRule?.get), repeatable: promotion.advancedRule?.repeatable ?? true,
      bundleComponents: promotion.advancedRule?.bundleComponents?.map(groupForm) ?? [emptyGroup(), emptyGroup()],
      quantityTarget: groupForm(promotion.advancedRule?.quantityTarget),
      tiers: promotion.advancedRule?.tiers?.map((tier) => ({ minimumQuantity: String(tier.minimumQuantity), rewardType: tier.rewardType, rewardValue: String(tier.rewardValue) })) ?? emptyForm().tiers,
      couponMode: Boolean(promotion.coupon), couponCode: promotion.coupon?.code ?? "", couponActive: promotion.coupon?.isActive ?? true,
      couponStartsAt: toLocalInput(promotion.coupon?.startsAt ?? null), couponExpiresAt: toLocalInput(promotion.coupon?.expiresAt ?? null),
      minimumSubtotalToman: promotion.minimumSubtotalToman ?? "", maxDiscountToman: promotion.maxDiscountToman ?? "",
      totalUsageLimit: String(promotion.coupon?.totalUsageLimit ?? ""), perCustomerUsageLimit: String(promotion.coupon?.perCustomerUsageLimit ?? ""),
      scheduleEnabled: Boolean(promotion.schedule), scheduleWindows: promotion.schedule?.windows.map((window) => ({ ...window, startTime: window.startTime ?? "", endTime: window.endTime ?? "" })) ?? [],
      firstOrder: Boolean(condition("FIRST_ORDER")),
      orderCountOperator: (condition("ORDER_COUNT")?.operator as FormState["orderCountOperator"] | undefined) ?? "AT_LEAST",
      orderCountValue: condition("ORDER_COUNT")?.value ?? "",
      totalSpentValue: condition("TOTAL_SPENT")?.value ?? "",
      lastOrderAge: condition("LAST_ORDER_AGE")?.value ?? "",
      registrationAgeOperator: (condition("REGISTRATION_AGE")?.operator as FormState["registrationAgeOperator"] | undefined) ?? "",
      registrationAgeValue: condition("REGISTRATION_AGE")?.value ?? "",
      customerSegmentId: condition("CUSTOMER_SEGMENT")?.customerSegmentId ?? "",
    } : emptyForm());
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const advancedRule: AdvancedRule | undefined = form.advancedType === "BUY_X_GET_Y"
        ? { type: form.advancedType, repeatable: form.repeatable, buy: { quantity: Number(form.buy.quantity), targets: ruleTargets(form.buy.targetKeys) }, get: { quantity: Number(form.get.quantity), targets: ruleTargets(form.get.targetKeys) } }
        : form.advancedType === "BUNDLE"
          ? { type: form.advancedType, repeatable: form.repeatable, bundleComponents: form.bundleComponents.map((group) => ({ quantity: Number(group.quantity), targets: ruleTargets(group.targetKeys) })) }
          : form.advancedType === "QUANTITY_TIER"
            ? { type: form.advancedType, quantityTarget: { quantity: 1, targets: ruleTargets(form.quantityTarget.targetKeys) }, tiers: form.tiers.map((tier) => ({ minimumQuantity: Number(tier.minimumQuantity), rewardType: tier.rewardType, rewardValue: Number(tier.rewardValue) })) }
            : undefined;
      const selectedTier = form.tiers.at(-1);
      const rewardType = form.advancedType === "BUNDLE" ? "FIXED_PRICE" : form.advancedType === "QUANTITY_TIER" ? selectedTier?.rewardType ?? "PERCENTAGE" : form.rewardType;
      const rewardValue = form.advancedType === "BUNDLE" ? Number(form.rewardValue) : form.advancedType === "QUANTITY_TIER" ? Number(selectedTier?.rewardValue || 1) : Number(form.rewardValue);
      const customerConditions: Array<{ type: CustomerConditionType; operator?: string; value?: number; customerSegmentId?: string }> = [];
      if (form.firstOrder) customerConditions.push({ type: "FIRST_ORDER" });
      if (form.orderCountValue !== "") customerConditions.push({ type: "ORDER_COUNT", operator: form.orderCountOperator, value: Number(form.orderCountValue) });
      if (form.totalSpentValue !== "") customerConditions.push({ type: "TOTAL_SPENT", operator: "AT_LEAST", value: Number(form.totalSpentValue) });
      if (form.lastOrderAge !== "") customerConditions.push({ type: "LAST_ORDER_AGE", operator: "AT_LEAST", value: Number(form.lastOrderAge) });
      if (form.registrationAgeOperator && form.registrationAgeValue !== "") customerConditions.push({ type: "REGISTRATION_AGE", operator: form.registrationAgeOperator, value: Number(form.registrationAgeValue) });
      if (form.customerSegmentId) customerConditions.push({ type: "CUSTOMER_SEGMENT", customerSegmentId: form.customerSegmentId });
      await api(form.id ? `/tenant/promotions/${form.id}` : "/tenant/promotions", {
        method: form.id ? "PATCH" : "POST",
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() || null, rewardType, rewardValue, priority: Number(form.priority), startAt: fromLocalInput(form.startAt), endAt: fromLocalInput(form.endAt), entireOrder: form.advancedType === "SIMPLE" && form.entireOrder, targets: form.advancedType !== "SIMPLE" || form.entireOrder ? [] : ruleTargets(form.targetKeys),
          advancedRule, minimumSubtotalToman: form.advancedType === "SIMPLE" && form.minimumSubtotalToman ? Number(form.minimumSubtotalToman) : null,
          maxDiscountToman: form.advancedType === "SIMPLE" && form.maxDiscountToman && rewardType === "PERCENTAGE" ? Number(form.maxDiscountToman) : null,
          ...(form.couponMode ? { couponCode: form.couponCode.trim(), couponActive: form.couponActive, couponStartsAt: fromLocalInput(form.couponStartsAt), couponExpiresAt: fromLocalInput(form.couponExpiresAt), totalUsageLimit: form.totalUsageLimit ? Number(form.totalUsageLimit) : null, perCustomerUsageLimit: form.perCustomerUsageLimit ? Number(form.perCustomerUsageLimit) : null } : {}),
          schedule: form.scheduleEnabled ? { windows: form.scheduleWindows.map((window) => window.isAllDay ? { daysOfWeek: window.daysOfWeek, isAllDay: true } : window) } : null,
          customerConditions,
          ...(!form.id ? { isActive: form.isActive } : {}) }),
      });
      await load(); setForm(null); setNotice(form.id ? "تخفیف ویرایش شد." : "تخفیف ساخته شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function run(id: string, action: "activate" | "deactivate" | "archive") {
    if (action === "archive" && !confirm("این تخفیف بایگانی شود؟ سفارش‌های قبلی همچنان اطلاعات مالی خود را حفظ می‌کنند.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/tenant/promotions/${id}${action === "archive" ? "" : `/${action}`}`, { method: action === "archive" ? "DELETE" : "POST" });
      await load(); setNotice(action === "archive" ? "تخفیف بایگانی شد." : action === "activate" ? "تخفیف فعال شد." : "تخفیف غیرفعال شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function toggleTarget(key: string) {
    if (!form) return;
    setForm({ ...form, targetKeys: form.targetKeys.includes(key) ? form.targetKeys.filter((current) => current !== key) : [...form.targetKeys, key] });
  }

  function toggleGroupTarget(groupName: "buy" | "get" | "quantityTarget", key: string) {
    if (!form) return;
    const group = form[groupName];
    setForm({ ...form, [groupName]: { ...group, targetKeys: group.targetKeys.includes(key) ? group.targetKeys.filter((value) => value !== key) : [...group.targetKeys, key] } });
  }

  function updateGroup(groupName: "buy" | "get" | "quantityTarget", update: Partial<GroupForm>) {
    if (form) setForm({ ...form, [groupName]: { ...form[groupName], ...update } });
  }

  function toggleBundleTarget(index: number, key: string) {
    if (!form) return;
    setForm({ ...form, bundleComponents: form.bundleComponents.map((group, current) => current === index ? { ...group, targetKeys: group.targetKeys.includes(key) ? group.targetKeys.filter((value) => value !== key) : [...group.targetKeys, key] } : group) });
  }

  function updateBundle(index: number, update: Partial<GroupForm>) {
    if (form) setForm({ ...form, bundleComponents: form.bundleComponents.map((group, current) => current === index ? { ...group, ...update } : group) });
  }

  function updateTier(index: number, update: Partial<TierForm>) {
    if (form) setForm({ ...form, tiers: form.tiers.map((tier, current) => current === index ? { ...tier, ...update } : tier) });
  }

  function updateScheduleWindow(index: number, update: Partial<ScheduleWindow>) {
    if (!form) return;
    setForm({ ...form, scheduleWindows: form.scheduleWindows.map((window, current) => current === index ? { ...window, ...update } : window) });
  }

  function scheduleSummary(promotion: Promotion) {
    if (!promotion.schedule) return "همیشه در بازه فعال";
    return promotion.schedule.windows.map((window) => {
      const days = window.daysOfWeek.map((day) => weekdayLabels[day]).join("، ");
      if (window.isAllDay) return `${days} · تمام روز`;
      const overnight = window.endTime! < window.startTime! ? " (روز بعد)" : "";
      return `${days} · ${window.startTime!.slice(0, 5)} تا ${window.endTime!.slice(0, 5)}${overnight}`;
    }).join("؛ ");
  }

  function customerSummary(promotion: Promotion) {
    if (!promotion.customerConditions?.length) return "همه مشتریان";
    return promotion.customerConditions.map((condition) => {
      const value = Number(condition.value ?? 0);
      if (condition.type === "FIRST_ORDER") return "اولین سفارش";
      if (condition.type === "ORDER_COUNT") return `${condition.operator === "AT_MOST" ? "حداکثر" : condition.operator === "EXACTLY" ? "دقیقاً" : "حداقل"} ${toman.format(value)} سفارش`;
      if (condition.type === "TOTAL_SPENT") return `حداقل ${toman.format(value)} تومان خرید`;
      if (condition.type === "LAST_ORDER_AGE") return `بدون سفارش موفق طی ${toman.format(value)} روز`;
      if (condition.type === "REGISTRATION_AGE") return condition.operator === "WITHIN_LAST" ? `ثبت‌نام در ${toman.format(value)} روز اخیر` : `ثبت‌نام حداقل ${toman.format(value)} روز قبل`;
      return `گروه ${condition.customerSegmentName ?? "بایگانی‌شده"}`;
    }).join(" + ");
  }

  const invalidSchedule = Boolean(form?.scheduleEnabled && (!form.scheduleWindows.length || form.scheduleWindows.some((window) => !window.daysOfWeek.length || (!window.isAllDay && (!window.startTime || !window.endTime || window.startTime === window.endTime)))));
  const validGroup = (group: GroupForm) => Number.isInteger(Number(group.quantity)) && Number(group.quantity) >= 1 && Number(group.quantity) <= 50 && group.targetKeys.length > 0;
  const invalidRule = Boolean(form && (form.advancedType === "BUY_X_GET_Y" && (!validGroup(form.buy) || !validGroup(form.get)
    || form.rewardType === "FIXED_PRICE")
    || form.advancedType === "BUNDLE" && (form.bundleComponents.length < 2 || form.bundleComponents.some((group) => !validGroup(group)) || !Number.isSafeInteger(Number(form.rewardValue)) || Number(form.rewardValue) < 0)
    || form.advancedType === "QUANTITY_TIER" && (!form.quantityTarget.targetKeys.length || !form.tiers.length || form.tiers.some((tier, index) => !Number.isInteger(Number(tier.minimumQuantity)) || Number(tier.minimumQuantity) < 1 || Number(tier.minimumQuantity) > 50 || (index > 0 && Number(tier.minimumQuantity) <= Number(form.tiers[index - 1]?.minimumQuantity)) || !Number.isSafeInteger(Number(tier.rewardValue)) || Number(tier.rewardValue) < 1 || (tier.rewardType === "PERCENTAGE" && Number(tier.rewardValue) > 100)))));
  const targetPicker = (legend: string, keys: string[], onToggle: (key: string) => void) => <fieldset className="promotion-targets"><legend>{legend}</legend>{categories.map((category) => <div className="promotion-target-group" key={category.id}><label className="promotion-target-option"><input type="checkbox" checked={keys.includes(`CATEGORY:${category.id}`)} onChange={() => onToggle(`CATEGORY:${category.id}`)} /><strong>دسته‌بندی: {category.name}</strong></label>{category.items.map((item) => <label className="promotion-target-option promotion-product-option" key={item.id}><input type="checkbox" checked={keys.includes(`PRODUCT:${item.id}`)} onChange={() => onToggle(`PRODUCT:${item.id}`)} /><span>{item.name}{!item.isAvailable && <small> · ناموجود</small>}</span></label>)}</div>)}</fieldset>;
  const promotionTypeNames: Record<AdvancedType | "SIMPLE", string> = { SIMPLE: "تخفیف معمولی", BUY_X_GET_Y: "خرید X، دریافت Y", BUNDLE: "پکیج / کمبو", QUANTITY_TIER: "تخفیف تعدادی" };
  function targetNames(group?: RuleGroup) {
    return group?.targets.map((target) => target.menuItemId
      ? categories.flatMap((category) => category.items).find((item) => item.id === target.menuItemId)?.name ?? "محصول"
      : categories.find((category) => category.id === target.categoryId)?.name ?? "دسته‌بندی").join("، ") ?? "—";
  }
  function advancedSummary(promotion: Promotion) {
    const rule = promotion.advancedRule!;
    if (rule.type === "BUY_X_GET_Y") return `خرید ${rule.buy?.quantity} از ${targetNames(rule.buy)}، دریافت ${rule.get?.quantity} از ${targetNames(rule.get)}${rule.repeatable ? " · تکرارپذیر" : " · یک‌بار"}`;
    if (rule.type === "BUNDLE") return `${rule.bundleComponents?.map((group) => `${group.quantity} × ${targetNames(group)}`).join(" + ")} = ${toman.format(Number(promotion.rewardValue))} تومان${rule.repeatable ? " · تکرارپذیر" : " · یک‌بار"}`;
    return `${targetNames(rule.quantityTarget)} · ${rule.tiers?.map((tier) => `${tier.minimumQuantity}+ → ${tier.rewardType === "PERCENTAGE" ? `${tier.rewardValue}%` : `${toman.format(tier.rewardValue)} تومان`}`).join("، ")}`;
  }

  if (!canRead) return <section className="admin-section-state"><p className="eyebrow">دسترسی محدود</p><h1>تخفیف‌ها</h1><p>نقش شما اجازه مشاهده تخفیف‌ها را ندارد.</p></section>;

  return <section className="admin-promotions" aria-labelledby="promotions-title">
    <header className="admin-page-heading"><div><p className="eyebrow">منو و قیمت‌گذاری</p><h1 id="promotions-title">تخفیف‌ها</h1><p>برای محصولات یا دسته‌بندی‌های منو، قیمت ویژه تعریف کنید.</p></div><div className="promotion-form-actions"><Link className="promotion-secondary" href="/admin/promotions/segments">گروه‌های مشتریان</Link>{canManage && !form && <button type="button" onClick={() => edit()}>ایجاد تخفیف</button>}</div></header>
    {error && <p className="admin-message error" role="alert">{error}</p>}{notice && <p className="admin-message success" role="status">{notice}</p>}
    {form && <form className="promotion-form" onSubmit={(event) => void save(event)}>
      <div className="promotion-form-heading"><div><h2>{form.id ? "ویرایش تخفیف" : "تخفیف جدید"}</h2><p>قیمت اصلی منو تغییر نمی‌کند؛ بازه تاریخ و زمان‌بندی هفتگی با هم اعمال می‌شوند.</p></div><button type="button" className="promotion-cancel" onClick={() => setForm(null)}>بستن</button></div>
      <div className="promotion-form-grid">
        <label>نام تخفیف<input value={form.name} maxLength={120} required onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>نوع پروموشن<select value={form.advancedType} disabled={Boolean(form.id)} onChange={(event) => { const advancedType = event.target.value as FormState["advancedType"]; setForm({ ...form, advancedType, entireOrder: false, targetKeys: [], rewardType: advancedType === "BUNDLE" ? "FIXED_PRICE" : advancedType === "QUANTITY_TIER" ? "PERCENTAGE" : form.rewardType === "FIXED_PRICE" ? "PERCENTAGE" : form.rewardType }); }}><option value="SIMPLE">تخفیف معمولی</option><option value="BUY_X_GET_Y">خرید X، دریافت Y</option><option value="BUNDLE">پکیج / کمبو</option><option value="QUANTITY_TIER">تخفیف تعدادی</option></select></label>
        {(form.advancedType === "SIMPLE" || form.advancedType === "BUY_X_GET_Y") && <label>نوع پاداش<select value={form.rewardType} onChange={(event) => setForm({ ...form, rewardType: event.target.value as RewardType })}>{Object.entries(rewardNames).filter(([value]) => form.advancedType !== "BUY_X_GET_Y" || value !== "FIXED_PRICE").filter(([value]) => form.advancedType !== "SIMPLE" || !form.entireOrder || value !== "FIXED_PRICE").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        {(form.advancedType === "SIMPLE" || form.advancedType === "BUY_X_GET_Y" || form.advancedType === "BUNDLE") && <label>{form.advancedType === "BUNDLE" ? "قیمت پکیج (تومان)" : form.rewardType === "PERCENTAGE" ? "درصد تخفیف" : form.rewardType === "FIXED_AMOUNT" ? "مبلغ تخفیف (تومان)" : "قیمت ویژه (تومان)"}<input type="number" min={form.rewardType === "FIXED_PRICE" ? 0 : 1} max={form.rewardType === "PERCENTAGE" ? 100 : Number.MAX_SAFE_INTEGER} step={1} required value={form.rewardValue} onChange={(event) => setForm({ ...form, rewardValue: event.target.value })} /></label>}
        <label>اولویت در تخفیف‌های هم‌مقدار<input type="number" min={0} max={1000000} step={1} value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })} /></label>
        <label>روش اعمال<select value={form.couponMode ? "COUPON" : "AUTO"} disabled={Boolean(form.id)} onChange={(event) => setForm({ ...form, couponMode: event.target.value === "COUPON" })}><option value="AUTO">خودکار</option><option value="COUPON">با کد تخفیف</option></select></label>
        {form.advancedType === "SIMPLE" && <><label>اعمال روی<select value={form.entireOrder ? "ORDER" : "ITEMS"} onChange={(event) => setForm({ ...form, entireOrder: event.target.value === "ORDER", targetKeys: event.target.value === "ORDER" ? [] : form.targetKeys, rewardType: event.target.value === "ORDER" && form.rewardType === "FIXED_PRICE" ? "PERCENTAGE" : form.rewardType })}><option value="ITEMS">محصولات یا دسته‌بندی</option><option value="ORDER">کل سفارش</option></select></label><label>حداقل مبلغ سفارش (تومان)<input type="number" min={0} step={1} value={form.minimumSubtotalToman} onChange={(event) => setForm({ ...form, minimumSubtotalToman: event.target.value })} /></label>{form.rewardType === "PERCENTAGE" && <label>سقف تخفیف (تومان)<input type="number" min={1} step={1} value={form.maxDiscountToman} onChange={(event) => setForm({ ...form, maxDiscountToman: event.target.value })} /></label>}</>}
        {form.couponMode && <><label>کد تخفیف<input dir="ltr" pattern="[A-Za-z0-9_-]{3,64}" required value={form.couponCode} onChange={(event) => setForm({ ...form, couponCode: event.target.value })} /></label><label>شروع کد<input type="datetime-local" value={form.couponStartsAt} onChange={(event) => setForm({ ...form, couponStartsAt: event.target.value })} /></label><label>پایان کد<input type="datetime-local" value={form.couponExpiresAt} onChange={(event) => setForm({ ...form, couponExpiresAt: event.target.value })} /></label><label>تعداد کل استفاده<input type="number" min={1} value={form.totalUsageLimit} onChange={(event) => setForm({ ...form, totalUsageLimit: event.target.value })} /></label><label>تعداد استفاده هر مشتری<input type="number" min={1} value={form.perCustomerUsageLimit} onChange={(event) => setForm({ ...form, perCustomerUsageLimit: event.target.value })} /></label><label>وضعیت کد<input type="checkbox" checked={form.couponActive} onChange={(event) => setForm({ ...form, couponActive: event.target.checked })} /> فعال</label></>}
        <label className="promotion-wide">توضیحات <small>اختیاری</small><textarea maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label>شروع <small>به وقت {timeZone}</small><input type="datetime-local" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} /></label>
        <label>پایان <small>به وقت {timeZone}</small><input type="datetime-local" value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} /></label>
      </div>
      <fieldset className="promotion-schedule"><legend>زمان‌بندی تخفیف</legend><label className="promotion-schedule-toggle"><input type="checkbox" checked={form.scheduleEnabled} onChange={(event) => setForm({ ...form, scheduleEnabled: event.target.checked, scheduleWindows: event.target.checked ? form.scheduleWindows.length ? form.scheduleWindows : [emptyWindow()] : [] })} />فقط در روزها و ساعت‌های مشخص فعال باشد</label>
        {form.scheduleEnabled && <><p>ساعت‌ها بر اساس منطقه زمانی کافه هستند: <bdi dir="ltr">{access.tenant.timezone}</bdi></p>{form.scheduleWindows.map((window, index) => <div className="promotion-schedule-window" key={index}>
          <div className="promotion-schedule-window-heading"><strong>بازه {index + 1}</strong><button type="button" className="promotion-cancel" onClick={() => setForm({ ...form, scheduleWindows: form.scheduleWindows.filter((_, current) => current !== index) })}>حذف بازه</button></div>
          <fieldset className="promotion-schedule-days"><legend>روزهای هفته</legend>{weekdays.map((day) => <label key={day.value}><input type="checkbox" checked={window.daysOfWeek.includes(day.value)} onChange={(event) => updateScheduleWindow(index, { daysOfWeek: event.target.checked ? [...window.daysOfWeek, day.value] : window.daysOfWeek.filter((value) => value !== day.value) })} />{day.label}</label>)}</fieldset>
          <label className="promotion-schedule-all-day"><input type="checkbox" checked={window.isAllDay} onChange={(event) => updateScheduleWindow(index, { isAllDay: event.target.checked, startTime: event.target.checked ? "" : window.startTime || "08:00", endTime: event.target.checked ? "" : window.endTime || "11:00" })} />تمام روز</label>
          {!window.isAllDay && <div className="promotion-schedule-times"><label>از ساعت<input type="time" dir="ltr" required value={window.startTime} onChange={(event) => updateScheduleWindow(index, { startTime: event.target.value })} /></label><label>تا ساعت<input type="time" dir="ltr" required value={window.endTime} onChange={(event) => updateScheduleWindow(index, { endTime: event.target.value })} /></label><small>زمان پایان شامل نمی‌شود؛ ساعت زودتر یعنی بازه تا روز بعد ادامه دارد.</small></div>}
        </div>)}<button type="button" className="promotion-secondary" onClick={() => setForm({ ...form, scheduleWindows: [...form.scheduleWindows, { ...emptyWindow(), startTime: "08:00", endTime: "11:00" }] })}>+ افزودن بازه زمانی</button></>}
      </fieldset>
      <fieldset className="promotion-schedule"><legend>شرایط مشتری</legend><p>هر شرط انتخاب‌شده باید برقرار باشد. گروه‌ها فقط برای مشتریانی بررسی می‌شوند که وارد حساب شده‌اند.</p>
        <label className="promotion-schedule-toggle"><input type="checkbox" checked={form.firstOrder} onChange={(event) => setForm({ ...form, firstOrder: event.target.checked })} />فقط اولین سفارش موفق</label>
        <div className="promotion-form-grid">
          <label>تعداد سفارش‌های موفق<select value={form.orderCountValue ? form.orderCountOperator : ""} onChange={(event) => setForm({ ...form, orderCountOperator: (event.target.value || "AT_LEAST") as FormState["orderCountOperator"], orderCountValue: event.target.value ? form.orderCountValue || "10" : "" })}><option value="">بدون شرط</option><option value="AT_LEAST">حداقل</option><option value="AT_MOST">حداکثر</option><option value="EXACTLY">دقیقاً</option></select><input type="number" min={0} step={1} value={form.orderCountValue} onChange={(event) => setForm({ ...form, orderCountValue: event.target.value })} /></label>
          <label>حداقل مجموع خرید (تومان)<input type="number" min={0} step={1} value={form.totalSpentValue} onChange={(event) => setForm({ ...form, totalSpentValue: event.target.value })} /><small>بر اساس سفارش‌های تحویل‌شده همین کافه</small></label>
          <label>آخرین سفارش موفق حداقل چند روز قبل<input type="number" min={1} max={36500} step={1} value={form.lastOrderAge} onChange={(event) => setForm({ ...form, lastOrderAge: event.target.value })} /><small>مشتری بدون سفارش قبلی شامل این شرط نمی‌شود.</small></label>
          <label>مدت از ثبت‌نام<select value={form.registrationAgeOperator} onChange={(event) => setForm({ ...form, registrationAgeOperator: event.target.value as FormState["registrationAgeOperator"] })}><option value="">بدون شرط</option><option value="WITHIN_LAST">ثبت‌نام در روزهای اخیر</option><option value="AT_LEAST">ثبت‌نام حداقل چند روز قبل</option></select><input type="number" min={1} max={36500} step={1} disabled={!form.registrationAgeOperator} value={form.registrationAgeValue} onChange={(event) => setForm({ ...form, registrationAgeValue: event.target.value })} /></label>
          <label>گروه مشتریان<select value={form.customerSegmentId} onChange={(event) => setForm({ ...form, customerSegmentId: event.target.value })}><option value="">بدون شرط گروه</option>{segments.find((segment) => segment.id === form.customerSegmentId && (!segment.isActive || segment.archived)) && <option value={form.customerSegmentId}>{segments.find((segment) => segment.id === form.customerSegmentId)?.name} · غیرفعال</option>}{segments.filter((segment) => segment.isActive && !segment.archived).map((segment) => <option value={segment.id} key={segment.id}>{segment.name} · {toman.format(segment.memberCount)} عضو</option>)}</select></label>
        </div>
      </fieldset>
      {invalidSchedule && <p className="admin-message error" role="alert">برای هر بازه، دست‌کم یک روز و ساعت معتبر انتخاب کنید.</p>}
      {form.advancedType === "SIMPLE" && !form.entireOrder && targetPicker("اعمال روی محصولات یا دسته‌بندی‌ها", form.targetKeys, toggleTarget)}
      {form.advancedType === "BUY_X_GET_Y" && <><section className="promotion-schedule-window"><label>تعداد خرید<input type="number" min={1} max={50} required value={form.buy.quantity} onChange={(event) => updateGroup("buy", { quantity: event.target.value })} /></label>{targetPicker("خرید از این محصولات یا دسته‌بندی‌ها", form.buy.targetKeys, (key) => toggleGroupTarget("buy", key))}</section><section className="promotion-schedule-window"><label>تعداد پاداش<input type="number" min={1} max={50} required value={form.get.quantity} onChange={(event) => updateGroup("get", { quantity: event.target.value })} /></label>{targetPicker("پاداش از این محصولات یا دسته‌بندی‌ها", form.get.targetKeys, (key) => toggleGroupTarget("get", key))}</section><label className="promotion-activate"><input type="checkbox" checked={form.repeatable} onChange={(event) => setForm({ ...form, repeatable: event.target.checked })} />تکرار بر اساس تعداد خرید</label></>}
      {form.advancedType === "BUNDLE" && <fieldset className="promotion-schedule"><legend>اقلام پکیج</legend>{form.bundleComponents.map((group, index) => <section className="promotion-schedule-window" key={index}><div className="promotion-schedule-window-heading"><strong>جزء {index + 1}</strong>{form.bundleComponents.length > 2 && <button type="button" className="promotion-cancel" onClick={() => setForm({ ...form, bundleComponents: form.bundleComponents.filter((_, current) => current !== index) })}>حذف جزء</button>}</div><label>تعداد<input type="number" min={1} max={50} required value={group.quantity} onChange={(event) => updateBundle(index, { quantity: event.target.value })} /></label>{targetPicker("محصول یا دسته‌بندی", group.targetKeys, (key) => toggleBundleTarget(index, key))}</section>)}<button type="button" className="promotion-secondary" onClick={() => setForm({ ...form, bundleComponents: [...form.bundleComponents, emptyGroup()] })}>+ افزودن جزء</button><label className="promotion-activate"><input type="checkbox" checked={form.repeatable} onChange={(event) => setForm({ ...form, repeatable: event.target.checked })} />اعمال مجدد برای مجموعه‌های بعدی</label></fieldset>}
      {form.advancedType === "QUANTITY_TIER" && <><section className="promotion-schedule-window">{targetPicker("اعمال روی این محصولات یا دسته‌بندی‌ها", form.quantityTarget.targetKeys, (key) => toggleGroupTarget("quantityTarget", key))}</section><fieldset className="promotion-schedule"><legend>پلکان تخفیف</legend>{form.tiers.map((tier, index) => <div className="promotion-schedule-window" key={index}><div className="promotion-schedule-window-heading"><strong>سطح {index + 1}</strong>{form.tiers.length > 1 && <button type="button" className="promotion-cancel" onClick={() => setForm({ ...form, tiers: form.tiers.filter((_, current) => current !== index) })}>حذف سطح</button>}</div><label>حداقل تعداد<input type="number" min={1} max={50} required value={tier.minimumQuantity} onChange={(event) => updateTier(index, { minimumQuantity: event.target.value })} /></label><label>نوع تخفیف<select value={tier.rewardType} onChange={(event) => updateTier(index, { rewardType: event.target.value as AdvancedRewardType })}><option value="PERCENTAGE">درصدی</option><option value="FIXED_AMOUNT">مبلغ ثابت</option></select></label><label>{tier.rewardType === "PERCENTAGE" ? "درصد" : "تومان"}<input type="number" min={1} max={tier.rewardType === "PERCENTAGE" ? 100 : Number.MAX_SAFE_INTEGER} step={1} required value={tier.rewardValue} onChange={(event) => updateTier(index, { rewardValue: event.target.value })} /></label></div>)}<button type="button" className="promotion-secondary" onClick={() => setForm({ ...form, tiers: [...form.tiers, { minimumQuantity: "", rewardType: "PERCENTAGE", rewardValue: "10" }] })}>+ افزودن سطح</button></fieldset></>}
      {invalidRule && <p className="admin-message error" role="alert">قانون تخفیف را با تعداد، هدف و مقدار معتبر کامل کنید.</p>}
      {!categories.length && <p className="admin-message error">ابتدا برای منو دسته‌بندی و محصول بسازید.</p>}
      {!form.id && <label className="promotion-activate"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />از همین حالا فعال باشد</label>}
      <div className="promotion-form-actions"><button disabled={busy || !canManage || (form.advancedType === "SIMPLE" && !form.entireOrder && !form.targetKeys.length) || invalidSchedule || invalidRule}>{busy ? "در حال ذخیره…" : "ذخیره تخفیف"}</button><button type="button" className="promotion-cancel" onClick={() => setForm(null)}>انصراف</button></div>
    </form>}
    {loading ? <p className="admin-inline-loading" role="status">در حال دریافت تخفیف‌ها…</p> : promotions.length ? <div className="promotion-list">{promotions.map((promotion) => <article className="promotion-card" key={promotion.id}><div className="promotion-card-heading"><div><h2>{promotion.name}</h2>{promotion.description && <p>{promotion.description}</p>}</div><span className={`promotion-status promotion-status-${promotion.status.toLowerCase()}`}>{statusNames[promotion.status] ?? promotion.status}</span></div><dl><div><dt>نوع</dt><dd>{promotionTypeNames[promotion.advancedRule?.type ?? "SIMPLE"]}</dd></div><div><dt>پاداش</dt><dd>{rewardNames[promotion.rewardType]} · {promotion.rewardType === "PERCENTAGE" ? `${toman.format(Number(promotion.rewardValue))}٪` : `${toman.format(Number(promotion.rewardValue))} تومان`}</dd></div><div><dt>روش</dt><dd>{promotion.coupon ? `کد ${promotion.coupon.code}${promotion.coupon.isActive ? "" : " (غیرفعال)"}` : "خودکار"}</dd></div><div><dt>شرایط مشتری</dt><dd>{customerSummary(promotion)}</dd></div><div><dt>حداقل سفارش</dt><dd>{promotion.minimumSubtotalToman ? `${toman.format(Number(promotion.minimumSubtotalToman))} تومان` : "ندارد"}</dd></div><div><dt>سقف تخفیف</dt><dd>{promotion.maxDiscountToman ? `${toman.format(Number(promotion.maxDiscountToman))} تومان` : "ندارد"}</dd></div><div><dt>اولویت</dt><dd>{toman.format(promotion.priority)}</dd></div><div><dt>شروع</dt><dd>{localTime(promotion.startAt)}</dd></div><div><dt>پایان</dt><dd>{localTime(promotion.endAt)}</dd></div><div className="promotion-target-summary"><dt>قانون</dt><dd>{promotion.advancedRule ? advancedSummary(promotion) : promotion.entireOrder ? "کل سفارش" : promotion.targets.map((target) => `${target.type === "CATEGORY" ? "دسته" : "محصول"}: ${target.name ?? "حذف‌شده"}`).join("، ")}</dd></div><div className="promotion-target-summary"><dt>زمان‌بندی</dt><dd>{scheduleSummary(promotion)}{promotion.schedule && <small> · <bdi dir="ltr">{access.tenant.timezone}</bdi></small>}</dd></div></dl><div className="promotion-card-actions">{canManage && promotion.status !== "ARCHIVED" && <><button type="button" className="promotion-secondary" onClick={() => edit(promotion)}>ویرایش</button>{promotion.isActive ? <button type="button" className="promotion-secondary" disabled={busy} onClick={() => void run(promotion.id, "deactivate")}>غیرفعال‌سازی</button> : <button type="button" disabled={busy} onClick={() => void run(promotion.id, "activate")}>فعال‌سازی</button>}<button type="button" className="promotion-danger" disabled={busy} onClick={() => void run(promotion.id, "archive")}>بایگانی</button></>}</div></article>)}</div> : <div className="admin-empty"><strong>هنوز تخفیفی نساخته‌اید</strong><p>محصول یا دسته‌بندی موردنظر را انتخاب و قیمت تخفیف‌دار را مشخص کنید.</p></div>}
  </section>;
}
