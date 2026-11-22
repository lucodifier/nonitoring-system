import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Service } from './entities/service.entity';
import { ServiceStatusCurrent } from './entities/service-status-current.entity';
import { ServiceStatusHistory } from './entities/service-status-history.entity';
import { ServiceError } from './entities/service-error.entity';
import { ServiceAlert } from './entities/service-alert.entity';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private servicesRepository: Repository<Service>,
    @InjectRepository(ServiceStatusCurrent)
    private statusCurrentRepository: Repository<ServiceStatusCurrent>,
    @InjectRepository(ServiceStatusHistory)
    private statusHistoryRepository: Repository<ServiceStatusHistory>,
    @InjectRepository(ServiceError)
    private errorsRepository: Repository<ServiceError>,
    @InjectRepository(ServiceAlert)
    private alertsRepository: Repository<ServiceAlert>,
  ) {}

  // ========== Services ==========
  async findAll(filters?: { type?: string; env?: string; isActive?: boolean }) {
    const where: any = {};
    if (filters?.type) where.type = filters.type;
    if (filters?.env) where.env = filters.env;
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;

    return this.servicesRepository.find({
      where,
      relations: ['currentStatus'],
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string) {
    const service = await this.servicesRepository.findOne({
      where: { id },
      relations: ['currentStatus'],
    });

    if (!service) {
      throw new NotFoundException(`Service with ID ${id} not found`);
    }

    return service;
  }

  // ========== Status Current ==========
  async getServiceStatus(serviceId: string) {
    const status = await this.statusCurrentRepository.findOne({
      where: { serviceId },
      relations: ['service'],
    });

    if (!status) {
      throw new NotFoundException(`Status for service ${serviceId} not found`);
    }

    return status;
  }

  // ========== Status History ==========
  async getServiceHistory(
    serviceId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 1000,
  ) {
    const query = this.statusHistoryRepository
      .createQueryBuilder('history')
      .where('history.service_id = :serviceId', { serviceId })
      .orderBy('history.checked_at', 'DESC')
      .limit(limit);

    if (startDate && endDate) {
      query.andWhere('history.checked_at BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      });
    }

    return query.getMany();
  }

  // ========== Errors ==========
  async getServiceErrors(
    serviceId: string,
    limit: number = 10,
    isResolved?: boolean,
  ) {
    const where: any = { serviceId };
    if (isResolved !== undefined) {
      where.isResolved = isResolved;
    }

    return this.errorsRepository.find({
      where,
      order: { occurredAt: 'DESC' },
      take: limit,
    });
  }

  async getLatestErrors(limit: number = 10) {
    return this.errorsRepository.find({
      where: { isResolved: false },
      relations: ['service'],
      order: { occurredAt: 'DESC' },
      take: limit,
    });
  }

  // ========== Alerts ==========
  async getServiceAlerts(
    serviceId: string,
    resolved?: boolean,
    limit: number = 50,
  ) {
    const where: any = { serviceId };
    if (resolved !== undefined) {
      where.resolved = resolved;
    }

    return this.alertsRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getAllAlerts(resolved?: boolean, limit: number = 100) {
    const where: any = {};
    if (resolved !== undefined) {
      where.resolved = resolved;
    }

    return this.alertsRepository.find({
      where,
      relations: ['service'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async resolveAlert(alertId: string, resolvedBy: string) {
    const alert = await this.alertsRepository.findOne({
      where: { id: alertId },
    });

    if (!alert) {
      throw new NotFoundException(`Alert with ID ${alertId} not found`);
    }

    alert.resolved = true;
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy;

    return this.alertsRepository.save(alert);
  }

  async acknowledgeAlert(alertId: string, acknowledgedBy: string) {
    const alert = await this.alertsRepository.findOne({
      where: { id: alertId },
    });

    if (!alert) {
      throw new NotFoundException(`Alert with ID ${alertId} not found`);
    }

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;

    return this.alertsRepository.save(alert);
  }

  // ========== Dashboard Summary ==========
  async getDashboardSummary() {
    const services = await this.servicesRepository.find({
      where: { isActive: true },
      relations: ['currentStatus'],
    });

    const totalServices = services.length;
    const upServices = services.filter(
      (s) => s.currentStatus?.status === 'UP',
    ).length;
    const downServices = services.filter(
      (s) => s.currentStatus?.status === 'DOWN',
    ).length;
    const degradedServices = services.filter(
      (s) => s.currentStatus?.status === 'DEGRADED',
    ).length;

    const unresolvedAlerts = await this.alertsRepository.count({
      where: { resolved: false },
    });

    const criticalAlerts = await this.alertsRepository.count({
      where: { resolved: false, severity: 'critical' },
    });

    const latestErrors = await this.getLatestErrors(10);

    return {
      services: {
        total: totalServices,
        up: upServices,
        down: downServices,
        degraded: degradedServices,
      },
      alerts: {
        unresolved: unresolvedAlerts,
        critical: criticalAlerts,
      },
      latestErrors,
    };
  }
}
