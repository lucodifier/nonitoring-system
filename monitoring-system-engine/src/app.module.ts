import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { IdentitiesModule } from './identities/identities.module';
import { ServicesModule } from './services/services.module';
import { MetricsModule } from './metrics/metrics.module';
import { AlertsModule } from './alerts/alerts.module';
import { ErrorsModule } from './errors/errors.module';
import { DeploymentModule } from './deployment/deployment.module';
import { LogsModule } from './logs/logs.module';
import { VmsModule } from './vms/vms.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const host = configService.get('DATABASE_HOST');
        return {
          type: 'postgres',
          // Força IPv4 quando host é localhost
          host: host === 'localhost' ? '127.0.0.1' : host,
          port: configService.get<number>('DATABASE_PORT'),
          username: configService.get('DATABASE_USERNAME'),
          password: configService.get('DATABASE_PASSWORD'),
          database: configService.get('DATABASE_NAME'),
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: configService.get<boolean>('DATABASE_SYNCHRONIZE', false),
          logging: configService.get<boolean>('DATABASE_LOGGING', false),
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    IdentitiesModule,
    ServicesModule,
    MetricsModule,
    AlertsModule,
    ErrorsModule,
    DeploymentModule,
    LogsModule,
    VmsModule,
  ],
})
export class AppModule {}
