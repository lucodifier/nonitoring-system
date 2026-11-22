import { api } from '@/lib/api';

export interface Service {
  id: string;
  name: string;
  type: string;
  description?: string;
  env?: string;
  containerId?: string;
  url?: string;
  prometheusJob?: string;
  lokiLabel?: string;
  importance?: string;
  team?: string;
  repositoryUrl?: string;
  documentationUrl?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  currentStatus?: {
    serviceId: string;
    status: 'UP' | 'DOWN' | 'DEGRADED';
    cpuUsage: number;
    memoryUsage: number;
    diskUsage?: number;
    networkIn?: number;
    networkOut?: number;
    uptimeSeconds?: number;
    lastCheck: string;
    lastChange?: string;
    metadata?: any;
  };
  // Campos legados para compatibilidade (não usados se currentStatus existir)
  status?: 'healthy' | 'degraded' | 'down';
  version?: string;
  lastDeploy?: string;
  uptime?: string;
  cpu?: number;
  memory?: number;
}

export const servicesService = {
  getAll: async (isActive?: boolean): Promise<Service[]> => {
    const params = new URLSearchParams();
    if (isActive !== undefined) {
      params.append('isActive', String(isActive));
    }
    const response = await api.get(`/services${params.toString() ? `?${params.toString()}` : ''}`);
    return response.data;
  },

  getById: async (id: string): Promise<Service> => {
    const response = await api.get(`/services/${id}`);
    return response.data;
  },

  getHistory: async (id: string, startDate?: string, endDate?: string, limit: number = 100): Promise<any[]> => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    params.append('limit', String(limit));
    const response = await api.get(`/services/${id}/history?${params.toString()}`);
    return response.data;
  },

  start: async (id: string): Promise<{ success: boolean; message: string }> => {
    const response = await api.post(`/services/${id}/start`);
    return response.data;
  },

  stop: async (id: string): Promise<{ success: boolean; message: string }> => {
    const response = await api.post(`/services/${id}/stop`);
    return response.data;
  },

  restart: async (id: string): Promise<{ success: boolean; message: string }> => {
    const response = await api.post(`/services/${id}/restart`);
    return response.data;
  }
};
