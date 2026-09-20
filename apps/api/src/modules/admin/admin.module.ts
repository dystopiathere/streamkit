import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { EventsModule } from '../events/events.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { RoomMediaModule } from '../rooms/room-media.module';
import { RoomsModule } from '../rooms/rooms.module';
import { WidgetsModule } from '../widgets/widgets.module';
import { AccountStatusService } from './account-status.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminObjectsService } from './admin-objects.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import { AdminObjectsController, AdminUsersController } from './admin.controller';

/**
 * Административная панель: только API, только админские токены.
 *
 * Модуль сам ничего не меняет в обход владельцев: действия идут через их
 * сервисы, чтобы у отзыва из админки были те же следствия, что у отзыва из
 * дашборда.
 */
@Module({
  imports: [
    AuthModule,
    WidgetsModule,
    RoomsModule,
    RoomMediaModule,
    BillingModule,
    PrivacyModule,
    // Обнуление истории донатов идёт тем же сервисом, что у стримера.
    EventsModule,
  ],
  controllers: [AdminAuthController, AdminUsersController, AdminObjectsController],
  providers: [
    AdminAuthService,
    AccountStatusService,
    AdminUsersService,
    AdminObjectsService,
    AdminStatsService,
  ],
})
export class AdminModule {}
