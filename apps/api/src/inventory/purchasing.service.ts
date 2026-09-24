import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { InventoryDimension, PurchaseOrderStatus } from "./entities";
import { InventoryService } from "./inventory.service";
import { addQuantities, quantityFromBase, quantityToBase } from "./quantity.util";
import { CreateGoodsReceiptDto, CreatePurchaseOrderDto, CreateSupplierDto, GoodsReceiptLineDto, PurchaseOrderLineDto, PurchasingListQueryDto, UpdateGoodsReceiptDto, UpdatePurchaseOrderDto, UpdateSupplierDto } from "./purchasing.dto";

const uniqueConflict = (error: unknown): never => {
  if ((error as { code?: string }).code === "23505") throw new ConflictException("A supplier or document with these details already exists");
  if ((error as { code?: string }).code === "23503") throw new ConflictException("A referenced inventory record is no longer available");
  if ((error as { constraint?: string }).constraint === "CK_inventory_purchase_order_dates") throw new BadRequestException("Expected delivery date must be on or after the order date");
  if ((error as { code?: string }).code === "22003") throw new BadRequestException("Quantity or amount exceeds the supported inventory range");
  throw error;
};
const clean = (value?: string | null) => value?.trim() || null;
const positive = (value: string) => value !== "0" && !value.startsWith("-");
const exceeds = (quantity: string, remaining: string) => positive(addQuantities(quantity, `-${remaining}`));
const firstRow = <T>(rows: T[]) => { const row = rows[0]; return (Array.isArray(row) ? row[0] : row) as T | undefined; };

