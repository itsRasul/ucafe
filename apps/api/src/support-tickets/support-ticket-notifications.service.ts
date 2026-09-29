import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { NotificationType } from "../notifications/notification-type";
import { NotificationsService } from "../notifications/notifications.service";
import { SupportTicketDepartment } from "./entities";

type TicketNotice = {
  id: string;
  coffeeShopId: string;
  referenceNumber: string;
  department: SupportTicketDepartment;
};

const departmentLabel: Record<SupportTicketDepartment, string> = {
  [SupportTicketDepartment.Technical]: "فنی",
  [SupportTicketDepartment.Sales]: "فروش",
};

@Injectable()
export class SupportTicketNotificationsService {
  private readonly logger = new Logger(SupportTicketNotificationsService.name);

  constructor(private readonly notifications: NotificationsService) {}

  created(manager: EntityManager, ticket: TicketNotice) {
    return this.enqueuePlatformSupport(manager, ticket, NotificationType.TicketCreated, ticket.id, {
      ticketReference: ticket.referenceNumber,
      department: departmentLabel[ticket.department],
    });
  }

  tenantReplied(manager: EntityManager, ticket: TicketNotice, messageId: string) {
    return this.enqueuePlatformSupport(manager, ticket, NotificationType.TicketTenantReplied, messageId, {
      ticketReference: ticket.referenceNumber,
      department: departmentLabel[ticket.department],
    });
  }

  async platformReplied(manager: EntityManager, ticket: TicketNotice & { createdByUserId: string }, messageId: string) {
    const recipients = await manager.query<Array<{ phone: string }>>(
      `SELECT DISTINCT u.phone FROM users u
       JOIN coffee_shop_memberships m ON m.user_id=u.id AND m.coffee_shop_id=$2 AND m.status='ACTIVE'
       JOIN membership_roles mr ON mr.membership_id=m.id
       JOIN roles r ON r.id=mr.role_id AND r.scope='TENANT'
         AND (r.coffee_shop_id IS NULL OR r.coffee_shop_id=m.coffee_shop_id)
       JOIN role_permissions rp ON rp.role_id=r.id
       JOIN permissions p ON p.id=rp.permission_id AND p.scope='TENANT' AND p.key='support.tickets.use'
       WHERE u.id=$1 AND u.status='ACTIVE' AND u.deleted_at IS NULL
         AND u.phone IS NOT NULL AND u.phone_verified_at IS NOT NULL`,
      [ticket.createdByUserId, ticket.coffeeShopId],
    );
    const recipient = recipients[0];
    if (!recipient) {
      this.logger.warn(`Ticket SMS skipped type=${NotificationType.TicketPlatformReplied} reference=${ticket.referenceNumber} recipient=tenant_creator reason=NO_ELIGIBLE_RECIPIENT`);
      return;
    }
    await this.notifications.enqueue(manager, {
      coffeeShopId: ticket.coffeeShopId,
      type: NotificationType.TicketPlatformReplied,
      relatedEntityType: "support_ticket",
      relatedEntityId: ticket.id,
      deduplicationKey: `${NotificationType.TicketPlatformReplied}:${messageId}:${ticket.createdByUserId}`,
      phone: recipient.phone,
      payload: { ticketReference: ticket.referenceNumber },
    });
  }

  private async enqueuePlatformSupport(
    manager: EntityManager,
    ticket: TicketNotice,
    type: NotificationType.TicketCreated | NotificationType.TicketTenantReplied,
    eventId: string,
    payload: Record<string, string>,
  ) {
    const recipients = await manager.query<Array<{ userId: string; phone: string }>>(
      `SELECT DISTINCT u.id AS "userId",u.phone
       FROM users u
       JOIN user_platform_roles upr ON upr.user_id=u.id
       JOIN roles r ON r.id=upr.role_id AND r.scope='PLATFORM' AND r.coffee_shop_id IS NULL
       JOIN role_permissions rp ON rp.role_id=r.id
       JOIN permissions p ON p.id=rp.permission_id AND p.scope='PLATFORM' AND p.key='support.tickets.reply'
       WHERE u.status='ACTIVE' AND u.deleted_at IS NULL
         AND u.phone IS NOT NULL AND u.phone_verified_at IS NOT NULL`,
      [],
    );
    if (!recipients.length) {
      this.logger.warn(`Ticket SMS skipped type=${type} reference=${ticket.referenceNumber} recipient=platform_support reason=NO_ELIGIBLE_RECIPIENT`);
      return;
    }
    for (const recipient of recipients) {
      await this.notifications.enqueue(manager, {
        coffeeShopId: ticket.coffeeShopId,
        type,
        relatedEntityType: "support_ticket",
        relatedEntityId: ticket.id,
        deduplicationKey: `${type}:${eventId}:${recipient.userId}`,
        phone: recipient.phone,
        payload,
      });
    }
  }
}
