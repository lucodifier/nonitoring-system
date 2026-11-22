## Docker (como funciona + como validar serviços rodando)

### De onde vem a lista de serviços monitorados?

O worker busca os serviços em `monitoring.services` (somente `is_active=true`).

Campos principais:
- `container_id`: nome ou ID do container Docker a checar (opcional)
- `prometheus_job`: job no Prometheus (opcional)
- `loki_label`: label para filtrar logs no Loki (opcional)
- `docker_host`, `docker_port`, `docker_socket_path`: override de conexão Docker por serviço (opcional)

Para validar “quais serviços o worker está monitorando”, rode no Postgres:

```sql
SELECT
  id, name, is_active,
  container_id, prometheus_job, loki_label,
  docker_host, docker_port, docker_socket_path
FROM monitoring.services
WHERE is_active = true
ORDER BY id;
```

### Como o worker valida Docker (lógica)

Se `container_id` estiver preenchido:
- O worker tenta checar o container via Docker (e, se estiver `running`, coleta CPU/mem via Docker).
- Ele só marca **DOWN** quando consegue confirmar que o container está parado/não encontrado.
- Se houver **erro de conexão** com o Docker (status `unknown`), ele **não** marca DOWN (evita falso-positivo).

### Como o worker conecta no Docker (prioridade)

1) Se existir `DOCKER_SSH_HOST` e `DOCKER_SSH_USERNAME` no `.env`, o worker usa **SSH** e executa comandos `docker ...` no host remoto.
2) Senão, se o serviço tiver `docker_host`/`docker_socket_path`, usa essa configuração por serviço.
3) Senão, usa configuração global do `.env`:
   - `DOCKER_SOCKET_PATH` (socket local), ou
   - `DOCKER_HOST` + `DOCKER_PORT` (Docker remoto TCP).
4) Senão, tenta Docker local padrão.

Variáveis relevantes (quando for SSH):
- `DOCKER_SSH_HOST`
- `DOCKER_SSH_PORT` (default 22)
- `DOCKER_SSH_USERNAME`
- `DOCKER_SSH_PASSWORD` (opcional)
- `DOCKER_SSH_PRIVATE_KEY` (opcional)

### Como validar “quais containers estão rodando” (na prática)

#### 1) Validar o container do worker (neste repo)

```bash
docker compose up -d
docker compose ps
docker logs -f monitoring-system-worker
```

#### 2) Validar os containers monitorados (no host Docker alvo)
Primeiro descubra quais `container_id` estão cadastrados/ativos no banco (query acima).

Depois, no host onde os containers rodam:

- Listar containers rodando:

```bash
docker ps
```

- Checar um container específico (use o `container_id` do banco):

```bash
docker inspect -f '{{.Name}} {{.State.Status}} {{.State.StartedAt}}' <container_id_ou_nome>
docker stats <container_id_ou_nome> --no-stream
```

#### 3) Se o worker estiver usando SSH
Conecte no host remoto e rode os mesmos comandos:

```bash
ssh <user>@<DOCKER_SSH_HOST>
docker ps
docker ps -a | grep <container_id_ou_nome>
docker logs --tail 200 <container_id_ou_nome>
```

### Dica: validar pelo log do próprio worker
Nos logs, o worker imprime:
- quantos serviços ativos encontrou,
- qual `container_id` está checando,
- e o status resultante (running/stopped/exited/unknown).

Exemplo:

```bash
docker logs monitoring-system-worker --tail 200
```

### Observações importantes sobre CPU (%)
- O percentual de CPU pode **passar de 100%** (ex.: 208%) quando o processo/container está usando mais de 1 núcleo (multi-core).
- Um alerta “High CPU” é um **snapshot** naquele ciclo; o card do dashboard mostra a **última leitura**. Se o pico passou rápido, o alerta pode ficar alto e o card já estar baixo.

## Agendamento (correção do diagrama)
- O worker executa imediatamente ao iniciar e depois conforme `CRON_EXPRESSION` (default: `*/15 * * * *`).
- As consultas do Loki usam `MONITORING_INTERVAL_MINUTES` (default: 15 minutos).