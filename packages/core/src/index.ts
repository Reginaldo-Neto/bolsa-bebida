/**
 * The domain of the Bolsa de Bebidas, shared by the API and the worker
 * (spec 8.2). Keeping it in a package rather than inside one of the apps is
 * what stops the worker from growing its own copy of settlement or stock logic.
 */
export { AppModule } from './app.module';
export { HealthController } from './health.controller';

export { CommonModule } from './common/common.module';
export { PrismaService } from './common/prisma.service';
export { ProblemDetailsFilter } from './common/problem.filter';
export { ZodValidationPipe, zodPipe } from './common/zod.pipe';
export { IdempotencyInterceptor } from './common/idempotency.interceptor';

export { parseEnv, type Env } from './config/env';

export { EventsModule } from './modules/events/events.module';
export { EventsService, type EventContext } from './modules/events/events.service';

export { InventoryModule } from './modules/inventory/inventory.module';
export { InventoryService, type StockMovement } from './modules/inventory/inventory.service';

export { MarketModule } from './modules/market/market.module';
export { MarketService, stockStatusOf, type PricePoint } from './modules/market/market.service';
export { TickService, type TickResult } from './modules/market/tick.service';

export { OrdersModule } from './modules/orders/orders.module';
export { OrdersService, type OrderSummary } from './modules/orders/orders.service';
export { ExpiryService } from './modules/orders/expiry.service';
export { PaymentPollerService } from './modules/payments/payment-poller.service';

export { ParticipantsModule } from './modules/participants/participants.module';
export {
  ParticipantsService,
  type ParticipantContext,
} from './modules/participants/participants.service';
export { ParticipantGuard, currentParticipant } from './modules/participants/participant.guard';
export { RetentionService } from './modules/participants/retention.service';

export { PaymentsModule } from './modules/payments/payments.module';
export { MockPaymentProvider } from './modules/payments/mock-payment.provider';
export { MbWayPaymentProvider } from './modules/payments/mbway-payment.provider';
export {
  PAYMENT_PROVIDER,
  PaymentProvider,
  type PaymentRequest,
  type PaymentResult,
  type PaymentWebhookEvent,
} from './modules/payments/payment-provider';

export { QuotesModule } from './modules/quotes/quotes.module';
export { QuotesService } from './modules/quotes/quotes.service';

export { VouchersModule } from './modules/vouchers/vouchers.module';
export { VouchersService } from './modules/vouchers/vouchers.service';
export { VoucherSignerService, type VoucherQr } from './modules/vouchers/voucher-signer.service';

export { RealtimeModule } from './modules/realtime/realtime.module';
export { RealtimeGatewayModule } from './modules/realtime/realtime-gateway.module';
export { RealtimePublisher } from './modules/realtime/realtime.publisher';
export { RealtimeGateway } from './modules/realtime/realtime.gateway';

export { AuditModule } from './modules/audit/audit.module';
export { AuditService } from './modules/audit/audit.service';
export { AuthModule } from './modules/auth/auth.module';
export { AuthService, type StaffContext } from './modules/auth/auth.service';
export { StaffGuard, AdminOnly, currentStaff } from './modules/auth/staff.guard';
export { StaffModule } from './modules/staff/staff.module';
export { StaffService, type ScannedVoucher } from './modules/staff/staff.service';
export { AdminModule } from './modules/admin/admin.module';
export { AdminService } from './modules/admin/admin.service';
export { ReportsService, toCsv, parseCsv } from './modules/admin/reports.service';

export { InvoicingModule } from './modules/invoicing/invoicing.module';
export { InvoicingService } from './modules/invoicing/invoicing.service';
export {
  INVOICING_PROVIDER,
  InvoicingProvider,
  type InvoiceRequest,
  type InvoiceResult,
} from './modules/invoicing/invoicing-provider';

export { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
export {
  LeaderboardService,
  type LeaderboardView,
  type RankedEntry,
} from './modules/leaderboard/leaderboard.service';