@Injectable()
export class PurchasingService {
  private readonly logger = new Logger(PurchasingService.name);
  constructor(private readonly db: DataSource, private readonly subscriptions: SubscriptionsService, private readonly inventory: InventoryService) {}
  private async gate(tenantId: string) { await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.Inventory); }
  private paging(query: PurchasingListQueryDto) { return { page: query.page ?? 1, limit: query.limit ?? 50 }; }
  private async nextNumber(m: EntityManager, tenantId: string, type: "PO" | "GR") {
    const [row] = await m.query(`INSERT INTO inventory_document_sequences(coffee_shop_id,document_type,value) VALUES($1,$2,1)
      ON CONFLICT(coffee_shop_id,document_type) DO UPDATE SET value=inventory_document_sequences.value+1 RETURNING value`, [tenantId, type]);
    return `${type}-${String(row.value).padStart(6, "0")}`;
  }

  async suppliers(tenantId: string, query: PurchasingListQueryDto) {
    await this.gate(tenantId);
    const { page, limit } = this.paging(query), values: unknown[] = [tenantId], where = ["coffee_shop_id=$1"];
    if (query.search?.trim()) { values.push(query.search.trim()); where.push(`(name ILIKE '%'||$${values.length}||'%' OR COALESCE(contact_person,'') ILIKE '%'||$${values.length}||'%')`); }
    if (query.status === "ACTIVE" || query.status === "INACTIVE") where.push(`is_active=${query.status === "ACTIVE"}`);
    const total = await this.db.query(`SELECT count(*)::int AS count FROM inventory_suppliers WHERE ${where.join(" AND ")}`, values);
    const rows = await this.db.query(`SELECT id,name,contact_person AS "contactPerson",phone,email,address,notes,is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM inventory_suppliers WHERE ${where.join(" AND ")} ORDER BY is_active DESC,name LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, (page - 1) * limit]);
    return { items: rows, page, limit, total: total[0].count };
  }

  async createSupplier(tenantId: string, input: CreateSupplierDto) {
    await this.gate(tenantId);
    try {
      const [row] = await this.db.query(`INSERT INTO inventory_suppliers(coffee_shop_id,name,contact_person,phone,email,address,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,contact_person AS "contactPerson",phone,email,address,notes,is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"`,
      [tenantId, input.name.trim(), clean(input.contactPerson), clean(input.phone), clean(input.email), clean(input.address), clean(input.notes)]);
      return row;
    } catch (error) { return uniqueConflict(error); }
  }

  async updateSupplier(tenantId: string, id: string, input: UpdateSupplierDto) {
    await this.gate(tenantId);
    try {
      const rows = await this.db.query(`UPDATE inventory_suppliers SET
        name=CASE WHEN $3 THEN $4 ELSE name END, contact_person=CASE WHEN $5 THEN $6 ELSE contact_person END,
        phone=CASE WHEN $7 THEN $8 ELSE phone END,email=CASE WHEN $9 THEN $10 ELSE email END,
        address=CASE WHEN $11 THEN $12 ELSE address END,notes=CASE WHEN $13 THEN $14 ELSE notes END,
        is_active=COALESCE($15,is_active),updated_at=clock_timestamp()
        WHERE coffee_shop_id=$1 AND id=$2 RETURNING id,name,contact_person AS "contactPerson",phone,email,address,notes,is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"`,
      [tenantId, id, input.name !== undefined, input.name?.trim(), input.contactPerson !== undefined, clean(input.contactPerson), input.phone !== undefined, clean(input.phone), input.email !== undefined, clean(input.email), input.address !== undefined, clean(input.address), input.notes !== undefined, clean(input.notes), input.isActive ?? null]);
      const row = firstRow(rows);
      if (!row) throw new NotFoundException("Supplier not found");
      return row;
    } catch (error) { return uniqueConflict(error); }
  }

  async supplierPrices(tenantId: string, supplierId: string, query: PurchasingListQueryDto) {
    await this.gate(tenantId);
    const { page, limit } = this.paging(query);
    const [supplier] = await this.db.query(`SELECT id FROM inventory_suppliers WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, supplierId]);
    if (!supplier) throw new NotFoundException("Supplier not found");
    const [{ count }] = await this.db.query(`SELECT count(DISTINCT l.inventory_item_id)::int AS count FROM inventory_goods_receipt_lines l
      JOIN inventory_goods_receipts g ON g.coffee_shop_id=l.coffee_shop_id AND g.id=l.goods_receipt_id
      WHERE g.coffee_shop_id=$1 AND g.supplier_id=$2 AND g.status='POSTED'`, [tenantId, supplierId]);
    const items = await this.db.query(`SELECT DISTINCT ON(l.inventory_item_id) l.inventory_item_id AS "inventoryItemId",l.item_name_snapshot AS "itemName",
      i.base_unit AS "baseUnit",l.quantity_display::text AS quantity,l.unit,l.unit_price_toman AS "unitPriceToman",l.total_cost_toman AS "totalCostToman",
      g.number AS "receiptNumber",g.received_at AS "receivedAt"
      FROM inventory_goods_receipt_lines l JOIN inventory_goods_receipts g ON g.coffee_shop_id=l.coffee_shop_id AND g.id=l.goods_receipt_id
      JOIN inventory_items i ON i.coffee_shop_id=l.coffee_shop_id AND i.id=l.inventory_item_id
      WHERE g.coffee_shop_id=$1 AND g.supplier_id=$2 AND g.status='POSTED'
      ORDER BY l.inventory_item_id,g.received_at DESC,l.created_at DESC,l.id DESC LIMIT $3 OFFSET $4`, [tenantId, supplierId, limit, (page - 1) * limit]);
    return { items, page, limit, total: count };
  }

  async purchaseOrders(tenantId: string, query: PurchasingListQueryDto) {
    await this.gate(tenantId);
    const { page, limit } = this.paging(query), values: unknown[] = [tenantId], where = ["po.coffee_shop_id=$1"];
    if (query.search?.trim()) { values.push(query.search.trim()); where.push(`(po.number ILIKE '%'||$${values.length}||'%' OR po.supplier_name_snapshot ILIKE '%'||$${values.length}||'%')`); }
    if (query.status) {
      if (!Object.values(PurchaseOrderStatus).includes(query.status as PurchaseOrderStatus)) throw new BadRequestException("Invalid purchase order status");
      values.push(query.status); where.push(`po.status=$${values.length}`);
    }
    const base = `FROM inventory_purchase_orders po WHERE ${where.join(" AND ")}`;
    const [{ count }] = await this.db.query(`SELECT count(*)::int AS count ${base}`, values);
    values.push(limit, (page - 1) * limit);
    const rows = await this.db.query(`SELECT po.id,po.number,po.supplier_id AS "supplierId",po.supplier_name_snapshot AS "supplierName",po.status,
      po.order_date AS "orderDate",po.expected_delivery_date AS "expectedDeliveryDate",po.created_at AS "createdAt",
      (SELECT count(*)::int FROM inventory_purchase_order_items i WHERE i.coffee_shop_id=po.coffee_shop_id AND i.purchase_order_id=po.id) AS "lineCount",
      COALESCE((SELECT sum(round(i.quantity_display*i.unit_price_toman)) FROM inventory_purchase_order_items i WHERE i.coffee_shop_id=po.coffee_shop_id AND i.purchase_order_id=po.id),0)::text AS "estimatedTotalToman"
      ${base} ORDER BY po.created_at DESC,po.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { items: rows, page, limit, total: count };
  }

  async purchaseOrder(tenantId: string, id: string) {
    await this.gate(tenantId);
    const [order] = await this.db.query(`SELECT po.id,po.number,po.supplier_id AS "supplierId",po.supplier_name_snapshot AS "supplierName",po.status,
      po.order_date AS "orderDate",po.expected_delivery_date AS "expectedDeliveryDate",po.notes,po.created_by_user_id AS "createdByUserId",
      po.ordered_by_user_id AS "orderedByUserId",po.ordered_at AS "orderedAt",po.canceled_by_user_id AS "canceledByUserId",po.canceled_at AS "canceledAt",
      po.created_at AS "createdAt",po.updated_at AS "updatedAt",COALESCE(sum(round(i.quantity_display*i.unit_price_toman)),0)::text AS "estimatedTotalToman"
      FROM inventory_purchase_orders po LEFT JOIN inventory_purchase_order_items i ON i.coffee_shop_id=po.coffee_shop_id AND i.purchase_order_id=po.id
      WHERE po.coffee_shop_id=$1 AND po.id=$2 GROUP BY po.id`, [tenantId, id]);
    if (!order) throw new NotFoundException("Purchase order not found");
    const items = await this.db.query(`SELECT i.id,i.inventory_item_id AS "inventoryItemId",i.item_name_snapshot AS "itemName",it.dimension,it.base_unit AS "baseUnit",
      i.quantity_display::text AS quantity,i.unit,i.quantity_base::text AS "quantityBase",i.unit_price_toman AS "unitPriceToman",i.note,
      COALESCE(sum(r.quantity_base) FILTER(WHERE g.status='POSTED'),0)::text AS "receivedQuantityBase"
      FROM inventory_purchase_order_items i JOIN inventory_items it ON it.coffee_shop_id=i.coffee_shop_id AND it.id=i.inventory_item_id
      LEFT JOIN inventory_goods_receipt_lines r ON r.coffee_shop_id=i.coffee_shop_id AND r.purchase_order_item_id=i.id
      LEFT JOIN inventory_goods_receipts g ON g.coffee_shop_id=r.coffee_shop_id AND g.id=r.goods_receipt_id
      WHERE i.coffee_shop_id=$1 AND i.purchase_order_id=$2 GROUP BY i.id,it.id ORDER BY i.item_name_snapshot`, [tenantId, id]);
    const lines = items.map((line: Record<string, string>) => {
      const remaining = addQuantities(line.quantityBase!, `-${line.receivedQuantityBase!}`);
      return { ...line, remainingQuantityBase: remaining, remainingQuantity: quantityFromBase(remaining, line.dimension as InventoryDimension, line.unit!, line.baseUnit!) };
    });
    const receipts = await this.db.query(`SELECT id,number,status,posted_at AS "postedAt",created_at AS "createdAt" FROM inventory_goods_receipts WHERE coffee_shop_id=$1 AND purchase_order_id=$2 ORDER BY created_at DESC`, [tenantId, id]);
    return { ...order, items: lines, receipts };
  }

  async createPurchaseOrder(tenantId: string, actorId: string, input: CreatePurchaseOrderDto) {
    await this.gate(tenantId);
    try {
      const id = await this.db.transaction(async (m) => {
        const supplier = await this.supplierRow(m, tenantId, input.supplierId, true);
        const number = await this.nextNumber(m, tenantId, "PO");
        const [order] = await m.query(`INSERT INTO inventory_purchase_orders(coffee_shop_id,supplier_id,number,supplier_name_snapshot,order_date,expected_delivery_date,notes,created_by_user_id)
          VALUES($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6::date,$7,$8) RETURNING id`, [tenantId, supplier.id, number, supplier.name, input.orderDate ?? null, input.expectedDeliveryDate ?? null, clean(input.notes), actorId]);
        await this.replacePurchaseOrderItems(m, tenantId, order.id, input.items);
        return order.id as string;
      });
      return this.purchaseOrder(tenantId, id);
    } catch (error) { return uniqueConflict(error); }
  }

  async updatePurchaseOrder(tenantId: string, id: string, input: UpdatePurchaseOrderDto) {
    await this.gate(tenantId);
    try {
      await this.db.transaction(async (m) => {
        const [order] = await m.query(`SELECT * FROM inventory_purchase_orders WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
        if (!order) throw new NotFoundException("Purchase order not found");
        if (order.status !== "DRAFT") throw new ConflictException("Only draft purchase orders can be edited");
        const supplier = input.supplierId ? await this.supplierRow(m, tenantId, input.supplierId, true) : null;
        await m.query(`UPDATE inventory_purchase_orders SET supplier_id=COALESCE($3,supplier_id),supplier_name_snapshot=COALESCE($4,supplier_name_snapshot),
          order_date=COALESCE($5::date,order_date),expected_delivery_date=CASE WHEN $6 THEN $7::date ELSE expected_delivery_date END,
          notes=CASE WHEN $8 THEN $9 ELSE notes END,updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,
        [tenantId, id, supplier?.id ?? null, supplier?.name ?? null, input.orderDate ?? null, input.expectedDeliveryDate !== undefined, input.expectedDeliveryDate ?? null, input.notes !== undefined, clean(input.notes)]);
        if (input.items) await this.replacePurchaseOrderItems(m, tenantId, id, input.items);
      });
      return this.purchaseOrder(tenantId, id);
    } catch (error) { return uniqueConflict(error); }
  }

  async orderPurchaseOrder(tenantId: string, actorId: string, id: string) {
    await this.gate(tenantId);
    const [result] = await this.db.query(`UPDATE inventory_purchase_orders po SET status='ORDERED',ordered_by_user_id=$3,ordered_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE po.coffee_shop_id=$1 AND po.id=$2 AND po.status='DRAFT' AND EXISTS(SELECT 1 FROM inventory_purchase_order_items i WHERE i.coffee_shop_id=po.coffee_shop_id AND i.purchase_order_id=po.id) RETURNING po.id`, [tenantId, id, actorId]);
    if (!result) {
      const [existing] = await this.db.query(`SELECT status FROM inventory_purchase_orders WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, id]);
      if (!existing) throw new NotFoundException("Purchase order not found");
      throw new ConflictException("Only a nonempty draft can be ordered");
    }
    return this.purchaseOrder(tenantId, id);
  }

  async cancelPurchaseOrder(tenantId: string, actorId: string, id: string) {
    await this.gate(tenantId);
    await this.db.transaction(async (m) => {
      const [order] = await m.query(`SELECT id,status FROM inventory_purchase_orders WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
      if (!order) throw new NotFoundException("Purchase order not found");
      if (!["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) throw new ConflictException("This purchase order cannot be canceled");
      await m.query(`DELETE FROM inventory_goods_receipts WHERE coffee_shop_id=$1 AND purchase_order_id=$2 AND status='DRAFT'`, [tenantId, id]);
      await m.query(`UPDATE inventory_purchase_orders SET status='CANCELED',canceled_by_user_id=$3,canceled_at=clock_timestamp(),updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, id, actorId]);
    });
    return this.purchaseOrder(tenantId, id);
  }

  async goodsReceipts(tenantId: string, query: PurchasingListQueryDto) {
    await this.gate(tenantId);
    const { page, limit } = this.paging(query), values: unknown[] = [tenantId], where = ["g.coffee_shop_id=$1"];
    if (query.search?.trim()) { values.push(query.search.trim()); where.push(`(g.number ILIKE '%'||$${values.length}||'%' OR g.supplier_name_snapshot ILIKE '%'||$${values.length}||'%' OR COALESCE(g.supplier_invoice_number,'') ILIKE '%'||$${values.length}||'%')`); }
    if (query.status) {
      if (query.status !== "DRAFT" && query.status !== "POSTED") throw new BadRequestException("Invalid goods receipt status");
      values.push(query.status); where.push(`g.status=$${values.length}`);
    }
    const base = `FROM inventory_goods_receipts g LEFT JOIN inventory_purchase_orders po ON po.coffee_shop_id=g.coffee_shop_id AND po.id=g.purchase_order_id WHERE ${where.join(" AND ")}`;
    const [{ count }] = await this.db.query(`SELECT count(*)::int AS count ${base}`, values);
    values.push(limit, (page - 1) * limit);
    const rows = await this.db.query(`SELECT g.id,g.number,g.status,g.supplier_id AS "supplierId",g.supplier_name_snapshot AS "supplierName",
      g.purchase_order_id AS "purchaseOrderId",po.number AS "purchaseOrderNumber",g.supplier_invoice_number AS "supplierInvoiceNumber",
      g.delivery_note_number AS "deliveryNoteNumber",g.over_receive_confirmed AS "overReceiveConfirmed",g.received_at AS "receivedAt",g.posted_at AS "postedAt",g.created_at AS "createdAt",
      (SELECT count(*)::int FROM inventory_goods_receipt_lines l WHERE l.coffee_shop_id=g.coffee_shop_id AND l.goods_receipt_id=g.id) AS "lineCount",
      COALESCE((SELECT sum(l.total_cost_toman) FROM inventory_goods_receipt_lines l WHERE l.coffee_shop_id=g.coffee_shop_id AND l.goods_receipt_id=g.id),0)::text AS "totalCostToman"
      ${base} ORDER BY g.created_at DESC,g.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { items: rows, page, limit, total: count };
  }

  async goodsReceipt(tenantId: string, id: string) {
    await this.gate(tenantId);
    const [receipt] = await this.db.query(`SELECT g.id,g.number,g.status,g.supplier_id AS "supplierId",g.supplier_name_snapshot AS "supplierName",
      g.purchase_order_id AS "purchaseOrderId",po.number AS "purchaseOrderNumber",g.supplier_invoice_number AS "supplierInvoiceNumber",
      g.delivery_note_number AS "deliveryNoteNumber",g.over_receive_confirmed AS "overReceiveConfirmed",g.notes,g.received_at AS "receivedAt",g.created_by_user_id AS "createdByUserId",
      g.posted_by_user_id AS "postedByUserId",g.posted_at AS "postedAt",g.created_at AS "createdAt",g.updated_at AS "updatedAt"
      FROM inventory_goods_receipts g LEFT JOIN inventory_purchase_orders po ON po.coffee_shop_id=g.coffee_shop_id AND po.id=g.purchase_order_id
      WHERE g.coffee_shop_id=$1 AND g.id=$2`, [tenantId, id]);
    if (!receipt) throw new NotFoundException("Goods receipt not found");
    const items = await this.db.query(`SELECT l.id,l.purchase_order_item_id AS "purchaseOrderItemId",l.inventory_item_id AS "inventoryItemId",
      l.item_name_snapshot AS "itemName",i.base_unit AS "baseUnit",l.location_id AS "locationId",loc.name AS "locationName",
      l.quantity_display::text AS quantity,l.unit,l.quantity_base::text AS "quantityBase",l.unit_price_toman AS "unitPriceToman",
      l.total_cost_toman AS "totalCostToman",l.note,l.movement_id AS "movementId"
      FROM inventory_goods_receipt_lines l JOIN inventory_items i ON i.coffee_shop_id=l.coffee_shop_id AND i.id=l.inventory_item_id
      JOIN inventory_locations loc ON loc.coffee_shop_id=l.coffee_shop_id AND loc.id=l.location_id
      WHERE l.coffee_shop_id=$1 AND l.goods_receipt_id=$2 ORDER BY l.created_at,l.id`, [tenantId, id]);
    return { ...receipt, items };
  }

  async createGoodsReceipt(tenantId: string, actorId: string, input: CreateGoodsReceiptDto) {
    await this.gate(tenantId);
    try {
      const id = await this.db.transaction(async (m) => {
        const { supplier, order } = await this.receiptSource(m, tenantId, input.purchaseOrderId, input.supplierId);
        const number = await this.nextNumber(m, tenantId, "GR");
        const [receipt] = await m.query(`INSERT INTO inventory_goods_receipts(coffee_shop_id,supplier_id,purchase_order_id,number,supplier_name_snapshot,supplier_invoice_number,delivery_note_number,notes,created_by_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [tenantId, supplier.id, order?.id ?? null, number, supplier.name, clean(input.supplierInvoiceNumber), clean(input.deliveryNoteNumber), clean(input.notes), actorId]);
        await this.replaceGoodsReceiptLines(m, tenantId, receipt.id, order?.id ?? null, input.items);
        return receipt.id as string;
      });
      return this.goodsReceipt(tenantId, id);
    } catch (error) { return uniqueConflict(error); }
  }

  async updateGoodsReceipt(tenantId: string, id: string, input: UpdateGoodsReceiptDto) {
    await this.gate(tenantId);
    try {
      await this.db.transaction(async (m) => {
        const [receipt] = await m.query(`SELECT * FROM inventory_goods_receipts WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
        if (!receipt) throw new NotFoundException("Goods receipt not found");
        if (receipt.status !== "DRAFT") throw new ConflictException("Posted goods receipts cannot be edited");
        const { supplier, order } = await this.receiptSource(m, tenantId, receipt.purchase_order_id, input.supplierId ?? receipt.supplier_id);
        await m.query(`UPDATE inventory_goods_receipts SET supplier_id=$3,supplier_name_snapshot=$4,
          supplier_invoice_number=CASE WHEN $5 THEN $6 ELSE supplier_invoice_number END,
          delivery_note_number=CASE WHEN $7 THEN $8 ELSE delivery_note_number END,
          notes=CASE WHEN $9 THEN $10 ELSE notes END,updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,
        [tenantId, id, supplier.id, supplier.name, input.supplierInvoiceNumber !== undefined, clean(input.supplierInvoiceNumber), input.deliveryNoteNumber !== undefined, clean(input.deliveryNoteNumber), input.notes !== undefined, clean(input.notes)]);
        if (input.items) await this.replaceGoodsReceiptLines(m, tenantId, id, order?.id ?? null, input.items);
      });
      return this.goodsReceipt(tenantId, id);
    } catch (error) { return uniqueConflict(error); }
  }

  async postGoodsReceipt(tenantId: string, actorId: string, id: string, allowOverReceive: boolean) {
    await this.gate(tenantId);
    try {
      await this.db.transaction(async (m) => {
        const [receipt] = await m.query(`SELECT * FROM inventory_goods_receipts WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
        if (!receipt) throw new NotFoundException("Goods receipt not found");
        if (receipt.status === "POSTED") return;
        const [order] = receipt.purchase_order_id ? await m.query(`SELECT * FROM inventory_purchase_orders WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [tenantId, receipt.purchase_order_id]) : [null];
        if (receipt.purchase_order_id && (!order || order.status === "CANCELED" || order.status === "DRAFT")) throw new ConflictException("Goods cannot be received against a canceled or unordered purchase order");
        const lines = await m.query(`SELECT l.*
          FROM inventory_goods_receipt_lines l WHERE l.coffee_shop_id=$1 AND l.goods_receipt_id=$2 ORDER BY l.inventory_item_id,l.location_id,l.id FOR UPDATE`, [tenantId, id]);
        if (!lines.length) throw new ConflictException("A goods receipt must contain at least one line");
        const overReceiveConfirmed = order ? await this.assertRemainingOrderQuantities(m, tenantId, order.id, lines, allowOverReceive) : false;
        for (const line of lines) {
          const [item] = await m.query(`SELECT id,is_active FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2 FOR SHARE`, [tenantId, line.inventory_item_id]);
          if (!item) throw new NotFoundException("Inventory item not found");
          if (!item.is_active) throw new ConflictException("Inactive inventory items cannot receive stock");
          const [location] = await m.query(`SELECT id FROM inventory_locations WHERE coffee_shop_id=$1 AND id=$2 AND is_active FOR SHARE`, [tenantId, line.location_id]);
          if (!location) throw new ConflictException("Receiving location is no longer active");
          const movement = await this.inventory.postPurchaseReceipt(m, tenantId, actorId, {
            itemId: line.inventory_item_id, locationId: line.location_id,
            quantity: line.quantity_base, totalCostToman: line.total_cost_toman, receiptId: id, lineId: line.id,
            reason: `Purchase receipt ${receipt.number}`,
          });
          await m.query(`UPDATE inventory_goods_receipt_lines SET movement_id=$3 WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, line.id, movement.id]);
        }
        await m.query(`UPDATE inventory_goods_receipts SET status='POSTED',over_receive_confirmed=$4,posted_by_user_id=$3,posted_at=clock_timestamp(),received_at=clock_timestamp(),updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, id, actorId, overReceiveConfirmed]);
        if (order) await this.updateOrderReceivingStatus(m, tenantId, order.id);
      });
    } catch (error) {
      if (!(error instanceof HttpException)) this.logger.error(JSON.stringify({ event: "inventory_goods_receipt_post_failed", tenantId, goodsReceiptId: id, operation: "post" }), error instanceof Error ? error.stack : undefined);
      return uniqueConflict(error);
    }
    return this.goodsReceipt(tenantId, id);
  }

  private async supplierRow(m: EntityManager, tenantId: string, id: string, active: boolean) {
    const [row] = await m.query(`SELECT id,name,is_active FROM inventory_suppliers WHERE coffee_shop_id=$1 AND id=$2${active ? " AND is_active" : ""} FOR SHARE`, [tenantId, id]);
    if (!row) throw new NotFoundException(active ? "Active supplier not found" : "Supplier not found");
    return row;
  }

  private async replacePurchaseOrderItems(m: EntityManager, tenantId: string, orderId: string, lines: PurchaseOrderLineDto[]) {
    if (new Set(lines.map((line) => line.inventoryItemId)).size !== lines.length) throw new BadRequestException("An inventory item can appear only once on a purchase order");
    await m.query(`DELETE FROM inventory_purchase_order_items WHERE coffee_shop_id=$1 AND purchase_order_id=$2`, [tenantId, orderId]);
    for (const line of lines) {
      const item = await this.inventoryLine(m, tenantId, line.inventoryItemId, line.quantity, line.unit);
      await m.query(`INSERT INTO inventory_purchase_order_items(coffee_shop_id,purchase_order_id,inventory_item_id,item_name_snapshot,quantity_display,unit,quantity_base,unit_price_toman,note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [tenantId, orderId, item.id, item.name, line.quantity, line.unit, item.quantityBase, line.unitPriceToman, clean(line.note)]);
    }
  }

  private async replaceGoodsReceiptLines(m: EntityManager, tenantId: string, receiptId: string, orderId: string | null, lines: GoodsReceiptLineDto[]) {
    await m.query(`DELETE FROM inventory_goods_receipt_lines WHERE coffee_shop_id=$1 AND goods_receipt_id=$2`, [tenantId, receiptId]);
    const defaultLocation = await this.inventory.defaultLocation(m, tenantId);
    for (const line of lines) {
      const item = await this.inventoryLine(m, tenantId, line.inventoryItemId, line.quantity, line.unit);
      const locationId = line.locationId ?? defaultLocation.id;
      await this.inventory.activeLocation(m, tenantId, locationId);
      let orderItemId = line.purchaseOrderItemId ?? null;
      if (orderId) {
        const [orderItem] = orderItemId
          ? await m.query(`SELECT id,inventory_item_id FROM inventory_purchase_order_items WHERE coffee_shop_id=$1 AND purchase_order_id=$2 AND id=$3`, [tenantId, orderId, orderItemId])
          : await m.query(`SELECT id,inventory_item_id FROM inventory_purchase_order_items WHERE coffee_shop_id=$1 AND purchase_order_id=$2 AND inventory_item_id=$3`, [tenantId, orderId, item.id]);
        if (!orderItem || orderItem.inventory_item_id !== item.id) throw new BadRequestException("Receipt item must match a line on its purchase order");
        orderItemId = orderItem.id;
      } else if (orderItemId) throw new BadRequestException("Direct receipts cannot reference purchase order lines");
      await m.query(`INSERT INTO inventory_goods_receipt_lines(coffee_shop_id,goods_receipt_id,purchase_order_item_id,inventory_item_id,item_name_snapshot,location_id,quantity_display,unit,quantity_base,unit_price_toman,total_cost_toman,note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,ROUND($7::numeric*$10::bigint)::bigint,$11)`,
      [tenantId, receiptId, orderItemId, item.id, item.name, locationId, line.quantity, line.unit, item.quantityBase, line.unitPriceToman, clean(line.note)]);
    }
  }

  private async inventoryLine(m: EntityManager, tenantId: string, itemId: string, quantity: string, unit: string) {
    const [item] = await m.query(`SELECT id,name,dimension,base_unit,is_active FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2 FOR SHARE`, [tenantId, itemId]);
    if (!item) throw new NotFoundException("Inventory item not found");
    if (!item.is_active) throw new ConflictException("Inactive inventory items cannot be ordered or received");
    const quantityBase = quantityToBase(quantity, item.dimension as InventoryDimension, unit, item.base_unit);
    if (!positive(quantityBase)) throw new BadRequestException("Quantity must be greater than zero");
    return { ...item, quantityBase };
  }

  private async receiptSource(m: EntityManager, tenantId: string, orderId?: string | null, supplierId?: string | null) {
    if (orderId) {
      const [order] = await m.query(`SELECT id,supplier_id,status FROM inventory_purchase_orders WHERE coffee_shop_id=$1 AND id=$2 FOR SHARE`, [tenantId, orderId]);
      if (!order) throw new NotFoundException("Purchase order not found");
      if (order.status === "DRAFT" || order.status === "CANCELED") throw new ConflictException("Order the purchase order before receiving goods");
      if (supplierId && supplierId !== order.supplier_id) throw new BadRequestException("Receipt supplier must match the purchase order");
      return { supplier: await this.supplierRow(m, tenantId, order.supplier_id, false), order };
    }
    if (!supplierId) throw new BadRequestException("A supplier is required for a direct goods receipt");
    return { supplier: await this.supplierRow(m, tenantId, supplierId, true), order: null };
  }

  private async assertRemainingOrderQuantities(m: EntityManager, tenantId: string, orderId: string, lines: Array<Record<string, string | null>>, allowOverReceive: boolean) {
    const receiving = new Map<string, string>();
    for (const line of lines) if (line.purchase_order_item_id) {
      const id = line.purchase_order_item_id;
      receiving.set(id, addQuantities(receiving.get(id) ?? "0", line.quantity_base!));
    }
    let overReceiveConfirmed = false;
    for (const [itemId, quantity] of receiving) {
      const [item] = await m.query(`SELECT i.quantity_base::text AS ordered,
        COALESCE((SELECT sum(l.quantity_base) FROM inventory_goods_receipt_lines l JOIN inventory_goods_receipts g ON g.coffee_shop_id=l.coffee_shop_id AND g.id=l.goods_receipt_id
          WHERE l.coffee_shop_id=i.coffee_shop_id AND l.purchase_order_item_id=i.id AND g.status='POSTED'),0)::text AS received
        FROM inventory_purchase_order_items i WHERE i.coffee_shop_id=$1 AND i.purchase_order_id=$2 AND i.id=$3`, [tenantId, orderId, itemId]);
      if (!item) throw new NotFoundException("Purchase order item not found");
      const remaining = addQuantities(item.ordered, `-${item.received}`);
      if (exceeds(quantity, remaining)) {
        if (!allowOverReceive) throw new ConflictException("Received quantity exceeds the remaining ordered quantity; confirm over-receiving explicitly");
        overReceiveConfirmed = true;
      }
    }
    return overReceiveConfirmed;
  }

  private async updateOrderReceivingStatus(m: EntityManager, tenantId: string, orderId: string) {
    const [summary] = await m.query(`SELECT count(*)::int AS lines,count(*) FILTER(WHERE received >= ordered)::int AS complete,
      count(*) FILTER(WHERE received > 0)::int AS started FROM (
        SELECT i.quantity_base AS ordered,COALESCE(sum(l.quantity_base) FILTER(WHERE g.status='POSTED'),0) AS received
        FROM inventory_purchase_order_items i LEFT JOIN inventory_goods_receipt_lines l ON l.coffee_shop_id=i.coffee_shop_id AND l.purchase_order_item_id=i.id
        LEFT JOIN inventory_goods_receipts g ON g.coffee_shop_id=l.coffee_shop_id AND g.id=l.goods_receipt_id
        WHERE i.coffee_shop_id=$1 AND i.purchase_order_id=$2 GROUP BY i.id
      ) q`, [tenantId, orderId]);
    const status = summary.lines === summary.complete ? "RECEIVED" : summary.started ? "PARTIALLY_RECEIVED" : "ORDERED";
    await m.query(`UPDATE inventory_purchase_orders SET status=$3,updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, orderId, status]);
  }
}
