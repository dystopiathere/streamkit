import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../../config/app-config.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { KnownDeviceService } from './known-device.service';
import { PasswordResetService } from './password-reset.service';
import { SecurityMailService } from './security-mail.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: {
          expiresIn: config.accessTtlSeconds,
          issuer: 'streamkit',
        },
        verifyOptions: { issuer: 'streamkit' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailVerificationService,
    KnownDeviceService,
    PasswordResetService,
    SecurityMailService,
    TokenService,
    TotpService,
  ],
  exports: [AuthService, TokenService, TotpService],
})
export class AuthModule {}
