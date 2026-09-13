import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  type CreatedRoomInvite,
  type CreateRoomInput,
  type CreateRoomInviteInput,
  createRoomInviteSchema,
  createRoomSchema,
  type GuestJoinInput,
  type GuestJoinResult,
  guestJoinSchema,
  type OverlayRoomAccessInput,
  overlayRoomAccessSchema,
  type Room,
  type RoomAccess,
  type RoomInviteView,
  type RoomParticipant,
} from '@streamkit/contracts';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { type AuthenticatedUser, CurrentUser, Public } from '../../common/auth/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { RoomsService } from './rooms.service';

// Жёсткий лимитер auth предназначен для входа и регистрации; на ручки дашборда
// он не распространяется. Исключение — вход гостя ниже.
@SkipThrottle({ auth: true })
@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Вход гостя по ссылке. Единственная публичная ручка комнат.
   *
   * Лимит — как у входа в аккаунт: токен приглашения — это тоже секрет, и его
   * перебор с одного адреса должен упираться в ту же стену. Маршрут объявлен
   * раньше `:id`, хотя методы и глубина пути у них и так разные.
   */
  @Public()
  @SkipThrottle({ auth: false })
  @Post('join')
  @HttpCode(HttpStatus.OK)
  async join(
    @Body(zodBody(guestJoinSchema)) body: GuestJoinInput,
    @Req() request: Request,
  ): Promise<GuestJoinResult> {
    return this.rooms.guestJoin(body, this.audit.contextFromRequest(request));
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<Room[]> {
    return this.rooms.list(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createRoomSchema)) body: CreateRoomInput,
    @Req() request: Request,
  ): Promise<Room> {
    return this.rooms.create(user.id, body.name, this.audit.contextFromRequest(request));
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Room> {
    return this.rooms.get(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.rooms.remove(user.id, id, this.audit.contextFromRequest(request));
  }

  @Get(':id/invites')
  async listInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoomInviteView[]> {
    return this.rooms.listInvites(user.id, id);
  }

  /** Ссылка возвращается целиком и только здесь: в БД лежит хэш. */
  @Post(':id/invites')
  async createInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createRoomInviteSchema)) body: CreateRoomInviteInput,
    @Req() request: Request,
  ): Promise<CreatedRoomInvite> {
    return this.rooms.createInvite(user.id, id, body.label, this.audit.contextFromRequest(request));
  }

  @Delete(':id/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.rooms.revokeInvite(user.id, id, inviteId, this.audit.contextFromRequest(request));
  }

  @Post(':id/host-access')
  @HttpCode(HttpStatus.OK)
  async hostAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoomAccess> {
    return this.rooms.hostAccess(user.id, id);
  }

  @Get(':id/participants')
  async participants(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoomParticipant[]> {
    return this.rooms.participants(user.id, id);
  }

  /** `?revoke=true` — удалить и отозвать ссылку, иначе гость просто откроет её снова. */
  @Post(':id/participants/:identity/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeGuest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('identity') identity: string,
    @Query('revoke') revoke: string | undefined,
    @Req() request: Request,
  ): Promise<void> {
    await this.rooms.removeGuest(
      user.id,
      id,
      identity,
      revoke === 'true',
      this.audit.contextFromRequest(request),
    );
  }

  /** Отнять у гостя право на микрофон. Держится на ссылке и переживает перезагрузку вкладки. */
  @Post(':id/participants/:identity/mute')
  @HttpCode(HttpStatus.NO_CONTENT)
  async blockMicrophone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('identity') identity: string,
  ): Promise<void> {
    await this.rooms.blockMicrophone(user.id, id, identity);
  }

  @Post(':id/participants/:identity/unmute')
  @HttpCode(HttpStatus.NO_CONTENT)
  async allowMicrophone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('identity') identity: string,
  ): Promise<void> {
    await this.rooms.allowMicrophone(user.id, id, identity);
  }
}

/**
 * Доступ браузер-сорса OBS к комнате.
 *
 * Отдельным контроллером и HTTP-запросом, а не сообщением сокета оверлея: токен
 * LiveKit нужен заново после долгого обрыва, а сокет в этот момент может быть
 * ещё не поднят. Лимит обычный, а не как у входа: оверлей спрашивает доступ при
 * каждом старте сцены и после каждого обрыва.
 */
@SkipThrottle({ auth: true })
@Controller('overlay')
export class OverlayRoomController {
  constructor(private readonly rooms: RoomsService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('room-access')
  @HttpCode(HttpStatus.OK)
  async roomAccess(
    @Body(zodBody(overlayRoomAccessSchema)) body: OverlayRoomAccessInput,
  ): Promise<RoomAccess> {
    return this.rooms.overlayAccess(body.token);
  }
}
