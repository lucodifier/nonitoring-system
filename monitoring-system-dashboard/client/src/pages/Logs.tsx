import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { servicesService, Service } from '@/services/servicesService';
import { serviceErrorsService, ServiceErrorEntry, dozzleUrlFor, runtimeIdOf } from '@/services/logsService';
import { Loader2, Terminal, ExternalLink, AlertCircle } from 'lucide-react';

/**
 * Tela de logs.
 *
 * A versao anterior era um navegador de logs completo (filtro por periodo, busca,
 * niveis) que consultava o Loki. A ingestao no Loki esta fora do ar, entao ela
 * retornava "nenhum log" para qualquer servico e qualquer periodo -- sem dizer que
 * a fonte estava indisponivel, o que ensinava o time a nao confiar no dashboard.
 *
 * Enquanto o Loki nao volta, esta tela mostra os erros que o worker grava em
 * monitoring.service_errors (lidos do stdout do container, sem depender de coletor
 * externo) e manda para o Dozzle quem precisa ver o log completo ao vivo.
 */
export default function Logs() {
  const searchParams = new URLSearchParams(window.location.search);
  const initialService = searchParams.get('service') || '';

  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState(initialService);
  const [errors, setErrors] = useState<ServiceErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    servicesService
      .getAll(true)
      .then((data) => {
        setServices(data);
        if (!initialService && data.length > 0) setSelectedServiceId(data[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedServiceId) return;
    setLoading(true);
    serviceErrorsService
      .getByService(selectedServiceId, 100)
      .then(setErrors)
      .catch(() => setErrors([]))
      .finally(() => setLoading(false));
  }, [selectedServiceId]);

  const selected = services.find((s) => s.id === selectedServiceId);
  const visible = filter
    ? errors.filter((e) => e.errorMessage.toLowerCase().includes(filter.toLowerCase()))
    : errors;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Terminal className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-mono">Logs</h1>
      </div>

      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <CardContent className="flex gap-3 p-4 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 text-yellow-500" />
          <div className="space-y-1">
            <p>
              A busca historica de logs depende do Loki, que esta indisponivel. Esta tela mostra
              os <strong>erros detectados pelo worker</strong> (lidos do stdout do container).
            </p>
            <p className="text-muted-foreground">
              Para acompanhar o log completo e ao vivo, use o Dozzle.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {services.map((s) => (
          <Button
            key={s.id}
            variant={s.id === selectedServiceId ? 'default' : 'outline'}
            size="sm"
            className="font-mono text-xs"
            onClick={() => setSelectedServiceId(s.id)}
          >
            {s.name}
          </Button>
        ))}
      </div>

      <Card className="bg-black/80 border-primary/20">
        <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-white/10 bg-white/5">
          <CardTitle className="text-sm font-mono">
            {selected ? `Erros — ${selected.name}` : 'Selecione um servico'}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Filtrar mensagem..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 w-56 text-xs"
            />
            {selected && (
              <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                <a
                  href={dozzleUrlFor(runtimeIdOf(selected))}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  Dozzle
                </a>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[520px] w-full p-4 font-mono text-xs">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : visible.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                Nenhum erro registrado para este servico.
              </div>
            ) : (
              <div className="space-y-2">
                {visible.map((e) => (
                  <div key={e.id} className="flex gap-3 border-b border-white/5 pb-2 last:border-0">
                    <span className="w-40 shrink-0 text-gray-500">
                      {new Date(e.occurredAt).toLocaleString()}
                    </span>
                    <Badge
                      variant="outline"
                      className={`h-5 shrink-0 ${
                        e.isResolved ? 'border-green-500/40 text-green-500' : 'border-red-500/40 text-red-500'
                      }`}
                    >
                      {e.isResolved ? 'resolvido' : e.errorLevel || 'error'}
                    </Badge>
                    <span className="break-all text-gray-300">{e.errorMessage}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
