import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";

export enum RadiusPreset {
  Soft = "SOFT",
  Rounded = "ROUNDED",
  Editorial = "EDITORIAL",
}

@Entity({ name: "website_settings" })
export class WebsiteSettings {
  @PrimaryColumn({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ name: "template_key", type: "varchar", length: 40, default: "warm-editorial" })
  templateKey!: string;

  @Column({ name: "hero_title", type: "varchar", length: 140, nullable: true })
  heroTitle!: string | null;

  @Column({ name: "hero_subtitle", type: "varchar", length: 320, nullable: true })
  heroSubtitle!: string | null;

  @Column({ name: "about_title", type: "varchar", length: 140, nullable: true })
  aboutTitle!: string | null;

  @Column({ name: "about_body", type: "text", nullable: true })
  aboutBody!: string | null;

  @Column({ name: "announcement_text", type: "varchar", length: 180, nullable: true })
  announcementText!: string | null;

  @Column({ name: "instagram_url", type: "varchar", length: 300, nullable: true })
  instagramUrl!: string | null;

  @Column({ name: "primary_color", type: "char", length: 7, default: "#6F4E37" })
  primaryColor!: string;

  @Column({ name: "secondary_color", type: "char", length: 7, default: "#F4EEE4" })
  secondaryColor!: string;

  @Column({ name: "accent_color", type: "char", length: 7, default: "#A85F35" })
  accentColor!: string;

  @Column({ name: "heading_font", type: "varchar", length: 40, default: "Estedad" })
  headingFont!: string;

  @Column({ name: "body_font", type: "varchar", length: 40, default: "Vazirmatn" })
  bodyFont!: string;

  @Column({ name: "radius_preset", type: "enum", enum: RadiusPreset, enumName: "website_radius_preset", default: RadiusPreset.Soft })
  radiusPreset!: RadiusPreset;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToOne(() => CoffeeShop, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;
}
