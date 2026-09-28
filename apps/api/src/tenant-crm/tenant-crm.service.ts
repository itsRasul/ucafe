import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { normalizeIranianMobile, maskPhone } from "../auth/iran-phone.util";
import { ClientDirectoryQueryDto } from "./dto/client-directory-query.dto";

@Injectable()
export class TenantCrmService {
  constructor(private readonly dataSource: DataSource) {}

  async list(coffeeShopId: string, query: ClientDirectoryQueryDto) {
    const { where, parameters } = this.where(coffeeShopId, query);
    const countRows = await this.dataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*)::int AS total FROM clients WHERE ${where}`,
      parameters,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const sortColumn = query.sortBy === "name" ? "lower(first_name || ' ' || last_name)" : "created_at";
    const limitIndex = parameters.length + 1;
    const offsetIndex = parameters.length + 2;
    const rows = await this.dataSource.query<Array<{ id: string; firstName: string; lastName: string; phone: string; status: string; createdAt: Date }>>(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", phone, status, created_at AS "createdAt"
       FROM clients WHERE ${where} ORDER BY ${sortColumn} ${query.sortOrder.toUpperCase()}, id ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...parameters, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      items: rows.map((row) => ({ ...row, phone: maskPhone(row.phone) })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(coffeeShopId: string, clientId: string) {
    const [client] = await this.dataSource.query<Array<{ id: string; firstName: string; lastName: string; phone: string; status: string; phoneVerifiedAt: Date | null; createdAt: Date; updatedAt: Date }>>(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", phone, status,
              phone_verified_at AS "phoneVerifiedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM clients WHERE id=$1 AND coffee_shop_id=$2`,
      [clientId, coffeeShopId],
    );
    if (!client) throw new NotFoundException("Client not found");
    return client;
  }

  private where(coffeeShopId: string, query: ClientDirectoryQueryDto) {
    const clauses = ["coffee_shop_id=$1"];
    const parameters: unknown[] = [coffeeShopId];
    if (query.status) {
      parameters.push(query.status);
      clauses.push(`status=$${parameters.length}`);
    }
    const q = query.q?.trim();
    if (q) {
      let phone: string | undefined;
      try { phone = normalizeIranianMobile(q); } catch { /* A non-phone query remains a name search. */ }
      if (phone) {
        parameters.push(phone);
        clauses.push(`phone=$${parameters.length}`);
      } else {
        parameters.push(`%${q}%`);
        clauses.push(`(first_name ILIKE $${parameters.length} OR last_name ILIKE $${parameters.length} OR (first_name || ' ' || last_name) ILIKE $${parameters.length})`);
      }
    }
    return { where: clauses.join(" AND "), parameters };
  }
}
