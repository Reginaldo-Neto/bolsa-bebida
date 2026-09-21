import { REALTIME_CHANNEL, eventRoom, participantRoom, realtimeMessageSchema } from '@bolsa/shared';
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type OnGatewayConnection, type OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { ParticipantsService } from '../participants/participants.service';
import { SESSION_COOKIE } from '../participants/session';
import { REDIS_SUBSCRIBER } from './redis.provider';

/**
 * Spec 10.2: one socket per phone, joined to the rooms it is entitled to.
 *
 * Payloads are pushed by whichever process produced them (the worker for
 * ticks, the API for orders), travel through one Redis channel, and are fanned
 * out here. Rooms are assigned from the session, never from what the client
 * asks for.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private server?: Server;

  constructor(
    @Inject(REDIS_SUBSCRIBER) private readonly redis: Redis,
    private readonly participants: ParticipantsService,
  ) {}

  afterInit(server: Server): void {
    this.server = server;

    void this.redis.subscribe(REALTIME_CHANNEL).catch((error: unknown) => {
      this.logger.error(`nao foi possivel subscrever o canal de tempo real: ${String(error)}`);
    });

    this.redis.on('message', (channel: string, raw: string) => {
      if (channel !== REALTIME_CHANNEL) {
        return;
      }
      this.relay(raw);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.unsubscribe(REALTIME_CHANNEL).catch(() => undefined);
  }

  async handleConnection(client: Socket): Promise<void> {
    const eventId = firstQueryValue(client.handshake.query.eventId);
    if (!eventId) {
      client.disconnect(true);
      return;
    }

    // Anyone may watch the market: prices are public and must be (L2). The
    // public screen connects with no session at all.
    await client.join(eventRoom(eventId));

    const sessionId = sessionFromCookies(client.handshake.headers.cookie);
    if (!sessionId) {
      return;
    }

    const participant = await this.participants.findBySession(sessionId);
    if (participant && participant.eventId === eventId) {
      await client.join(participantRoom(participant.id));
    }
  }

  private relay(raw: string): void {
    const parsed = realtimeMessageSchema.safeParse(safeJsonParse(raw));
    if (!parsed.success) {
      this.logger.warn('mensagem de tempo real invalida ignorada');
      return;
    }

    this.server?.to(parsed.data.room).emit(parsed.data.event, parsed.data.payload);
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The socket handshake carries the raw Cookie header, and socket.io has no
 * equivalent of Fastify's unsignCookie. The signature is dropped and the value
 * used as a lookup key: the session id is 32 bytes from a CSPRNG stored unique
 * in the database, so it is the secret in its own right. A forged cookie finds
 * no participant and joins no private room.
 */
function sessionFromCookies(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const value = decodeURIComponent(rest.join('='));
      // Signed cookies are "value.signature"; the value is everything before it.
      const dot = value.lastIndexOf('.');
      return dot > 0 ? value.slice(0, dot) : value;
    }
  }

  return null;
}
