import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  // Desabilitar logs desnecessários do NestJS
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'], // Apenas erros e warnings
  });

  const configService = app.get(ConfigService);

  // Global prefix
  const apiPrefix = configService.get('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  // CORS - Habilitado para todas as origens
  app.enableCors({
    origin: true, // Permite todas as origens
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    exposedHeaders: ['Authorization'],
    credentials: true,
    maxAge: 3600,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Monitoring System API')
    .setDescription('API for monitoring services, metrics, and alerts')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Authentication', 'User authentication endpoints')
    .addTag('Services', 'Service management and status')
    .addTag('Metrics', 'Metrics and performance data')
    .addTag('Alerts', 'Alert management')
    .addTag('Errors', 'Error tracking')
    .addTag('Deployment', 'Deployment checklist')
    .addTag('VMs', 'Virtual machines health and disk forecast')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get('PORT', 5070);
  const host = configService.get('HOST', '0.0.0.0');
  
  // Determinar URL para exibição (local vs produção)
  let apiUrl = configService.get('API_URL');
  
  if (!apiUrl) {
    // Detectar ambiente: development = local, production = servidor
    const nodeEnv = configService.get('NODE_ENV', 'development');
    const isLocal = nodeEnv === 'development';
    
    apiUrl = isLocal 
      ? `http://localhost:${port}`
      : `http://localhost:${port}`;
  }
  
  await app.listen(port, host);

  console.log(`
  ============================================
  🚀 Monitoring System Engine is running!
  ============================================
  📡 API: ${apiUrl}/${apiPrefix}
  📚 Swagger Docs: ${apiUrl}/api/docs
  ============================================
  `);
}

bootstrap();
