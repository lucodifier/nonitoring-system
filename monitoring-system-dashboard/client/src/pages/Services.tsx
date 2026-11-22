import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { 
  Search, 
  Filter, 
  MoreVertical, 
  Server, 
  Database, 
  Globe, 
  Cpu, 
  CheckCircle2, 
  AlertCircle, 
  XCircle,
  RefreshCw,
  Loader2,
  Power,
  PowerOff,
  RotateCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { servicesService, Service } from "@/services/servicesService";
import { toast } from "sonner";

// Mapear status do banco para o formato da UI
const mapStatus = (status?: string): 'healthy' | 'degraded' | 'down' | 'unknown' => {
  if (!status) return 'unknown';
  const upperStatus = status.toUpperCase();
  if (upperStatus === 'UP') return 'healthy';
  if (upperStatus === 'DEGRADED') return 'degraded';
  if (upperStatus === 'DOWN') return 'down';
  return 'unknown';
};

// Calcular uptime em porcentagem (baseado no uptime em segundos)
const calculateUptimePercent = (uptimeSeconds?: number | null): string => {
  if (!uptimeSeconds || uptimeSeconds === 0) return '0%';
  // Assumindo que uptime de 86400 segundos (1 dia) = 100%
  const days = uptimeSeconds / 86400;
  const percent = Math.min(days * 100, 100);
  return percent.toFixed(1) + '%';
};

// Formatar data relativa
const formatRelativeTime = (date?: Date | string | null): string => {
  if (!date) return 'N/A';
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
};

const statusColors = {
  healthy: "text-green-500 bg-green-500/10 border-green-500/20",
  degraded: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  down: "text-destructive bg-destructive/10 border-destructive/20",
  unknown: "text-muted-foreground bg-muted/10 border-muted/20",
};

const typeIcons: Record<string, typeof Server> = {
  api: Server,
  worker: Cpu,
  database: Database,
  website: Globe,
  web: Globe,
  microservice: Server,
};

export default function Services() {
  const [searchTerm, setSearchTerm] = useState("");
  const [, setLocation] = useLocation();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    service: Service | null;
    action: 'start' | 'stop' | 'restart' | null;
  }>({ open: false, service: null, action: null });
  const [actionLoading, setActionLoading] = useState(false);

  const loadServices = async () => {
    try {
      // Buscar apenas serviços ativos
      const data = await servicesService.getAll(true);
      setServices(data);
    } catch (error) {
      console.error('Failed to load services', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadServices();
  };

  const handleServiceAction = async () => {
    if (!actionDialog.service || !actionDialog.action) return;

    setActionLoading(true);
    try {
      let result;
      switch (actionDialog.action) {
        case 'start':
          result = await servicesService.start(actionDialog.service.id);
          break;
        case 'stop':
          result = await servicesService.stop(actionDialog.service.id);
          break;
        case 'restart':
          result = await servicesService.restart(actionDialog.service.id);
          break;
        default:
          return;
      }

      if (result.success) {
        toast.success(result.message || `Service ${actionDialog.action}ed successfully`);
        // Aguardar um pouco antes de recarregar para dar tempo do Docker atualizar
        setTimeout(() => {
          loadServices();
        }, 2000);
      } else {
        toast.error(result.message || `Failed to ${actionDialog.action} service`);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || `Failed to ${actionDialog.action} service`);
    } finally {
      setActionLoading(false);
      setActionDialog({ open: false, service: null, action: null });
    }
  };

  const openActionDialog = (service: Service, action: 'start' | 'stop' | 'restart') => {
    setActionDialog({ open: true, service, action });
  };

  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (s.type && s.type.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-glow">Services Overview</h1>
          <p className="text-muted-foreground">Monitor and manage your microservices ecosystem.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search services..." 
              className="pl-9 bg-background/50 border-border/50 focus:border-primary/50"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" className="border-border/50">
            <Filter className="h-4 w-4" />
          </Button>
          <Button 
            onClick={handleRefresh}
            disabled={refreshing}
            className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_15px_-3px_var(--color-primary)]"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">Loading services...</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredServices.length === 0 && (
        <Card className="cyber-card">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Server className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {searchTerm ? 'No services found matching your search.' : 'No active services found.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Services Grid */}
      {!loading && filteredServices.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredServices.map((service) => {
            const serviceType = (service.type || 'api').toLowerCase();
            const Icon = typeIcons[serviceType] || Server;
            const status = mapStatus((service as any).currentStatus?.status);
            const statusColor = statusColors[status];
            
            // Extrair dados do currentStatus
            const currentStatus = (service as any).currentStatus;
            const cpuUsage = currentStatus?.cpuUsage || 0;
            const memoryUsage = currentStatus?.memoryUsage || 0;
            const uptimeSeconds = currentStatus?.uptimeSeconds;
            const lastCheck = currentStatus?.lastCheck;
          
          return (
            <Card key={service.id} className="cyber-card group hover:border-primary/50 transition-all duration-300">
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-md bg-background/50 border border-border/50`}>
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-medium group-hover:text-primary transition-colors">
                      {service.name}
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-border/50 font-mono">
                        {(service.type || 'API').toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-card border-border">
                    <DropdownMenuItem onClick={() => setLocation(`/services/${service.id}`)}>View Details</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setLocation(`/logs?service=${service.id}`)}>View Logs</DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => openActionDialog(service, 'restart')}
                      className="flex items-center gap-2"
                    >
                      <RotateCw className="h-4 w-4" />
                      Restart Service
                    </DropdownMenuItem>
                    {(() => {
                      const status = (service as any).currentStatus?.status;
                      const isRunning = status === 'UP';
                      return isRunning ? (
                        <DropdownMenuItem 
                          onClick={() => openActionDialog(service, 'stop')}
                          className="text-destructive flex items-center gap-2"
                        >
                          <PowerOff className="h-4 w-4" />
                          Stop Service
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem 
                          onClick={() => openActionDialog(service, 'start')}
                          className="text-green-500 flex items-center gap-2"
                        >
                          <Power className="h-4 w-4" />
                          Start Service
                        </DropdownMenuItem>
                      );
                    })()}
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              
              <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Status</span>
                    <div className={`flex items-center gap-1.5 text-sm font-medium px-2 py-1 rounded-full w-fit ${statusColor}`}>
                      {status === 'healthy' && <CheckCircle2 className="w-3.5 h-3.5" />}
                      {status === 'degraded' && <AlertCircle className="w-3.5 h-3.5" />}
                      {status === 'down' && <XCircle className="w-3.5 h-3.5" />}
                      {status === 'unknown' && <AlertCircle className="w-3.5 h-3.5" />}
                      <span className="capitalize">{status === 'unknown' ? 'Not Checked' : status}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Uptime</span>
                    <div className="text-sm font-mono font-bold text-foreground">
                      {calculateUptimePercent(uptimeSeconds)}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">CPU Usage</span>
                      <span className={`font-mono ${cpuUsage > 80 ? 'text-destructive' : 'text-foreground'}`}>
                        {cpuUsage.toFixed(1)}%
                      </span>
                    </div>
                    <Progress value={cpuUsage} className={`h-1.5 bg-background/50 ${cpuUsage > 80 ? '[&>div]:bg-destructive' : '[&>div]:bg-primary'}`} />
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Memory Usage</span>
                      <span className={`font-mono ${memoryUsage > 512 ? 'text-destructive' : 'text-foreground'}`}>
                        {memoryUsage.toFixed(0)}MB
                      </span>
                    </div>
                    {/* Progress bar usando um threshold de 1024MB (1GB) como 100% para visualização */}
                    <Progress value={Math.min((memoryUsage / 1024) * 100, 100)} className={`h-1.5 bg-background/50 ${memoryUsage > 512 ? '[&>div]:bg-destructive' : '[&>div]:bg-purple-500'}`} />
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-border/50 flex justify-between items-center text-xs text-muted-foreground">
                  <span>Last check: {formatRelativeTime(lastCheck)}</span>
                  <span className="font-mono opacity-50">ID: {service.id}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
        </div>
      )}

      {/* Action Confirmation Dialog */}
      <AlertDialog open={actionDialog.open} onOpenChange={(open) => {
        if (!open && !actionLoading) setActionDialog({ open: false, service: null, action: null });
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionDialog.action === 'start' && 'Start Service'}
              {actionDialog.action === 'stop' && 'Stop Service'}
              {actionDialog.action === 'restart' && 'Restart Service'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionDialog.action === 'start' && `Are you sure you want to start "${actionDialog.service?.name}"?`}
              {actionDialog.action === 'stop' && `Are you sure you want to stop "${actionDialog.service?.name}"? This will interrupt the service.`}
              {actionDialog.action === 'restart' && `Are you sure you want to restart "${actionDialog.service?.name}"? This will briefly interrupt the service.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleServiceAction}
              disabled={actionLoading}
              className={actionDialog.action === 'stop' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {actionLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {actionDialog.action === 'start' && 'Start'}
                  {actionDialog.action === 'stop' && 'Stop'}
                  {actionDialog.action === 'restart' && 'Restart'}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
