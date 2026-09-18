import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { MoreThan, Repository } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { normalizeIranianMobile } from "../auth/iran-phone.util";
import { PlanStatus, SubscriptionPlan } from "../subscriptions/entities";
import { CreatePlatformOrderRequestDto } from "./dto/create-platform-order-request.dto";
import { PlatformOrderRequest, PlatformOrderStatus } from "./entities";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationType } from "../notifications/notification-type";

const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class PlatformOrdersService {
  constructor(
    @InjectRepository(PlatformOrderRequest) private readonly requests: Repository<PlatformOrderRequest>,
    @InjectRepository(SubscriptionPlan) private readonly plans: Repository<SubscriptionPlan>,
    private readonly crypto: AuthCryptoService,
    private readonly notifications: NotificationsService,
  ) {}

  async getPublicOffering() {
    const plan = await this.plans.findOneBy({ key: "silver", status: PlanStatus.Active });
    if (!plan) throw new NotFoundException("Public offering is not available");
    return {
      key: plan.key,
      name: plan.name,
      priceToman: plan.priceToman,
      billingMonths: plan.billingMonths,
      trialDays: plan.trialDays,
    };
  }

  async create(input: CreatePlatformOrderRequestDto) {
    const now = new Date();
    if (input.website?.trim()) return { id: randomUUID(), status: PlatformOrderStatus.New, createdAt: now };

    let phone: string;
    try {
      phone = normalizeIranianMobile(input.phone);
    } catch {
      throw new BadRequestException("Phone number is invalid");
    }
    const phoneHash = this.crypto.hashPhone(phone);
    const recent = await this.requests.existsBy({ phoneHash, createdAt: MoreThan(new Date(now.getTime() - DUPLICATE_WINDOW_MS)) });
    if (recent) throw new HttpException("Please wait before submitting another request", HttpStatus.TOO_MANY_REQUESTS);

    const request = this.requests.create({
      contactName: input.contactName.trim(),
      coffeeShopName: input.coffeeShopName.trim(),
      phoneEncrypted: this.crypto.encryptPhone(phone),
      phoneHash,
      city: input.city.trim(),
      businessStage: input.businessStage,
      requestedServices: [...new Set(input.requestedServices)],
      note: input.note?.trim() || null,
      status: PlatformOrderStatus.New,
      source: "platform_landing",
    });
    if (!request.contactName || !request.coffeeShopName || !request.city) throw new BadRequestException("Required text fields cannot be blank");
    const saved = await this.requests.save(request);
    await this.notifications.enqueue(this.requests.manager, {
      coffeeShopId: null,
      type: NotificationType.RequestCounseling,
      relatedEntityType: "platform_order_request",
      relatedEntityId: saved.id,
      deduplicationKey: `${NotificationType.RequestCounseling}:${saved.id}`,
      phone,
      payload: { customerName: saved.contactName },
    });
    return { id: saved.id, status: saved.status, createdAt: saved.createdAt };
  }

  async list() {
    return this.requests.find({ select: { id: true, contactName: true, coffeeShopName: true, city: true, status: true, createdAt: true }, order: { createdAt: "DESC" } });
  }

  async detail(id: string) {
    const request = await this.requests.createQueryBuilder("request").addSelect("request.phoneEncrypted").where("request.id = :id", { id }).getOne();
    if (!request) throw new NotFoundException("Consultation request not found");
    const { phoneEncrypted, phoneHash: _phoneHash, ...result } = request;
    return { ...result, phone: this.crypto.decryptPhone(phoneEncrypted) };
  }
}
