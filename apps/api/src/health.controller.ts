import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './common/prisma.service';

/** Spec 12.3: the container orchestrator restarts on a failing health check. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness and database reachability' })
  async check(): Promise<{ status: 'ok' | 'degraded'; database: boolean }> {
    const database = await this.pingDatabase();
    return { status: database ? 'ok' : 'degraded', database };
  }

  private async pingDatabase(): Promise<boolean> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
