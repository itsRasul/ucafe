import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { maskPhone } from "../auth/iran-phone.util";
import { Client, CustomerSegment, CustomerSegmentMembership } from "./entities";
import { CreateCustomerSegmentDto, CustomerSearchDto, UpdateCustomerSegmentDto } from "./dto/customer-segments.dto";

@Injectable()
export class CustomerSegmentsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(coffeeShopId: string) {
    const rows = await this.dataSource.query<Array<{ id: string; name: string; description: string | null; is_active: boolean; deleted_at: Date | null; created_at: Date; updated_at: Date; member_count: string }>>(`
      SELECT s.id, s.name, s.description, s.is_active, s.deleted_at, s.created_at, s.updated_at,
             (SELECT COUNT(*) FROM customer_segment_memberships m WHERE m.coffee_shop_id = s.coffee_shop_id AND m.segment_id = s.id)::text AS member_count
      FROM customer_segments s WHERE s.coffee_shop_id = $1 ORDER BY s.deleted_at NULLS FIRST, s.updated_at DESC
    `, [coffeeShopId]);
    return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, isActive: row.is_active, archived: Boolean(row.deleted_at), memberCount: Number(row.member_count), createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  async customers(coffeeShopId: string, query: CustomerSearchDto) {
    const repository = this.dataSource.getRepository(Client);
    const q = query.q?.trim();
    const builder = repository.createQueryBuilder("client")
      .select(["client.id", "client.firstName", "client.lastName", "client.phone", "client.createdAt"])
      .where("client.coffeeShopId = :coffeeShopId", { coffeeShopId });
    if (q) builder.andWhere("(client.firstName ILIKE :q OR client.lastName ILIKE :q OR (client.firstName || ' ' || client.lastName) ILIKE :q OR client.phone ILIKE :q)", { q: `%${q}%` });
    const [clients, total] = await builder.orderBy("client.createdAt", "DESC").skip((query.page - 1) * query.pageSize).take(query.pageSize).getManyAndCount();
    return { items: clients.map((client) => this.clientSummary(client)), total, page: query.page, pageSize: query.pageSize };
  }

  async members(coffeeShopId: string, segmentId: string, query: CustomerSearchDto) {
    if (!await this.dataSource.getRepository(CustomerSegment).findOneBy({ id: segmentId, coffeeShopId })) throw new NotFoundException("Customer segment not found");
    const q = query.q?.trim();
    const builder = this.dataSource.getRepository(CustomerSegmentMembership).createQueryBuilder("membership")
      .innerJoin(Client, "client", "client.id = membership.clientId AND client.coffeeShopId = membership.coffeeShopId")
      .where("membership.coffeeShopId = :coffeeShopId AND membership.segmentId = :segmentId", { coffeeShopId, segmentId });
    if (q) builder.andWhere("(client.firstName ILIKE :q OR client.lastName ILIKE :q OR (client.firstName || ' ' || client.lastName) ILIKE :q OR client.phone ILIKE :q)", { q: `%${q}%` });
    const [memberships, total] = await builder.orderBy("membership.createdAt", "DESC").skip((query.page - 1) * query.pageSize).take(query.pageSize).getManyAndCount();
    const clients = memberships.length ? await this.dataSource.getRepository(Client).find({ where: { coffeeShopId, id: In(memberships.map((membership) => membership.clientId)) } }) : [];
    const clientById = new Map(clients.map((client) => [client.id, client]));
    return {
      items: memberships.flatMap((membership) => {
        const client = clientById.get(membership.clientId);
        return client ? [{ ...this.clientSummary(client), memberSince: membership.createdAt }] : [];
      }),
      total, page: query.page, pageSize: query.pageSize,
    };
  }

  async create(coffeeShopId: string, input: CreateCustomerSegmentDto) {
    const repository = this.dataSource.getRepository(CustomerSegment);
    try {
      return this.project(await repository.save(repository.create({ coffeeShopId, name: this.name(input.name), description: input.description?.trim() || null, isActive: true })));
    } catch (error) { this.uniqueNameError(error); throw error; }
  }

  async update(coffeeShopId: string, id: string, input: UpdateCustomerSegmentDto) {
    const repository = this.dataSource.getRepository(CustomerSegment);
    const segment = await repository.findOneBy({ id, coffeeShopId });
    if (!segment) throw new NotFoundException("Customer segment not found");
    if (input.name !== undefined) segment.name = this.name(input.name);
    if (input.description !== undefined) segment.description = input.description?.trim() || null;
    if (input.isActive !== undefined) segment.isActive = input.isActive;
    try { return this.project(await repository.save(segment)); }
    catch (error) { this.uniqueNameError(error); throw error; }
  }

  async archive(coffeeShopId: string, id: string) {
    return this.dataSource.transaction(async (manager) => {
      const segment = await manager.getRepository(CustomerSegment).findOneBy({ id, coffeeShopId });
      if (!segment) throw new NotFoundException("Customer segment not found");
      segment.isActive = false;
      await manager.getRepository(CustomerSegment).save(segment);
      await manager.getRepository(CustomerSegment).softDelete({ id, coffeeShopId });
      return { archived: true };
    });
  }

  async addMember(coffeeShopId: string, segmentId: string, clientId: string, actorUserId: string) {
    const segment = await this.dataSource.getRepository(CustomerSegment).findOneBy({ id: segmentId, coffeeShopId, isActive: true });
    if (!segment) throw new NotFoundException("Active customer segment not found");
    if (!await this.dataSource.getRepository(Client).existsBy({ id: clientId, coffeeShopId })) throw new NotFoundException("Client not found");
    await this.dataSource.query(`INSERT INTO customer_segment_memberships (coffee_shop_id, segment_id, client_id, created_by_user_id) VALUES ($1, $2, $3, $4) ON CONFLICT (coffee_shop_id, segment_id, client_id) DO NOTHING`, [coffeeShopId, segmentId, clientId, actorUserId]);
    return { assigned: true };
  }

  async removeMember(coffeeShopId: string, segmentId: string, clientId: string) {
    const result = await this.dataSource.getRepository(CustomerSegmentMembership).delete({ coffeeShopId, segmentId, clientId });
    return { removed: Boolean(result.affected) };
  }

  private name(value: string) {
    const name = value.trim().replace(/\s+/g, " ");
    if (!name) throw new BadRequestException("Customer segment name is required");
    return name;
  }

  private project(segment: CustomerSegment) {
    return { id: segment.id, name: segment.name, description: segment.description, isActive: segment.isActive, archived: Boolean(segment.deletedAt), createdAt: segment.createdAt, updatedAt: segment.updatedAt };
  }

  private clientSummary(client: Client) {
    return { id: client.id, firstName: client.firstName, lastName: client.lastName, phone: maskPhone(client.phone), createdAt: client.createdAt };
  }

  private uniqueNameError(error: unknown) {
    if ((error as { driverError?: { constraint?: string } })?.driverError?.constraint === "UQ_customer_segments_tenant_name") throw new ConflictException({ code: "CUSTOMER_SEGMENT_NAME_IN_USE", message: "گروهی با این نام قبلاً ساخته شده است." });
  }
}
