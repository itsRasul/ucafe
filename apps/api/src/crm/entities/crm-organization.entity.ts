import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "crm_organizations" })
@Index("IDX_crm_organizations_name_city", ["nameNormalized", "cityNormalized"])
@Index("IDX_crm_organizations_website_host", ["websiteHost"])
@Index("IDX_crm_organizations_instagram_handle", ["instagramHandle"])
@Index("UQ_crm_organizations_coffee_shop_id", ["coffeeShopId"], { unique: true, where: '"coffee_shop_id" IS NOT NULL' })
export class CrmOrganization {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "varchar", length: 160 }) name!: string;
  @Column({ name: "name_normalized", type: "varchar", length: 160 }) nameNormalized!: string;
  @Column({ type: "varchar", length: 100, nullable: true }) city!: string | null;
  @Column({ name: "city_normalized", type: "varchar", length: 100, nullable: true }) cityNormalized!: string | null;
  @Column({ type: "varchar", length: 500, nullable: true }) website!: string | null;
  @Column({ name: "website_host", type: "varchar", length: 255, nullable: true }) websiteHost!: string | null;
  @Column({ name: "instagram_handle", type: "varchar", length: 30, nullable: true }) instagramHandle!: string | null;
  @Column({ name: "coffee_shop_id", type: "uuid", nullable: true }) coffeeShopId!: string | null;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "updated_by_user_id", type: "uuid", nullable: true }) updatedByUserId!: string | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
