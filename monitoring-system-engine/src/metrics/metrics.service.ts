import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceStatusHistory } from '../services/entities/service-status-history.entity';
import { ServiceError } from '../services/entities/service-error.entity';

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(ServiceStatusHistory)
    private historyRepository: Repository<ServiceStatusHistory>,
    @InjectRepository(ServiceError)
    private errorsRepository: Repository<ServiceError>,
  ) {}

  async getCpuMetrics(serviceId: string, hours: number = 24) {
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);

    const data = await this.historyRepository
      .createQueryBuilder('history')
      .select('history.checked_at', 'timestamp')
      .addSelect('history.cpu_usage', 'value')
      .where('history.service_id = :serviceId', { serviceId })
      .andWhere('history.checked_at >= :startDate', { startDate })
      .orderBy('history.checked_at', 'ASC')
      .getRawMany();

    return {
      serviceId,
      metric: 'cpu_usage',
      unit: 'percent',
      data,
    };
  }

  async getMemoryMetrics(serviceId: string, hours: number = 24) {
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);

    const data = await this.historyRepository
      .createQueryBuilder('history')
      .select('history.checked_at', 'timestamp')
      .addSelect('history.memory_usage', 'value')
      .where('history.service_id = :serviceId', { serviceId })
      .andWhere('history.checked_at >= :startDate', { startDate })
      .orderBy('history.checked_at', 'ASC')
      .getRawMany();

    return {
      serviceId,
      metric: 'memory_usage',
      unit: 'percent',
      data,
    };
  }

  async getErrorsPerMinute(serviceId?: string, minutes: number = 60) {
    const startDate = new Date();
    startDate.setMinutes(startDate.getMinutes() - minutes);

    const query = this.errorsRepository
      .createQueryBuilder('error')
      .select("DATE_TRUNC('minute', error.occurred_at)", 'minute')
      .addSelect('COUNT(*)', 'count')
      .where('error.occurred_at >= :startDate', { startDate })
      .groupBy("DATE_TRUNC('minute', error.occurred_at)")
      .orderBy("DATE_TRUNC('minute', error.occurred_at)", 'DESC');

    if (serviceId) {
      query.andWhere('error.service_id = :serviceId', { serviceId });
    }

    const data = await query.getRawMany();

    return {
      serviceId: serviceId || 'all',
      metric: 'errors_per_minute',
      unit: 'count',
      data: data.map((d) => ({
        timestamp: d.minute,
        value: parseInt(d.count),
      })),
    };
  }

  async getMultiServiceMetrics(
    serviceIds: string[],
    metric: 'cpu' | 'memory',
    hours: number = 24,
  ) {
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);

    const column = metric === 'cpu' ? 'cpu_usage' : 'memory_usage';

    const data = await this.historyRepository
      .createQueryBuilder('history')
      .select('history.service_id', 'serviceId')
      .addSelect('history.checked_at', 'timestamp')
      .addSelect(`history.${column}`, 'value')
      .where('history.service_id IN (:...serviceIds)', { serviceIds })
      .andWhere('history.checked_at >= :startDate', { startDate })
      .orderBy('history.checked_at', 'ASC')
      .getRawMany();

    // Agrupa por serviço
    const grouped = serviceIds.reduce((acc, serviceId) => {
      acc[serviceId] = data
        .filter((d) => d.serviceId === serviceId)
        .map((d) => ({
          timestamp: d.timestamp,
          value: d.value,
        }));
      return acc;
    }, {});

    return {
      metric: `${metric}_usage`,
      unit: 'percent',
      services: grouped,
    };
  }

  async getServiceUptime(serviceId: string, hours: number = 24) {
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);

    const result = await this.historyRepository
      .createQueryBuilder('history')
      .select('COUNT(*)', 'total')
      .addSelect(
        "COUNT(*) FILTER (WHERE history.status = 'UP')",
        'upCount',
      )
      .where('history.service_id = :serviceId', { serviceId })
      .andWhere('history.checked_at >= :startDate', { startDate })
      .getRawOne();

    const total = parseInt(result.total);
    const upCount = parseInt(result.upCount);
    const uptimePercentage = total > 0 ? (upCount / total) * 100 : 0;

    return {
      serviceId,
      hours,
      total,
      upCount,
      uptimePercentage: parseFloat(uptimePercentage.toFixed(2)),
    };
  }
}
