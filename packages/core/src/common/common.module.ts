import { Global, Module } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, IdempotencyInterceptor],
  exports: [PrismaService, IdempotencyInterceptor],
})
export class CommonModule {}
