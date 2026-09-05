import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { MenuItem } from "../../menu/entities";

export enum MediaAssetKind {
  Logo = "LOGO",
  Hero = "HERO",
  Gallery = "GALLERY",
  MenuItem = "MENU_ITEM",
}

@Entity({ name: "media_assets" })
export class MediaAsset {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ type: "enum", enum: MediaAssetKind, enumName: "media_asset_kind" }) kind!: MediaAssetKind;
  @Column({ name: "menu_item_id", type: "uuid", nullable: true }) menuItemId!: string | null;
  @Column({ name: "original_filename", type: "varchar", length: 180 }) originalFilename!: string;
  @Column({ name: "source_media_type", type: "varchar", length: 40 }) sourceMediaType!: string;
  @Column({ name: "source_size_bytes", type: "integer" }) sourceSizeBytes!: number;
  @Column({ name: "source_width", type: "integer" }) sourceWidth!: number;
  @Column({ name: "source_height", type: "integer" }) sourceHeight!: number;
  @Column({ name: "focal_x", type: "numeric", precision: 5, scale: 4, default: 0.5 }) focalX!: string;
  @Column({ name: "focal_y", type: "numeric", precision: 5, scale: 4, default: 0.5 }) focalY!: string;
  @Column({ name: "sort_order", type: "smallint", default: 0 }) sortOrder!: number;
  @Column({ name: "storage_prefix", type: "varchar", length: 220 }) storagePrefix!: string;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true }) deletedAt!: Date | null;

  @ManyToOne(() => CoffeeShop, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coffee_shop_id" }) coffeeShop!: CoffeeShop;
  @ManyToOne(() => MenuItem, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "menu_item_id" }) menuItem!: MenuItem | null;
}
