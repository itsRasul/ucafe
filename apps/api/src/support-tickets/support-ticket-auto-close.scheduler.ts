import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SupportTicketsService } from "./support-tickets.service";

export const SUPPORT_TICKET_AUTO_CLOSE_INTERVAL_MS = 10 * 60 * 1_000;

@Injectable()
export class SupportTicketAutoCloseScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupportTicketAutoCloseScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly tickets: SupportTicketsService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runSweep(), SUPPORT_TICKET_AUTO_CLOSE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runSweep() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.tickets.autoCloseInactiveTickets();
      if (result.candidates || result.failed) {
        this.logger.log(`Support ticket inactivity sweep candidates=${result.candidates} closed=${result.closed} skipped=${result.skipped} failed=${result.failed}`);
      }
    } catch (error) {
      this.logger.error("Support ticket inactivity sweep failed", error instanceof Error ? error.stack : undefined);
    } finally {
      this.running = false;
    }
  }
}
