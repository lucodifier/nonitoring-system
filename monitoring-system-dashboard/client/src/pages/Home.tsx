import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Activity, 
  Server, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowUpRight, 
  ArrowDownRight,
  Cpu,
  Wifi,
  Loader2,
  Zap
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar
} from "recharts";
import { metricsService, DashboardSummary, NetworkTraffic, Alert } from "@/services/metricsService";
import { servicesService } from "@/services/servicesService";
import { useSocket } from "@/hooks/useSocket";
import { toast } from "sonner";

// Mock Data padrão para gráficos (será substituído por dados reais)
const defaultResourceUsageData = [
  { name: "Loading...", cpu: 0, memory: 0 },
];

// Função auxiliar para formatar tempo relativo
const formatTimeAgo = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
};

export default function Home() {
  const [, setLocation] = useLocation();
  
  // Inicializar com dados mock para garantir que sempre há algo para renderizar
  const defaultTrafficData: NetworkTraffic[] = Array.from({ length: 24 }, (_, i) => ({
    time: `${i}:00`,
    inbound: Math.floor(Math.random() * 1000) + 500,
    outbound: Math.floor(Math.random() * 800) + 300,
  }));

  // Inicializa com dados padrão imediatamente (não bloqueia renderização)
  const defaultSummary: DashboardSummary = {
    totalRequests: 0,
    activeServices: 0,
    totalServices: 0,
    avgResponseTime: 0,
    activeAlerts: 0,
    criticalAlerts: 0,
    systemHealth: 0,
  };

  const [summary, setSummary] = useState<DashboardSummary>(defaultSummary);
  const [trafficData, setTrafficData] = useState<NetworkTraffic[]>(defaultTrafficData);
  const [resourceUsageData, setResourceUsageData] = useState(defaultResourceUsageData);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const { socket, isConnected } = useSocket('metrics');

  // Carregamento inicial via HTTP - sempre renderiza, mesmo sem API
  useEffect(() => {
    let isMounted = true;
    
    // Tenta buscar dados da API em background (não bloqueia renderização)
    const fetchInitialData = async () => {
      try {
        const [summaryData, traffic, alerts, services] = await Promise.all([
          metricsService.getDashboardSummary().catch(() => null),
          metricsService.getNetworkTraffic().catch(() => defaultTrafficData),
          metricsService.getRecentAlerts(10).catch(() => []),
          servicesService.getAll(true).catch(() => [])
        ]);
        
        if (isMounted) {
          if (summaryData) {
            setSummary(summaryData);
          }
          if (traffic) {
            setTrafficData(traffic);
          }
          if (alerts) {
            setRecentAlerts(alerts);
          }
          if (services && services.length > 0) {
            // Formatar dados de Resource Usage dos serviços reais
            const resourceData = services
              .filter((s: any) => s.currentStatus) // Apenas serviços com status
              .slice(0, 10) // Limitar a 10 serviços
              .map((s: any) => ({
                name: s.name,
                cpu: s.currentStatus?.cpuUsage || 0,
                memory: s.currentStatus?.memoryUsage || 0,
              }));
            if (resourceData.length > 0) {
              setResourceUsageData(resourceData);
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch dashboard data", error);
        // Silencioso - já temos dados padrão
      }
    };

    // Busca dados em background
    fetchInitialData();
    
    return () => {
      isMounted = false;
    };
  }, []);

  // Atualizações em tempo real via WebSocket
  useEffect(() => {
    if (!socket) return;

    socket.on('dashboard-summary', (data: DashboardSummary) => {
      setSummary(data);
    });

    socket.on('network-traffic', (newData: NetworkTraffic) => {
      setTrafficData(prev => {
        const newTraffic = [...prev, newData];
        // Manter apenas os últimos 24 pontos
        if (newTraffic.length > 24) {
          return newTraffic.slice(newTraffic.length - 24);
        }
        return newTraffic;
      });
    });

    return () => {
      socket.off('dashboard-summary');
      socket.off('network-traffic');
    };
  }, [socket]);

  // Mapear dados da API para o formato esperado pelo frontend
  // A API retorna: { services: { total, up, down, degraded }, alerts: { unresolved, critical }, latestErrors }
  // O frontend espera: { totalRequests, activeServices, totalServices, avgResponseTime, activeAlerts, criticalAlerts, systemHealth }
  const displaySummary: DashboardSummary = {
    totalRequests: (summary as any).totalRequests ?? 0, // Não disponível ainda
    activeServices: (summary as any).services?.up ?? (summary as any).activeServices ?? 0,
    totalServices: (summary as any).services?.total ?? (summary as any).totalServices ?? 0,
    avgResponseTime: (summary as any).avgResponseTime ?? 0, // Não disponível ainda
    activeAlerts: (summary as any).alerts?.unresolved ?? (summary as any).activeAlerts ?? 0,
    criticalAlerts: (summary as any).alerts?.critical ?? (summary as any).criticalAlerts ?? 0,
    systemHealth: (() => {
      const total = (summary as any).services?.total ?? (summary as any).totalServices ?? 0;
      const up = (summary as any).services?.up ?? (summary as any).activeServices ?? 0;
      return total > 0 ? Math.round((up / total) * 100) : 0;
    })(),
  };

  // Dados do gráfico SYSTEM HEALTH baseado em status dos serviços
  const servicesData = (summary as any).services || {};
  const serviceHealthData = [
    { 
      name: "UP", 
      value: servicesData.up || 0, 
      color: "var(--color-neon-green)" 
    },
    { 
      name: "DOWN", 
      value: servicesData.down || 0, 
      color: "var(--color-destructive)" 
    },
    { 
      name: "DEGRADED", 
      value: servicesData.degraded || 0, 
      color: "var(--color-neon-amber)" 
    },
  ].filter(item => item.value > 0); // Remover itens com valor 0

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header com Status de Conexão */}
      <div className="flex justify-end items-center gap-2 text-xs font-mono">
        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-destructive'}`} />
        <span className={isConnected ? 'text-green-500' : 'text-destructive'}>
          {isConnected ? 'REAL-TIME CONNECTION ACTIVE' : 'CONNECTION LOST - RECONNECTING...'}
        </span>
        {isConnected && <Zap className="w-3 h-3 text-yellow-400 fill-yellow-400" />}
      </div>

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total Requests" 
          value={displaySummary.totalRequests.toLocaleString()} 
          trend="+12.5%" 
          trendUp={true}
          icon={Activity}
          color="text-primary"
        />
        <StatCard 
          title="Active Services" 
          value={`${displaySummary.activeServices}/${displaySummary.totalServices}`} 
          trend={`${displaySummary.systemHealth}% Health`} 
          trendUp={displaySummary.systemHealth > 90}
          icon={Server}
          color="text-green-500"
        />
        <StatCard 
          title="Avg Response Time" 
          value={`${displaySummary.avgResponseTime}ms`} 
          trend="-5ms" 
          trendUp={true}
          icon={Wifi}
          color="text-blue-400"
        />
        <StatCard 
          title="Active Alerts" 
          value={displaySummary.activeAlerts.toString()} 
          trend={`${displaySummary.criticalAlerts} Critical`} 
          trendUp={false}
          icon={AlertTriangle}
          color="text-amber-500"
        />
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Network Traffic Chart */}
        <Card className="cyber-card lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg font-mono tracking-wide">
                <Activity className="w-5 h-5 text-primary" />
                NETWORK TRAFFIC (LIVE)
              </CardTitle>
              <Badge variant="outline" className="text-xs text-muted-foreground border-muted">
                Simulated Data
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trafficData}>
                <defs>
                  <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#bc13fe" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#bc13fe" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  itemStyle={{ color: 'var(--foreground)' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="inbound" 
                  stroke="var(--color-primary)" 
                  fillOpacity={1} 
                  fill="url(#colorIn)" 
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Area 
                  type="monotone" 
                  dataKey="outbound" 
                  stroke="#bc13fe" 
                  fillOpacity={1} 
                  fill="url(#colorOut)" 
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Service Health Pie Chart */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-mono tracking-wide">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              SYSTEM HEALTH
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[300px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={serviceHealthData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {serviceHealthData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px' }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center Text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-bold text-foreground">{displaySummary.systemHealth}%</span>
              <span className="text-xs text-muted-foreground uppercase tracking-widest">Operational</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Resource Usage Bar Chart */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-mono tracking-wide">
              <Cpu className="w-5 h-5 text-blue-400" />
              RESOURCE USAGE
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={resourceUsageData} layout="vertical" margin={{ left: 120, right: 20, top: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} horizontal={false} />
                {/* Eixos separados: CPU é % (0-100), memória é MB (worker grava MB em
                    memory_usage). Num eixo único a memória esmaga as barras de CPU e o
                    rótulo "%" vira mentira (ex.: "MEM %: 2029" = 2029 MB ≈ 2 GB). */}
                <XAxis xAxisId="cpu" type="number" domain={[0, 100]} stroke="var(--muted-foreground)" fontSize={12} hide />
                <XAxis xAxisId="mem" type="number" stroke="var(--muted-foreground)" fontSize={12} hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  stroke="var(--muted-foreground)" 
                  fontSize={11} 
                  tickLine={false} 
                  axisLine={false} 
                  width={120}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => {
                    // Truncar nomes muito longos
                    if (value.length > 20) {
                      return value.substring(0, 17) + '...';
                    }
                    return value;
                  }}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)/20' }}
                  contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
                  formatter={(value: any, name: any) =>
                    name === 'CPU %'
                      ? [`${Number(value).toFixed(1)}%`, name]
                      : [`${Number(value).toFixed(0)} MB`, name]
                  }
                />
                <Bar xAxisId="cpu" dataKey="cpu" name="CPU %" fill="var(--color-primary)" radius={[0, 4, 4, 0]} barSize={10} />
                <Bar xAxisId="mem" dataKey="memory" name="MEM (MB)" fill="#bc13fe" radius={[0, 4, 4, 0]} barSize={10} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent Alerts List */}
        <Card className="cyber-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg font-mono tracking-wide">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              RECENT ALERTS
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              className="h-8 text-xs border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => setLocation('/alerts')}
            >
              VIEW ALL
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentAlerts.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No active alerts
                </div>
              ) : (
                recentAlerts.map((alert) => {
                  const timeAgo = formatTimeAgo(new Date(alert.createdAt));
                  return (
                    <div 
                      key={alert.id} 
                      className="flex items-start gap-3 p-3 rounded-md bg-background/50 border border-border/50 hover:border-primary/30 transition-colors group cursor-pointer"
                      onClick={() => setLocation('/alerts')}
                    >
                      <div className={`mt-1 w-2 h-2 rounded-full ${
                        alert.severity === 'critical' ? 'bg-destructive shadow-[0_0_8px_var(--color-destructive)]' : 
                        alert.severity === 'warning' ? 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' : 
                        'bg-blue-500'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                          {alert.title}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono mt-1">
                          {timeAgo} • {alert.severity.toUpperCase()} • {alert.service?.name || alert.serviceId}
                        </p>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setLocation('/alerts')}
                      >
                        <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, trend, trendUp, icon: Icon, color }: any) {
  return (
    <Card className="cyber-card hover:border-primary/50 transition-colors group">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className={`p-2 rounded-md bg-background/50 border border-border/50 group-hover:border-${color.split('-')[1]}/50 transition-colors`}>
            <Icon className={`w-5 h-5 ${color}`} />
          </div>
          <div className={`flex items-center gap-1 text-xs font-medium ${trendUp ? 'text-green-500' : 'text-destructive'}`}>
            {trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {trend}
          </div>
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-muted-foreground tracking-wide uppercase">{title}</h3>
          <div className="text-2xl font-bold font-mono text-foreground text-glow">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
