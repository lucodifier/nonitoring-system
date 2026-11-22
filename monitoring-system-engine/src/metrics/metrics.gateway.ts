import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MetricsService } from './metrics.service';
import { ServicesService } from '../services/services.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'metrics',
})
export class MetricsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MetricsGateway.name);
  private interval: NodeJS.Timeout;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly servicesService: ServicesService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    
    // Enviar dados iniciais imediatamente
    this.sendDashboardUpdate();

    // Se for o primeiro cliente, iniciar o loop de atualização
    // Verificar se server e sockets existem antes de acessar
    try {
      const clientCount = this.server?.sockets?.sockets?.size || 0;
      if (clientCount === 1) {
        this.startUpdates();
      }
    } catch (error) {
      this.logger.warn('Error checking client count on connection:', error);
      // Se não conseguir verificar, inicia updates de qualquer forma
      if (!this.interval) {
        this.startUpdates();
      }
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    
    // Se não houver mais clientes, parar o loop para economizar recursos
    // Verificar se server e sockets existem antes de acessar
    try {
      const clientCount = this.server?.sockets?.sockets?.size || 0;
      if (clientCount === 0) {
        this.stopUpdates();
      }
    } catch (error) {
      this.logger.warn('Error checking client count on disconnect:', error);
      // Se não conseguir verificar, para updates de qualquer forma
      this.stopUpdates();
    }
  }

  private startUpdates() {
    this.logger.log('Starting real-time updates');
    this.interval = setInterval(async () => {
      await this.sendDashboardUpdate();
    }, 5000); // Atualizar a cada 5 segundos
  }

  private stopUpdates() {
    this.logger.log('Stopping real-time updates');
    clearInterval(this.interval);
  }

  private async sendDashboardUpdate() {
    try {
      const summary = await this.servicesService.getDashboardSummary();
      this.server.emit('dashboard-summary', summary);
      
      // Simular tráfego de rede em tempo real (já que não temos endpoint real ainda)
      const traffic = {
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        inbound: Math.floor(Math.random() * 1000) + 500,
        outbound: Math.floor(Math.random() * 800) + 300,
      };
      this.server.emit('network-traffic', traffic);
      
    } catch (error) {
      this.logger.error('Error sending dashboard update', error);
    }
  }
}
