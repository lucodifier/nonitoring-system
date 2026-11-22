import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Search,
  RefreshCw,
  Loader2,
  HardDrive,
  Server,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  vmsService,
  Vm,
  VmHealth,
  VmSummary,
  healthColors,
  healthLabels,
  statusLabels,
  diskColor,
  formatAge,
  formatGb,
} from "@/services/vmsService";

const healthIcons: Record<VmHealth, typeof Server> = {
  healthy: CheckCircle2,
  warning: AlertTriangle,
  down: XCircle,
  unknown: HelpCircle,
};

export default function Vms() {
  const [, setLocation] = useLocation();
  const [vms, setVms] = useState<Vm[]>([]);
  const [summary, setSummary] = useState<VmSummary | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadVms = async () => {
    try {
      const [vmsData, summaryData] = await Promise.all([
        vmsService.getAll(),
        vmsService.getSummary(),
      ]);
      setVms(vmsData);
      setSummary(summaryData);
    } catch (error) {
      console.error("Failed to load VMs", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadVms();
    // O worker roda a cada 2 min (VM_CRON_EXPRESSION); 30s é folgado para a tela
    // acompanhar sem martelar a API.
    const interval = setInterval(loadVms, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadVms();
  };

  const handleToggle = async (vm: Vm, enabled: boolean) => {
    setTogglingId(vm.id);
    // Otimista: o switch responde na hora e o estado real chega no reload.
    setVms((prev) => prev.map((v) => (v.id === vm.id ? { ...v, enabled } : v)));

    try {
      await vmsService.setEnabled(vm.id, enabled);
      toast.success(
        enabled
          ? `Monitoramento de ${vm.hostname} ligado`
          : `Monitoramento de ${vm.hostname} desligado`,
      );
      loadVms();
    } catch (error: any) {
      setVms((prev) => prev.map((v) => (v.id === vm.id ? { ...v, enabled: !enabled } : v)));
      toast.error(error.response?.data?.message || "Não foi possível alterar o monitoramento");
    } finally {
      setTogglingId(null);
    }
  };

  const filteredVms = vms.filter((vm) => {
    const term = searchTerm.toLowerCase();
    return (
      vm.hostname.toLowerCase().includes(term) ||
      (vm.name?.toLowerCase().includes(term) ?? false) ||
      (vm.ip?.toLowerCase().includes(term) ?? false)
    );
  });

  const summaryCards = [
    { label: "Máquinas", value: summary?.total ?? 0, icon: Server, color: "text-primary" },
    { label: "OK", value: summary?.healthy ?? 0, icon: CheckCircle2, color: "text-green-500" },
    { label: "Atenção", value: summary?.warning ?? 0, icon: AlertTriangle, color: "text-amber-500" },
    { label: "Críticas", value: summary?.down ?? 0, icon: XCircle, color: "text-destructive" },
    {
      label: "Alertas abertos",
      value: summary?.openAlerts ?? 0,
      icon: Activity,
      color: "text-purple-400",
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-glow">Saúde das VMs</h1>
          <p className="text-muted-foreground">
            Estado das máquinas, heartbeat dos agentes e projeção de disco.
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por hostname ou IP..."
              className="pl-9 bg-background/50 border-border/50 focus:border-primary/50"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_15px_-3px_var(--color-primary)]"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {summaryCards.map((card) => (
          <Card key={card.label} className="cyber-card">
            <CardContent className="flex items-center gap-3 py-4">
              <card.icon className={`h-5 w-5 ${card.color}`} />
              <div>
                <div className="text-2xl font-bold leading-none">{card.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{card.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">Carregando máquinas...</span>
        </div>
      )}

      {/* Vazio */}
      {!loading && filteredVms.length === 0 && (
        <Card className="cyber-card">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Server className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {searchTerm
                ? "Nenhuma máquina encontrada para esta busca."
                : "Nenhuma máquina cadastrada em monitoring.vms."}
            </p>
            {!searchTerm && (
              <p className="text-xs text-muted-foreground mt-2 font-mono">
                O cadastro é feito por SQL — veja docs/vm-monitoring.md no worker.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabela */}
      {!loading && filteredVms.length > 0 && (
        <Card className="cyber-card">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="w-[220px]">Máquina</TableHead>
                  <TableHead className="w-[130px]">Saúde</TableHead>
                  <TableHead className="w-[120px]">Estado</TableHead>
                  <TableHead className="w-[130px]">Heartbeat</TableHead>
                  <TableHead>Disco (pior mount)</TableHead>
                  <TableHead className="w-[110px]">Alertas</TableHead>
                  <TableHead className="w-[90px] text-right">Monitorar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVms.map((vm) => {
                  const HealthIcon = healthIcons[vm.health];
                  const disk = vm.worstDisk;

                  return (
                    <TableRow
                      key={vm.id}
                      className="border-border/50 cursor-pointer hover:bg-primary/5"
                      onClick={() => setLocation(`/vms/${vm.id}`)}
                    >
                      <TableCell>
                        <div className="font-medium">{vm.hostname}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {vm.ip || "sem IP"}
                          {vm.providerId ? ` · id ${vm.providerId}` : ""}
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`gap-1 text-[10px] h-6 ${healthColors[vm.health]}`}
                        >
                          <HealthIcon className="h-3 w-3" />
                          {healthLabels[vm.health]}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-sm">
                        {vm.status ? (
                          statusLabels[vm.status] || vm.status
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {vm.statusSource && (
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {vm.statusSource}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-sm">
                        {vm.lastHeartbeatAt ? (
                          <span className={vm.heartbeatStale ? "text-amber-500" : ""}>
                            {formatAge(vm.heartbeatAgeMinutes)}
                          </span>
                        ) : (
                          // Sem agente instalado não é atraso de heartbeat: é ausência
                          // de agente, e o worker não alerta nesse caso.
                          <span className="text-muted-foreground text-xs">sem agente</span>
                        )}
                      </TableCell>

                      <TableCell>
                        {disk ? (
                          <div className="space-y-1 max-w-[220px]">
                            <div className="flex justify-between text-xs">
                              <span className="font-mono text-muted-foreground">{disk.mount}</span>
                              <span className={diskColor(disk.usedPercent)}>
                                {disk.usedPercent.toFixed(1)}%
                              </span>
                            </div>
                            <Progress value={disk.usedPercent} className="h-1.5" />
                            <div className="text-[10px] text-muted-foreground">
                              {formatGb(disk.usedGb)} de {formatGb(disk.totalGb)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">sem amostra</span>
                        )}
                      </TableCell>

                      <TableCell>
                        {vm.openAlerts.length > 0 ? (
                          <Badge
                            variant="outline"
                            className={
                              vm.openAlerts.some((a) => a.severity === "critical")
                                ? healthColors.down
                                : healthColors.warning
                            }
                          >
                            {vm.openAlerts.length}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>

                      {/* stopPropagation: o clique na linha navega para o detalhe. */}
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={vm.enabled}
                          disabled={togglingId === vm.id}
                          onCheckedChange={(checked) => handleToggle(vm, checked)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!loading && filteredVms.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <HardDrive className="h-3 w-3" />
          A projeção de enchimento aparece no detalhe de cada máquina — na lista, o risco de disco
          vem dos alertas já abertos pelo worker.
        </p>
      )}
    </div>
  );
}
