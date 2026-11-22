import { api } from '@/lib/api';

export interface DashboardSummary {
  totalRequests: number;
  activeServices: number;
  totalServices: number;
  avgResponseTime: number;
  activeAlerts: number;
  criticalAlerts: number;
  systemHealth: number;
}

export interface NetworkTraffic {
  time: string;
  inbound: number;
  outbound: number;
}

export interface Alert {
  id: string;
  serviceId: string;
  alertType: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  resolved: boolean;
  createdAt: string;
  service?: {
    id: string;
    name: string;
  };
}

export const metricsService = {
  getDashboardSummary: async (): Promise<DashboardSummary> => {
    const response = await api.get('/metrics/dashboard-summary');
    return response.data;
  },

  getNetworkTraffic: async (): Promise<NetworkTraffic[]> => {
    // Mock temporário até ter endpoint real de tráfego
    // O backend atual não tem endpoint específico de tráfego histórico
    return Array.from({ length: 24 }, (_, i) => ({
      time: `${i}:00`,
      inbound: Math.floor(Math.random() * 1000) + 500,
      outbound: Math.floor(Math.random() * 800) + 300,
    }));
  },

  getRecentAlerts: async (limit: number = 10, resolved?: boolean): Promise<Alert[]> => {
    const params = new URLSearchParams();
    if (resolved !== undefined) {
      params.append('resolved', String(resolved));
    }
    params.append('limit', String(limit));
    const response = await api.get(`/alerts?${params.toString()}`);
    return response.data;
  }
};
