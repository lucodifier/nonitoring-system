import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  HardDrive,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  TrendingUp,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { toast } from "sonner";
import {
  vmsService,
  VmDetails as VmDetailsType,
  VmDiskSeries,
  VmStatusHistoryEntry,
  VmHealth,
  healthColors,
  healthLabels,
  statusLabels,
  diskColor,
  formatAge,
  formatRelative,
  formatGb,
} from "@/services/vmsService";

const healthIcons: Record<VmHealth, typeof Server> = {
  healthy: CheckCircle2,
  warning: AlertTriangle,
  down: XCircle,
  unknown: HelpCircle,
};

/** Paleta das linhas do gráfico — mesma família de cores do resto do dashboard. */
const MOUNT_COLORS = ["#00f3ff", "#a855f7", "#f59e0b", "#22c55e", "#ef4444", "#38bdf8"];

export default function VmDetails() {
  const [, params] = useRoute("/vms/:id");
  const [, setLocation] = useLocation();
  const [vm, setVm] = useState<VmDetailsType | null>(null);
  const [diskSeries, setDiskSeries] = useState<VmDiskSeries[]>([]);
  const [history, setHistory] = useState<VmStatusHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const vmId = params?.id;

  const loadData = async () => {
    if (!vmId) return;
    try {
      const [vmData, disks, hist] = await Promise.all([
        vmsService.getById(vmId),
        vmsService.getDiskHistory(vmId, 7),
        vmsService.getHistory(vmId, 24),
      ]);
      setVm(vmData);
      setDiskSeries(disks);
      setHistory(hist);
    } catch (error) {
      console.error("Failed to load VM", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!vmId) return;
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [vmId]);

  const handleToggle = async (enabled: boolean) => {
    if (!vm) return;
    try {
      await vmsService.setEnabled(vm.id, enabled);
      setVm({ ...vm, enabled });
      toast.success(enabled ? "Monitoramento ligado" : "Monitoramento desligado");
      loadData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Não foi possível alterar o monitoramento");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Carregando máquina...</span>
      </div>
    );
  }

  if (!vm) {
    return (
      <Card className="cyber-card">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <XCircle className="h-12 w-12 text-destructive mb-4" />
          <p className="text-muted-foreground">Máquina não encontrada.</p>
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/vms")}>
            Voltar
          </Button>
        </CardContent>
      </Card>
    );
  }

  const HealthIcon = healthIcons[vm.health];
  const openAlerts = vm.alerts.filter((a) => a.resolvedAt === null);

  /**
   * Recharts precisa de uma linha por instante com uma coluna por mount. As
   * amostras de mounts diferentes chegam no mesmo ciclo do agente, mas não no
   * mesmo milissegundo — por isso o agrupamento é por minuto.
   */
  const chartData = (() => {
    const byTime = new Map<string, Record<string, number | string>>();

    for (const series of diskSeries) {
      for (const sample of series.samples) {
        const date = new Date(sample.collectedAt);
        const key = `${date.toISOString().slice(0, 16)}`;
        const row = byTime.get(key) ?? {
          time: date.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        row[series.mount] = Number(sample.usedPercent.toFixed(2));
        byTime.set(key, row);
      }
    }

    return Array.from(byTime.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, row]) => row);
  })();

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/vms")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-glow">{vm.hostname}</h1>
              <Badge variant="outline" className={`gap-1 ${healthColors[vm.health]}`}>
                <HealthIcon className="h-3 w-3" />
                {healthLabels[vm.health]}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {vm.name || "sem descrição"} · {vm.ip || "sem IP"}
              {vm.providerId ? ` · id ${vm.providerId} no hypervisor` : " · sem provider_id"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Monitorar</span>
            <Switch checked={vm.enabled} onCheckedChange={handleToggle} />
          </div>
          <Button
            onClick={() => {
              setRefreshing(true);
              loadData();
            }}
            disabled={refreshing}
            variant="outline"
            className="border-border/50"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Estado geral */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="cyber-card">
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground mb-1">Estado</div>
            <div className="text-lg font-medium">
              {vm.status ? statusLabels[vm.status] || vm.status : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-1">
              {vm.statusSource ? `via ${vm.statusSource}` : "sem leitura"} ·{" "}
              {formatRelative(vm.statusCheckedAt)}
            </div>
          </CardContent>
        </Card>

        <Card className="cyber-card">
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground mb-1">Heartbeat</div>
            <div
              className={`text-lg font-medium ${vm.heartbeatStale ? "text-amber-500" : ""}`}
            >
              {vm.lastHeartbeatAt ? formatAge(vm.heartbeatAgeMinutes) : "sem agente"}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-1">
              {vm.lastHeartbeatAt
                ? new Date(vm.lastHeartbeatAt).toLocaleString("pt-BR")
                : "agente nunca enviou dados"}
            </div>
          </CardContent>
        </Card>

        <Card className="cyber-card">
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground mb-1">Falhas de sonda</div>
            <div
              className={`text-lg font-medium ${
                vm.consecutiveProbeFailures > 0 ? "text-amber-500" : ""
              }`}
            >
              {vm.consecutiveProbeFailures}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-1">
              consecutivas (ping/TCP)
            </div>
          </CardContent>
        </Card>

        <Card className="cyber-card">
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground mb-1">Alertas abertos</div>
            <div
              className={`text-lg font-medium ${
                openAlerts.length > 0 ? "text-destructive" : "text-green-500"
              }`}
            >
              {openAlerts.length}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-1">
              {vm.alerts.length} no histórico
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Discos com projeção */}
      <Card className="cyber-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="h-5 w-5 text-primary" />
            Discos e projeção
            <span className="text-xs font-normal text-muted-foreground ml-2">
              amarelo &gt; {vm.thresholds.warningPercent}% ou &lt; {vm.thresholds.forecastWarningDays}d
              · vermelho &gt; {vm.thresholds.criticalPercent}% ou &lt;{" "}
              {vm.thresholds.forecastCriticalHours}h
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vm.disks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Nenhuma amostra de disco. O agente desta máquina ainda não postou nada em{" "}
              <span className="font-mono">/monitor/heartbeat</span>.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {vm.disks.map((disk) => (
                <div
                  key={disk.mount}
                  className="rounded-md border border-border/50 bg-background/40 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm">{disk.mount}</span>
                    <span className={`text-lg font-bold ${diskColor(
                      disk.usedPercent,
                      vm.thresholds.warningPercent,
                      vm.thresholds.criticalPercent,
                    )}`}>
                      {disk.usedPercent.toFixed(1)}%
                    </span>
                  </div>

                  <Progress value={disk.usedPercent} className="h-2" />

                  <div className="text-xs text-muted-foreground">
                    {formatGb(disk.usedGb)} de {formatGb(disk.totalGb)}
                  </div>

                  <div className="pt-2 border-t border-border/50 space-y-1">
                    {disk.growthGbPerDay !== null ? (
                      <div className="flex items-center gap-1 text-xs">
                        <TrendingUp className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {disk.growthGbPerDay > 0
                            ? `+${disk.growthGbPerDay.toFixed(2)} GB/dia`
                            : `${disk.growthGbPerDay.toFixed(2)} GB/dia`}
                        </span>
                      </div>
                    ) : (
                      // Abaixo do mínimo de amostras a reta não é ajustada — a tela
                      // diz isso em vez de mostrar uma projeção inventada.
                      <div className="text-xs text-muted-foreground">
                        sem tendência ({disk.sampleCount} de {vm.thresholds.minSamplesForTrend}{" "}
                        amostras mínimas)
                      </div>
                    )}

                    {disk.horizon ? (
                      <div
                        className={`text-xs font-medium ${
                          disk.severity === "critical"
                            ? "text-destructive"
                            : disk.severity === "warning"
                              ? "text-amber-500"
                              : "text-muted-foreground"
                        }`}
                      >
                        enche em {disk.horizon}
                      </div>
                    ) : (
                      disk.growthGbPerDay !== null && (
                        <div className="text-xs text-green-500">estável, sem projeção</div>
                      )
                    )}

                    {disk.severity && (
                      <div className="text-[10px] text-muted-foreground">{disk.reason}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico */}
        <Card className="cyber-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-5 w-5 text-primary" />
              Uso de disco (7 dias)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Sem amostras na janela.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="time" stroke="#666" fontSize={11} minTickGap={40} />
                    <YAxis stroke="#666" fontSize={11} domain={[0, 100]} unit="%" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#000", border: "1px solid #333" }}
                      itemStyle={{ color: "#fff" }}
                      formatter={(value: number) => `${value}%`}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {diskSeries.map((series, index) => (
                      <Line
                        key={series.mount}
                        type="monotone"
                        dataKey={series.mount}
                        stroke={MOUNT_COLORS[index % MOUNT_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Alertas */}
        <Card className="cyber-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-primary" />
              Alertas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px] pr-3">
              {vm.alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum alerta registrado.</p>
              ) : (
                <div className="space-y-3">
                  {vm.alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`rounded-md border p-3 text-xs ${
                        alert.resolvedAt
                          ? "border-border/50 bg-background/30 opacity-60"
                          : alert.severity === "critical"
                            ? "border-destructive/30 bg-destructive/5"
                            : "border-amber-500/30 bg-amber-500/5"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant="outline" className="text-[10px] h-5 font-mono">
                          {alert.type}
                        </Badge>
                        {alert.resolvedAt ? (
                          <span className="text-green-500 text-[10px]">resolvido</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            {formatRelative(alert.createdAt)}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{alert.message}</p>
                      {alert.scope && (
                        <div className="text-[10px] text-muted-foreground font-mono mt-1">
                          {alert.scope}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Timeline de estado */}
      <Card className="cyber-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-5 w-5 text-primary" />
            Histórico de estado (24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem leituras nas últimas 24 horas.</p>
          ) : (
            <ScrollArea className="h-[200px]">
              <div className="space-y-1">
                {[...history].reverse().map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 text-xs py-1 border-b border-border/30 last:border-0"
                  >
                    <span className="font-mono text-muted-foreground w-[140px] shrink-0">
                      {new Date(entry.checkedAt).toLocaleString("pt-BR")}
                    </span>
                    <span
                      className={
                        entry.status === "running"
                          ? "text-green-500"
                          : entry.status === "paused"
                            ? "text-amber-500"
                            : entry.status === "unknown"
                              ? "text-muted-foreground"
                              : "text-destructive"
                      }
                    >
                      {statusLabels[entry.status] || entry.status}
                    </span>
                    {entry.source && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {entry.source}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
