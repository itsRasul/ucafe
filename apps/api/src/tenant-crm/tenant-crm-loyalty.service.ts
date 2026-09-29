import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { maskPhone } from "../auth/iran-phone.util";
import { displayOrderNumber } from "../notifications/notification-type";
import { DomainEventTypes } from "../database/domain-event.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { AdjustTenantCrmLoyaltyDto, CreateTenantCrmRewardDto, RedeemTenantCrmRewardDto, TenantCrmLoyaltyListQueryDto,
  UpdateTenantCrmLoyaltyProgramDto, UpdateTenantCrmRewardDto } from "./dto/tenant-crm-loyalty.dto";
import { pointsForSpend } from "./loyalty-points.util";

type Program = { id: string; enabled: boolean; spendPerPointToman: string; createdAt: Date };
type LedgerRow = { id: string; entryType: string; points: string; reason: string | null; orderId: string | null; rewardName: string | null;
  createdAt: Date; actorPhone: string | null };
type OutboxRow = { id: string; eventType: string; coffeeShopId: string; aggregateId: string; createdAt: Date; attempts: number };

@Injectable()
export class TenantCrmLoyaltyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantCrmLoyaltyService.name);
  private dispatchTimer?: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(private readonly dataSource: DataSource, private readonly subscriptions: SubscriptionsService) {}

  onModuleInit() {
    this.dispatchTimer = setInterval(() => { void this.dispatchPendingEvents().catch(() => this.logger.error("Loyalty event dispatch failed")); }, 5000);
    this.dispatchTimer.unref?.();
  }

  onModuleDestroy() { if (this.dispatchTimer) clearInterval(this.dispatchTimer); }

  async program(coffeeShopId: string) {
    const program = await this.latestProgram(this.dataSource, coffeeShopId);
    return program ? this.programProject(program) : { configured: false, enabled: false, spendPerPointToman: null, updatedAt: null };
  }

  async updateProgram(coffeeShopId: string, userId: string, input: UpdateTenantCrmLoyaltyProgramDto) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`tenant-crm-loyalty-program:${coffeeShopId}`]);
      const current = await this.latestProgram(manager, coffeeShopId);
      if (current && current.enabled === input.enabled && BigInt(current.spendPerPointToman) === BigInt(input.spendPerPointToman)) return this.programProject(current);
      const rows = await manager.query(`
        INSERT INTO tenant_crm_loyalty_programs(coffee_shop_id,enabled,spend_per_point_toman,created_by_user_id)
        VALUES($1,$2,$3,$4)
        RETURNING id,enabled,spend_per_point_toman::text AS "spendPerPointToman",created_at AS "createdAt"`,
      [coffeeShopId, input.enabled, input.spendPerPointToman, userId]) as Program[];
      return this.programProject(rows[0]!);
    });
  }

  async rewards(coffeeShopId: string, query: TenantCrmLoyaltyListQueryDto) {
    const [countRows, items] = await Promise.all([
      this.dataSource.query(`SELECT COUNT(*)::int AS total FROM tenant_crm_loyalty_rewards WHERE coffee_shop_id=$1`, [coffeeShopId]) as Promise<Array<{ total: number }>>,
      this.dataSource.query(`
        SELECT id,name,description,points_cost::text AS "pointsCost",is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"
        FROM tenant_crm_loyalty_rewards WHERE coffee_shop_id=$1 ORDER BY is_active DESC,name,id LIMIT $2 OFFSET $3`,
      [coffeeShopId, query.pageSize, (query.page - 1) * query.pageSize]) as Promise<Array<Record<string, unknown>>>,
    ]);
    return { items, total: Number(countRows[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async createReward(coffeeShopId: string, userId: string, input: CreateTenantCrmRewardDto) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Reward name is required");
    const rows = await this.dataSource.query(`
      INSERT INTO tenant_crm_loyalty_rewards(coffee_shop_id,name,description,points_cost,created_by_user_id,updated_by_user_id)
      VALUES($1,$2,$3,$4,$5,$5)
      RETURNING id,name,description,points_cost::text AS "pointsCost",is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"`,
    [coffeeShopId, name, input.description?.trim() || null, input.pointsCost, userId]);
    return rows[0];
  }

  async updateReward(coffeeShopId: string, userId: string, rewardId: string, input: UpdateTenantCrmRewardDto) {
    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new BadRequestException("Reward name is required");
    const [rows] = await this.dataSource.query(`
      UPDATE tenant_crm_loyalty_rewards SET
        name=COALESCE($3,name), description=CASE WHEN $4::boolean THEN $5 ELSE description END,
        points_cost=COALESCE($6,points_cost), is_active=COALESCE($7,is_active),
        updated_by_user_id=$2,updated_at=now()
      WHERE coffee_shop_id=$1 AND id=$8
      RETURNING id,name,description,points_cost::text AS "pointsCost",is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"`,
    [coffeeShopId, userId, name ?? null, input.description !== undefined, input.description?.trim() || null, input.pointsCost ?? null, input.isActive ?? null, rewardId]) as [Array<Record<string, unknown>>, number];
    if (!rows[0]) throw new NotFoundException("Reward not found");
    return rows[0];
  }

  async clientLoyalty(coffeeShopId: string, clientId: string) {
    const clientRows = await this.dataSource.query(`SELECT status FROM clients WHERE coffee_shop_id=$1 AND id=$2`, [coffeeShopId, clientId]) as Array<{ status: string }>;
    if (!clientRows[0]) throw new NotFoundException("Client not found");
    const client = clientRows[0]!;
    const [program, accountRows, rewardRows, ledgerRows, redemptionRows, ledgerCountRows] = await Promise.all([
      this.latestProgram(this.dataSource, coffeeShopId),
      this.dataSource.query(`SELECT id,created_at AS "createdAt" FROM tenant_crm_loyalty_accounts WHERE coffee_shop_id=$1 AND client_id=$2`, [coffeeShopId, clientId]) as Promise<Array<{ id: string; createdAt: Date }>>,
      this.dataSource.query(`SELECT id,name,description,points_cost::text AS "pointsCost" FROM tenant_crm_loyalty_rewards WHERE coffee_shop_id=$1 AND is_active=true ORDER BY name,id`, [coffeeShopId]) as Promise<Array<{ id: string; name: string; description: string | null; pointsCost: string }>>,
      this.readLedger(coffeeShopId, clientId, 5),
      this.dataSource.query(`
        SELECT id,reward_name_snapshot AS "rewardName",points_spent::text AS "pointsSpent",redeemed_at AS "redeemedAt"
        FROM tenant_crm_loyalty_redemptions WHERE coffee_shop_id=$1 AND client_id=$2 ORDER BY redeemed_at DESC,id DESC LIMIT 5`,
      [coffeeShopId, clientId]) as Promise<Array<Record<string, unknown>>>,
      this.dataSource.query(`SELECT COUNT(*)::int AS total FROM tenant_crm_loyalty_ledger WHERE coffee_shop_id=$1 AND client_id=$2`, [coffeeShopId, clientId]) as Promise<Array<{ total: number }>>,
    ]);
    const balance = accountRows[0] ? await this.balance(this.dataSource, coffeeShopId, clientId) : "0";
    const balanceValue = BigInt(balance);
    return {
      clientStatus: client.status,
      account: accountRows[0] ?? null,
      balance,
      program: program ? this.programProject(program) : { configured: false, enabled: false, spendPerPointToman: null, updatedAt: null },
      rewards: rewardRows.map((reward) => ({ ...reward, eligible: client.status === "ACTIVE" && program?.enabled === true && balanceValue >= BigInt(reward.pointsCost) })),
      recentLedger: ledgerRows.map((row) => this.ledgerProject(row)),
      ledgerTotal: Number(ledgerCountRows[0]?.total ?? 0),
      recentRedemptions: redemptionRows,
    };
  }

  async ledger(coffeeShopId: string, clientId: string, query: TenantCrmLoyaltyListQueryDto) {
    await this.assertClient(this.dataSource.manager, coffeeShopId, clientId);
    const [countRows, rows, balance] = await Promise.all([
      this.dataSource.query(`SELECT COUNT(*)::int AS total FROM tenant_crm_loyalty_ledger WHERE coffee_shop_id=$1 AND client_id=$2`, [coffeeShopId, clientId]) as Promise<Array<{ total: number }>>,
      this.readLedger(coffeeShopId, clientId, query.pageSize, (query.page - 1) * query.pageSize),
      this.balance(this.dataSource, coffeeShopId, clientId),
    ]);
    return { items: rows.map((row) => this.ledgerProject(row)), balance, total: Number(countRows[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async adjust(coffeeShopId: string, clientId: string, userId: string, input: AdjustTenantCrmLoyaltyDto) {
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException("An adjustment reason is required");
    return this.dataSource.transaction(async (manager) => {
      const client = await this.assertClient(manager, coffeeShopId, clientId);
      const accountId = await this.lockAccount(manager, coffeeShopId, clientId);
      const existing = await this.ledgerByIdempotency(manager, coffeeShopId, input.idempotencyKey);
      if (existing) {
        if (existing.clientId !== clientId || existing.entryType !== (input.direction === "CREDIT" ? "MANUAL_CREDIT" : "MANUAL_DEBIT") ||
          BigInt(existing.points) !== BigInt(input.points) * (input.direction === "CREDIT" ? 1n : -1n) || existing.reason !== reason || existing.createdByUserId !== userId) {
          throw new ConflictException({ code: "LOYALTY_IDEMPOTENCY_CONFLICT", message: "Idempotency key was already used" });
        }
        return { item: this.ledgerProject(existing), balance: await this.balance(manager, coffeeShopId, clientId) };
      }
      this.assertActiveClient(client);
      const balance = BigInt(await this.balance(manager, coffeeShopId, clientId));
      const delta = BigInt(input.points) * (input.direction === "CREDIT" ? 1n : -1n);
      if (balance + delta < 0n) throw new ConflictException({ code: "LOYALTY_INSUFFICIENT_POINTS", message: "Insufficient points" });
      const rows = await manager.query(`
        INSERT INTO tenant_crm_loyalty_ledger(coffee_shop_id,client_id,account_id,entry_type,points,reason,idempotency_key,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT DO NOTHING
        RETURNING id`, [coffeeShopId, clientId, accountId, input.direction === "CREDIT" ? "MANUAL_CREDIT" : "MANUAL_DEBIT", delta.toString(), reason, input.idempotencyKey, userId]) as Array<{ id: string }>;
      if (!rows[0]) {
        const duplicate = await this.ledgerByIdempotency(manager, coffeeShopId, input.idempotencyKey);
        if (!duplicate || duplicate.clientId !== clientId || duplicate.reason !== reason || BigInt(duplicate.points) !== delta) throw new ConflictException({ code: "LOYALTY_IDEMPOTENCY_CONFLICT", message: "Idempotency key was already used" });
        return { item: this.ledgerProject(duplicate), balance: await this.balance(manager, coffeeShopId, clientId) };
      }
      return { item: this.ledgerProject((await this.ledgerById(manager, coffeeShopId, rows[0].id))!), balance: (balance + delta).toString() };
    });
  }

  async redeem(coffeeShopId: string, clientId: string, userId: string, input: RedeemTenantCrmRewardDto) {
    return this.dataSource.transaction(async (manager) => {
      const client = await this.assertClient(manager, coffeeShopId, clientId);
      const accountId = await this.lockAccount(manager, coffeeShopId, clientId);
      const duplicateRows = await manager.query(`
        SELECT id,client_id AS "clientId",reward_id AS "rewardId",account_id AS "accountId",reward_name_snapshot AS "rewardName",
          points_spent::text AS "pointsSpent",redeemed_at AS "redeemedAt"
        FROM tenant_crm_loyalty_redemptions WHERE coffee_shop_id=$1 AND idempotency_key=$2`, [coffeeShopId, input.idempotencyKey]) as Array<Record<string, any>>;
      if (duplicateRows[0]) {
        const old = duplicateRows[0];
        if (old.clientId !== clientId || old.rewardId !== input.rewardId) throw new ConflictException({ code: "LOYALTY_IDEMPOTENCY_CONFLICT", message: "Idempotency key was already used" });
        return { redemption: this.redemptionProject(old), balance: await this.balance(manager, coffeeShopId, clientId) };
      }
      this.assertActiveClient(client);
      const program = await this.latestProgram(manager, coffeeShopId);
      if (!program?.enabled) throw new ConflictException({ code: "LOYALTY_PROGRAM_DISABLED", message: "Loyalty is disabled" });
      const rewardRows = await manager.query(`
        SELECT id,name,points_cost::text AS "pointsCost" FROM tenant_crm_loyalty_rewards
        WHERE coffee_shop_id=$1 AND id=$2 AND is_active=true FOR UPDATE`, [coffeeShopId, input.rewardId]) as Array<{ id: string; name: string; pointsCost: string }>;
      const reward = rewardRows[0];
      if (!reward) throw new NotFoundException("Reward not found");
      const balance = BigInt(await this.balance(manager, coffeeShopId, clientId));
      const cost = BigInt(reward.pointsCost);
      if (balance < cost) throw new ConflictException({ code: "LOYALTY_INSUFFICIENT_POINTS", message: "Insufficient points" });
      const redemptionRows = await manager.query(`
        INSERT INTO tenant_crm_loyalty_redemptions(coffee_shop_id,client_id,account_id,reward_id,reward_name_snapshot,points_spent,idempotency_key,redeemed_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT DO NOTHING
        RETURNING id,client_id AS "clientId",reward_id AS "rewardId",account_id AS "accountId",reward_name_snapshot AS "rewardName",
          points_spent::text AS "pointsSpent",redeemed_at AS "redeemedAt"`,
      [coffeeShopId, clientId, accountId, reward.id, reward.name, reward.pointsCost, input.idempotencyKey, userId]) as Array<Record<string, any>>;
      const redemption = redemptionRows[0];
      if (!redemption) {
        const duplicate = await manager.query(`SELECT id,client_id AS "clientId",reward_id AS "rewardId",account_id AS "accountId",reward_name_snapshot AS "rewardName",points_spent::text AS "pointsSpent",redeemed_at AS "redeemedAt" FROM tenant_crm_loyalty_redemptions WHERE coffee_shop_id=$1 AND idempotency_key=$2`, [coffeeShopId, input.idempotencyKey]) as Array<Record<string, any>>;
        if (duplicate[0]?.clientId === clientId && duplicate[0]?.rewardId === input.rewardId) return { redemption: this.redemptionProject(duplicate[0]), balance: await this.balance(manager, coffeeShopId, clientId) };
        throw new ConflictException({ code: "LOYALTY_IDEMPOTENCY_CONFLICT", message: "Idempotency key was already used" });
      }
      await manager.query(`
        INSERT INTO tenant_crm_loyalty_ledger(coffee_shop_id,client_id,account_id,entry_type,points,redemption_id,idempotency_key,created_by_user_id)
        VALUES($1,$2,$3,'REDEMPTION',$4,$5,$6,$7)`, [coffeeShopId, clientId, accountId, (-cost).toString(), redemption.id, `REDEMPTION:${redemption.id}`, userId]);
      return { redemption: this.redemptionProject(redemption), balance: (balance - cost).toString() };
    });
  }

  async dispatchPendingEvents(limit = 20) {
    if (this.draining) return 0;
    this.draining = true;
    let processed = 0;
    try {
      await this.dataSource.query(`
        UPDATE domain_event_outbox SET status='FAILED',claimed_at=NULL,error_code='LOYALTY_PROCESSING_FAILED'
        WHERE status='PROCESSING' AND attempts>=5 AND claimed_at<clock_timestamp()-interval '5 minutes'`);
      while (processed < limit) {
        const [events] = await this.dataSource.query(`
          UPDATE domain_event_outbox SET status='PROCESSING',attempts=attempts+1,claimed_at=clock_timestamp(),error_code=NULL
          WHERE id=(SELECT id FROM domain_event_outbox
            WHERE event_type=$1 AND attempts<5 AND ((status='PENDING' AND next_attempt_at<=clock_timestamp())
              OR (status='PROCESSING' AND claimed_at<clock_timestamp()-interval '5 minutes'))
            ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
          RETURNING id,event_type AS "eventType",coffee_shop_id AS "coffeeShopId",aggregate_id AS "aggregateId",created_at AS "createdAt",attempts`,
        [DomainEventTypes.OrderDelivered]) as [OutboxRow[], number];
        const event = events[0];
        if (!event) break;
        await this.processOutboxEvent(event);
        processed++;
      }
      return processed;
    } finally { this.draining = false; }
  }

  private async processOutboxEvent(event: OutboxRow) {
    try {
      await this.dataSource.transaction(async (manager) => {
        const [locked] = await manager.query(`SELECT id FROM domain_event_outbox WHERE id=$1 AND status='PROCESSING' FOR UPDATE`, [event.id]);
        if (!locked) return;
        if (event.eventType !== DomainEventTypes.OrderDelivered) throw new Error("Unsupported domain event");
        if ((await this.subscriptions.featureState(event.coffeeShopId, SubscriptionFeatures.TenantCrm)).enabled) {
          const [order] = await manager.query(`
            SELECT o.client_id AS "clientId",o.total_amount_toman::text AS "amountToman",o.status,c.status AS "clientStatus"
            FROM orders o JOIN clients c ON c.coffee_shop_id=o.coffee_shop_id AND c.id=o.client_id
            WHERE o.coffee_shop_id=$1 AND o.id=$2`, [event.coffeeShopId, event.aggregateId]);
          if (order?.status === "DELIVERED" && order.clientStatus === "ACTIVE") {
            const [program] = await manager.query(`
              SELECT enabled,spend_per_point_toman::text AS "spendPerPointToman"
              FROM tenant_crm_loyalty_programs WHERE coffee_shop_id=$1 AND created_at<=$2
              ORDER BY created_at DESC,id DESC LIMIT 1`, [event.coffeeShopId, event.createdAt]);
            if (program?.enabled) {
              const points = pointsForSpend(order.amountToman, program.spendPerPointToman);
              if (points > 0n) {
                const accountId = await this.lockAccount(manager, event.coffeeShopId, order.clientId);
                await manager.query(`
                  INSERT INTO tenant_crm_loyalty_ledger(coffee_shop_id,client_id,account_id,entry_type,points,order_id,qualifying_amount_toman,spend_per_point_toman,idempotency_key)
                  VALUES($1,$2,$3,'EARN',$4,$5,$6,$7,$8)
                  ON CONFLICT DO NOTHING`, [event.coffeeShopId, order.clientId, accountId, points.toString(), event.aggregateId,
                  order.amountToman, program.spendPerPointToman, `ORDER:${event.aggregateId}`]);
              }
            }
          }
        }
        await manager.query(`UPDATE domain_event_outbox SET status='PROCESSED',processed_at=clock_timestamp(),claimed_at=NULL,error_code=NULL WHERE id=$1`, [event.id]);
      });
    } catch {
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, event.attempts - 1)));
      await this.dataSource.query(`
        UPDATE domain_event_outbox SET
          status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
          next_attempt_at=clock_timestamp()+($2::int * interval '1 second'),claimed_at=NULL,
          error_code=CASE WHEN attempts>=5 THEN 'LOYALTY_PROCESSING_FAILED' ELSE NULL END
        WHERE id=$1 AND status='PROCESSING'`, [event.id, delaySeconds]);
      this.logger.warn(`Loyalty event ${event.id} failed on attempt ${event.attempts}`);
    }
  }

  private async latestProgram(manager: DataSource | EntityManager, coffeeShopId: string): Promise<Program | null> {
    const [program] = await manager.query(`
      SELECT id,enabled,spend_per_point_toman::text AS "spendPerPointToman",created_at AS "createdAt"
      FROM tenant_crm_loyalty_programs WHERE coffee_shop_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [coffeeShopId]) as Program[];
    return program ?? null;
  }

  private programProject(program: Program) {
    return { configured: true, id: program.id, enabled: program.enabled, spendPerPointToman: program.spendPerPointToman, updatedAt: program.createdAt };
  }

  private async assertClient(manager: DataSource | EntityManager, coffeeShopId: string, clientId: string) {
    const [client] = await manager.query(`SELECT status FROM clients WHERE coffee_shop_id=$1 AND id=$2`, [coffeeShopId, clientId]) as Array<{ status: string }>;
    if (!client) throw new NotFoundException("Client not found");
    return client;
  }

  private assertActiveClient(client: { status: string }) {
    if (client.status !== "ACTIVE") throw new ConflictException({ code: "LOYALTY_CLIENT_BLOCKED", message: "Blocked clients cannot earn, adjust, or redeem points" });
  }

  private async lockAccount(manager: EntityManager, coffeeShopId: string, clientId: string) {
    await manager.query(`INSERT INTO tenant_crm_loyalty_accounts(coffee_shop_id,client_id) VALUES($1,$2) ON CONFLICT(coffee_shop_id,client_id) DO NOTHING`, [coffeeShopId, clientId]);
    const [account] = await manager.query(`SELECT id FROM tenant_crm_loyalty_accounts WHERE coffee_shop_id=$1 AND client_id=$2 FOR UPDATE`, [coffeeShopId, clientId]) as Array<{ id: string }>;
    if (!account) throw new NotFoundException("Client loyalty account not found");
    return account.id;
  }

  private async balance(manager: DataSource | EntityManager, coffeeShopId: string, clientId: string) {
    const [row] = await manager.query(`SELECT COALESCE(SUM(points),0)::text AS balance FROM tenant_crm_loyalty_ledger WHERE coffee_shop_id=$1 AND client_id=$2`, [coffeeShopId, clientId]) as Array<{ balance: string }>;
    return row?.balance ?? "0";
  }

  private async readLedger(coffeeShopId: string, clientId: string, limit: number, offset = 0) {
    return await this.dataSource.query(`
      SELECT l.id,l.entry_type AS "entryType",l.points::text,l.reason,l.order_id AS "orderId",
        r.reward_name_snapshot AS "rewardName",l.created_at AS "createdAt",u.phone AS "actorPhone"
      FROM tenant_crm_loyalty_ledger l
      LEFT JOIN tenant_crm_loyalty_redemptions r ON r.coffee_shop_id=l.coffee_shop_id AND r.id=l.redemption_id
      LEFT JOIN users u ON u.id=l.created_by_user_id
      WHERE l.coffee_shop_id=$1 AND l.client_id=$2 ORDER BY l.created_at DESC,l.id DESC LIMIT $3 OFFSET $4`,
    [coffeeShopId, clientId, limit, offset]) as LedgerRow[];
  }

  private async ledgerByIdempotency(manager: EntityManager, coffeeShopId: string, idempotencyKey: string) {
    const [row] = await manager.query(`
      SELECT l.id,l.client_id AS "clientId",l.entry_type AS "entryType",l.points::text,l.reason,l.order_id AS "orderId",
        r.reward_name_snapshot AS "rewardName",l.created_at AS "createdAt",u.phone AS "actorPhone",l.created_by_user_id AS "createdByUserId"
      FROM tenant_crm_loyalty_ledger l LEFT JOIN tenant_crm_loyalty_redemptions r ON r.coffee_shop_id=l.coffee_shop_id AND r.id=l.redemption_id
      LEFT JOIN users u ON u.id=l.created_by_user_id WHERE l.coffee_shop_id=$1 AND l.idempotency_key=$2`, [coffeeShopId, idempotencyKey]) as (LedgerRow & { clientId: string; createdByUserId: string | null })[];
    return row ?? null;
  }

  private async ledgerById(manager: EntityManager, coffeeShopId: string, id: string) {
    const [row] = await manager.query(`
      SELECT l.id,l.entry_type AS "entryType",l.points::text,l.reason,l.order_id AS "orderId",
        r.reward_name_snapshot AS "rewardName",l.created_at AS "createdAt",u.phone AS "actorPhone"
      FROM tenant_crm_loyalty_ledger l LEFT JOIN tenant_crm_loyalty_redemptions r ON r.coffee_shop_id=l.coffee_shop_id AND r.id=l.redemption_id
      LEFT JOIN users u ON u.id=l.created_by_user_id WHERE l.coffee_shop_id=$1 AND l.id=$2`, [coffeeShopId, id]) as LedgerRow[];
    return row ?? null;
  }

  private ledgerProject(row: LedgerRow) {
    return {
      id: row.id, entryType: row.entryType, points: row.points,
        description: row.entryType === "EARN" && row.orderId ? `سفارش #${displayOrderNumber(row.orderId)}` : row.rewardName ?? row.reason,
      createdAt: row.createdAt, actorLabel: row.actorPhone ? maskPhone(row.actorPhone) : null,
    };
  }

  private redemptionProject(row: Record<string, any>) {
    return { id: row.id, rewardName: row.rewardName, pointsSpent: row.pointsSpent, redeemedAt: row.redeemedAt };
  }
}
