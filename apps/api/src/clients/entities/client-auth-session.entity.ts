import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { Client } from "./client.entity";

@Entity({ name: "client_auth_sessions" })
@Unique("UQ_client_auth_sessions_refresh_hash", ["refreshTokenHash"])
@Unique("UQ_client_auth_sessions_replacement", ["replacedBySessionId"])
@Check("CK_client_auth_sessions_expiry", "expires_at > created_at")
@Index("IDX_client_auth_sessions_client_active", ["clientId"], { where: "revoked_at IS NULL" })
@Index("IDX_client_auth_sessions_tenant_active", ["coffeeShopId"], { where: "revoked_at IS NULL" })
@Index("IDX_client_auth_sessions_active_family", ["tokenFamilyId"], { where: "revoked_at IS NULL" })
export class ClientAuthSession {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ name: "client_id", type: "uuid" })
  clientId!: string;

  @Column({ name: "token_family_id", type: "uuid" })
  tokenFamilyId!: string;

  @Column({ name: "refresh_token_hash", type: "char", length: 64, select: false })
  refreshTokenHash!: string;

  @Column({ name: "parent_session_id", type: "uuid", nullable: true })
  parentSessionId!: string | null;

  @Column({ name: "replaced_by_session_id", type: "uuid", nullable: true })
  replacedBySessionId!: string | null;

  @Column({ name: "ip_hash", type: "char", length: 64, nullable: true })
  ipHash!: string | null;

  @Column({ name: "user_agent_hash", type: "char", length: 64, nullable: true })
  userAgentHash!: string | null;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @Column({ name: "last_used_at", type: "timestamptz", nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: "rotated_at", type: "timestamptz", nullable: true })
  rotatedAt!: Date | null;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @Column({ name: "compromised_at", type: "timestamptz", nullable: true })
  compromisedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => CoffeeShop, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;

  @ManyToOne(() => Client, { onDelete: "CASCADE" })
  @JoinColumn({ name: "client_id" })
  client!: Client;

  @ManyToOne(() => ClientAuthSession, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "parent_session_id" })
  parentSession!: ClientAuthSession | null;

  @ManyToOne(() => ClientAuthSession, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "replaced_by_session_id" })
  replacedBySession!: ClientAuthSession | null;
}
