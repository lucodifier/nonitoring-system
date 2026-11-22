import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { 
  ArrowLeft, 
  Activity, 
  Cpu, 
  HardDrive, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  Terminal,
  RefreshCw,
  Github
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { servicesService, Service } from "@/services/servicesService";
import { serviceErrorsService, ServiceErrorEntry, dozzleUrlFor, runtimeIdOf } from "@/services/logsService";
import { metricsService } from "@/services/metricsService";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function ServiceDetails() {
  const [match, params] = useRoute("/services/:id");
  const [, setLocation] = useLocation();
  const [service, setService] = useState<Service | null>(null);
  const [logs, setLogs] = useState<ServiceErrorEntry[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorRate, setErrorRate] = useState(0);

  const serviceId = params?.id;

  useEffect(() => {
    if (serviceId) {
      loadData();
      // Polling a cada 10s para dados "live" (idealmente seria websocket)
      const interval = setInterval(loadData, 10000);
      return () => clearInterval(interval);
    }
  }, [serviceId]);

  const loadData = async () => {
    if (!serviceId) return;
    try {
      // 1. Carregar detalhes do serviço
      const serviceData = await servicesService.getById(serviceId);
      setService(serviceData);

      // 2. Carregar erros recentes de monitoring.service_errors.
      //    Antes isso vinha do Loki via lokiLabel; como a ingestao no Loki esta
      //    fora do ar, o painel ficava sempre vazio. O worker agora grava os erros
      //    lidos do stdout do container direto na tabela.
      const errorsData = await serviceErrorsService.getByService(serviceData.id, 50);
      setLogs(errorsData);
      setErrorRate(errorsData.filter((e) => !e.isResolved).length > 0 ? 100 : 0);

      // 4. Carregar histórico de métricas (últimos 20 minutos)
      try {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 20 * 60 * 1000); // Últimos 20 minutos
        const historyData = await servicesService.getHistory(serviceId, startDate.toISOString(), endDate.toISOString(), 100);
        
        // Formatar dados para o gráfico
        if (historyData && historyData.length > 0) {
          const formattedHistory = historyData
            .slice(0, 20) // Pegar últimos 20 pontos
            .reverse() // Inverter para mostrar do mais antigo para o mais recente
            .map((item: any) => ({
              time: new Date(item.checkedAt).toLocaleTimeString(),
              cpu: item.cpuUsage || 0,
              memory: item.memoryUsage || 0,
            }));
          
          setMetrics(formattedHistory);
        } else {
          // Se não houver histórico, usar dados atuais como ponto único
          const currentCpu = serviceData.currentStatus?.cpuUsage || 0;
          const currentMemory = serviceData.currentStatus?.memoryUsage || 0;
          setMetrics([{
            time: new Date().toLocaleTimeString(),
            cpu: currentCpu,
            memory: currentMemory,
          }]);
        }
      } catch (historyError) {
        console.error("Failed to load history", historyError);
        // Em caso de erro, usar dados atuais
        const currentCpu = serviceData.currentStatus?.cpuUsage || 0;
        const currentMemory = serviceData.currentStatus?.memoryUsage || 0;
        setMetrics([{
          time: new Date().toLocaleTimeString(),
          cpu: currentCpu,
          memory: currentMemory,
        }]);
      }

    } catch (error) {
      console.error("Failed to load service details", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen text-primary animate-pulse">Loading Service Data...</div>;
  }

  if (!service) {
    return <div className="flex flex-col items-center justify-center h-screen gap-4">
      <h1 className="text-2xl text-destructive">Service Not Found</h1>
      <Button onClick={() => setLocation("/services")}>Back to Services</Button>
    </div>;
  }

  return (
    <div className="space-y-6 p-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/services")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-glow flex items-center gap-3">
              {service.name}
              {service.env && (
                <Badge variant="outline" className="text-sm font-mono border-primary/50 text-primary">
                  {service.env}
                </Badge>
              )}
              {service.repositoryUrl && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => window.open(service.repositoryUrl, '_blank', 'noopener,noreferrer')}
                  title={`Open repository: ${service.repositoryUrl}`}
                >
                  <Github className="h-5 w-5" />
                </Button>
              )}
            </h1>
            <div className="flex items-center gap-2 text-muted-foreground mt-1">
              <span className="font-mono text-xs uppercase">ID: {service.id}</span>
              <span>•</span>
              <span className="font-mono text-xs uppercase">{service.type}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {(() => {
            const status = service.currentStatus?.status || service.status || 'unknown';
            const statusMap = {
              'UP': { label: 'healthy', color: 'bg-green-500/10 border-green-500/20 text-green-500', icon: CheckCircle2 },
              'DOWN': { label: 'down', color: 'bg-destructive/10 border-destructive/20 text-destructive', icon: XCircle },
              'DEGRADED': { label: 'degraded', color: 'bg-amber-500/10 border-amber-500/20 text-amber-500', icon: AlertTriangle },
              'healthy': { label: 'healthy', color: 'bg-green-500/10 border-green-500/20 text-green-500', icon: CheckCircle2 },
              'degraded': { label: 'degraded', color: 'bg-amber-500/10 border-amber-500/20 text-amber-500', icon: AlertTriangle },
              'down': { label: 'down', color: 'bg-destructive/10 border-destructive/20 text-destructive', icon: XCircle },
            };
            const statusInfo = statusMap[status as keyof typeof statusMap] || statusMap['down'];
            const Icon = statusInfo.icon;
            return (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${statusInfo.color}`}>
                <Icon className="w-4 h-4" />
                <span className="font-bold uppercase text-sm">{statusInfo.label}</span>
              </div>
            );
          })()}
          <Button variant="outline" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Uptime</CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {service.currentStatus?.uptimeSeconds 
                ? `${Math.floor((service.currentStatus.uptimeSeconds || 0) / 3600)}h ${Math.floor(((service.currentStatus.uptimeSeconds || 0) % 3600) / 60)}m`
                : service.uptime || 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">
              {service.currentStatus?.lastCheck 
                ? `Last check: ${new Date(service.currentStatus.lastCheck).toLocaleString()}`
                : 'Last 30 days'}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Error Rate</CardTitle>
            <AlertTriangle className={`h-4 w-4 ${errorRate > 5 ? 'text-destructive' : 'text-green-500'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${errorRate > 5 ? 'text-destructive' : 'text-green-500'}`}>
              {errorRate.toFixed(2)}%
            </div>
            <p className="text-xs text-muted-foreground">Based on last 50 logs</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">CPU Usage</CardTitle>
            <Cpu className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {service.currentStatus?.cpuUsage?.toFixed(1) || service.cpu?.toFixed(1) || '0'}%
            </div>
            <Progress 
              value={service.currentStatus?.cpuUsage || service.cpu || 0} 
              className="h-1 mt-2" 
            />
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Memory</CardTitle>
            <HardDrive className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {service.currentStatus?.memoryUsage?.toFixed(0) || service.memory?.toFixed(0) || '0'} MB
            </div>
            <Progress 
              value={((service.currentStatus?.memoryUsage || service.memory || 0) / 1024) * 100} 
              className="h-1 mt-2 bg-purple-900/20 [&>div]:bg-purple-500" 
            />
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Metrics Chart */}
        <Card className="lg:col-span-2 bg-black/40 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Performance Metrics (Last 20 min)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="time" stroke="#666" fontSize={12} />
                  {/* CPU em % (eixo esquerdo) e memória em MB (eixo direito) — unidades
                      diferentes, eixos separados. memory_usage é gravado em MB pelo worker. */}
                  <YAxis yAxisId="cpu" stroke="#00f3ff" fontSize={12} domain={[0, 100]} />
                  <YAxis yAxisId="mem" orientation="right" stroke="#a855f7" fontSize={12} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#000', border: '1px solid #333' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(value: any, name: any) =>
                      name === 'CPU %'
                        ? [`${Number(value).toFixed(1)}%`, name]
                        : [`${Number(value).toFixed(0)} MB`, name]
                    }
                  />
                  <Line yAxisId="cpu" type="monotone" dataKey="cpu" stroke="#00f3ff" strokeWidth={2} dot={false} name="CPU %" />
                  <Line yAxisId="mem" type="monotone" dataKey="memory" stroke="#a855f7" strokeWidth={2} dot={false} name="Mem (MB)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent Logs */}
        <Card className="bg-black/80 border-primary/20 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
          <CardHeader className="border-b border-white/10 bg-white/5 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-primary" />
              <CardTitle className="text-sm font-mono">Recent Errors</CardTitle>
            </div>
            <Button variant="ghost" size="sm" className="text-xs h-6" asChild>
              <a href={dozzleUrlFor(runtimeIdOf(service))} target="_blank" rel="noopener noreferrer">
                Ver logs no Dozzle
              </a>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[300px] w-full p-4 font-mono text-xs">
              {logs.length === 0 ? (
                <div className="text-center text-muted-foreground py-10">
                  Nenhum erro registrado para este servico.
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((entry) => (
                    <div key={entry.id} className="flex gap-2 border-b border-white/5 pb-1 last:border-0">
                      <span className="text-gray-500 w-32 shrink-0">
                        {new Date(entry.occurredAt).toLocaleString()}
                      </span>
                      <span className={`font-bold uppercase w-12 shrink-0 ${
                        entry.isResolved ? 'text-green-500' : 'text-red-500'
                      }`}>
                        [{entry.errorLevel || 'error'}]
                      </span>
                      <span className="text-gray-400 break-all line-clamp-2">
                        {entry.errorMessage}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
