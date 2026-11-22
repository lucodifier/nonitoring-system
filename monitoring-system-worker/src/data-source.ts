import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { Service } from './entities/Service';
import { ServiceStatusCurrent } from './entities/ServiceStatusCurrent';
import { ServiceStatusHistory } from './entities/ServiceStatusHistory';
import { ServiceAlert } from './entities/ServiceAlert';
import { ServiceError } from './entities/ServiceError';
import { Vm } from './entities/Vm';
import { VmStatusHistory } from './entities/VmStatusHistory';
import { DiskSnapshot } from './entities/DiskSnapshot';
import { VmAlert } from './entities/VmAlert';

dotenv.config({ quiet: true });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'monitoring_system',
  synchronize: false,
  logging: false,
  schema: 'monitoring',
  entities: [
    Service,
    ServiceStatusCurrent,
    ServiceStatusHistory,
    ServiceAlert,
    ServiceError,
    Vm,
    VmStatusHistory,
    DiskSnapshot,
    VmAlert,
  ],
  // Glob com .ts e .js: ts-node roda de src/ em dev, e a imagem roda de dist/ em prod.
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  subscribers: [],
});
