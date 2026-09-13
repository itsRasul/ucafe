import { Picture, Price, type PublicMenuItem } from "./tenant-public";

export type FeaturedItem = PublicMenuItem & { categoryName: string };

export function TenantFeatured({ items }: { items: FeaturedItem[] }) {
  return <div className="public-menu-grid featured-menu-grid">
    {items.map((item) => {
      const detailHref = `/menu?item=${encodeURIComponent(item.id)}`;
      return <article className={`public-menu-card${item.isAvailable ? "" : " is-unavailable"}`} key={item.id}>
        <a className="public-menu-card-main" href={detailHref} aria-label={`مشاهده جزئیات ${item.name}`}>
          <Picture asset={item.image} fallback="menu" alt={item.image ? item.name : `تصویر جایگزین برای ${item.name}`} className="public-menu-card-image" />
          <span className="public-menu-card-copy">
            <span className="public-menu-card-heading"><strong>{item.name}</strong>{item.isFeatured && <small>پیشنهاد ما</small>}</span>
            {item.description && <span className="public-menu-card-description">{item.description}</span>}
            {!item.isAvailable && <span className="public-menu-unavailable">ناموجود</span>}
            <span className="public-menu-card-price"><Price item={item} /></span>
          </span>
        </a>
      </article>;
    })}
  </div>;
}
