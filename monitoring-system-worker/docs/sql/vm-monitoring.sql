-- =====================================================================
-- Monitoramento preditivo de VMs — criação manual do schema
-- =====================================================================
--
-- Alternativa a `npm run migration:run`, para quem prefere aplicar o SQL
-- direto no banco (como o schema `monitoring` sempre foi mantido aqui).
--
-- Produz EXATAMENTE o mesmo resultado da migration
-- src/migrations/1789603200000-CreateVmMonitoring.ts — tabelas, colunas,
-- índices, comentários e FKs.
--
-- Como aplicar:
--     psql -h <host> -U <user> -d monitoring_system -f vm-monitoring.sql
--
-- É idempotente: pode rodar mais de uma vez sem erro (tudo com IF NOT EXISTS
-- e a FK protegida por checagem em pg_constraint).
--
-- Rollback: veja docs/sql/vm-monitoring-rollback.sql
-- =====================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS monitoring;

-- ---------------------------------------------------------------- vms
CREATE TABLE IF NOT EXISTS monitoring.vms (
  id bigserial NOT NULL,
  hostname character varying(255) NOT NULL,
  ip character varying(45),
  provider_id character varying(255),
  name character varying(255),
  enabled boolean NOT NULL DEFAULT true,
  last_heartbeat_at timestamp without time zone,
  consecutive_probe_failures integer NOT NULL DEFAULT 0,
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vms_pkey PRIMARY KEY (id),
  CONSTRAINT vms_hostname_key UNIQUE (hostname)
);

COMMENT ON TABLE monitoring.vms IS 'VMs monitoradas: estado via hypervisor, ping/TCP e heartbeat do agente';
COMMENT ON COLUMN monitoring.vms.provider_id IS 'ID da VM no hypervisor/cloud (VMID do Proxmox, nome do domínio no libvirt, moref no vSphere)';
COMMENT ON COLUMN monitoring.vms.consecutive_probe_failures IS 'Falhas seguidas de ping/TCP; persistido para o contador sobreviver a restart do worker';

CREATE INDEX IF NOT EXISTS idx_vms_enabled ON monitoring.vms USING btree (enabled) WHERE (enabled = true);
CREATE INDEX IF NOT EXISTS idx_vms_provider_id ON monitoring.vms USING btree (provider_id);

-- ------------------------------------------------- vm_status_history
CREATE TABLE IF NOT EXISTS monitoring.vm_status_history (
  id bigserial NOT NULL,
  vm_id bigint NOT NULL,
  status character varying(50) NOT NULL,
  source character varying(50),
  checked_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vm_status_history_pkey PRIMARY KEY (id)
);

COMMENT ON COLUMN monitoring.vm_status_history.status IS 'running, stopped, paused, unreachable, unknown';

CREATE INDEX IF NOT EXISTS idx_vm_status_history_vm_time ON monitoring.vm_status_history USING btree (vm_id, checked_at DESC);

-- ---------------------------------------------------- disk_snapshots
CREATE TABLE IF NOT EXISTS monitoring.disk_snapshots (
  id bigserial NOT NULL,
  vm_id bigint NOT NULL,
  mount character varying(255) NOT NULL,
  total_gb double precision NOT NULL,
  used_gb double precision NOT NULL,
  collected_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT disk_snapshots_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE monitoring.disk_snapshots IS 'Série de uso de disco enviada pelo agente na VM; base da regressão linear da projeção';

-- Ordem (vm_id, mount, collected_at DESC) = exatamente a leitura da projeção:
-- últimos N dias de um mount de uma VM.
CREATE INDEX IF NOT EXISTS idx_disk_snapshots_vm_mount_time ON monitoring.disk_snapshots USING btree (vm_id, mount, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_disk_snapshots_collected_at ON monitoring.disk_snapshots USING btree (collected_at);

-- --------------------------------------------------------- vm_alerts
CREATE TABLE IF NOT EXISTS monitoring.vm_alerts (
  id bigserial NOT NULL,
  vm_id bigint NOT NULL,
  type character varying(50) NOT NULL,
  message text NOT NULL,
  severity character varying(50) NOT NULL,
  scope character varying(255),
  current_value double precision,
  metadata jsonb,
  notified_at timestamp without time zone,
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at timestamp without time zone,
  CONSTRAINT vm_alerts_pkey PRIMARY KEY (id)
);

COMMENT ON COLUMN monitoring.vm_alerts.type IS 'down, paused, disk_warning, disk_critical, no_heartbeat';
COMMENT ON COLUMN monitoring.vm_alerts.scope IS 'Chave secundária do alerta (o mount, nos alertas de disco)';
COMMENT ON COLUMN monitoring.vm_alerts.resolved_at IS 'Nulo = alerta aberto; preenchido ao normalizar, junto da mensagem de resolução';

-- Índice parcial dos alertas abertos: é a consulta do anti-spam, a cada ciclo.
CREATE INDEX IF NOT EXISTS idx_vm_alerts_open ON monitoring.vm_alerts USING btree (vm_id, type, scope, created_at DESC) WHERE (resolved_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_vm_alerts_created_at ON monitoring.vm_alerts USING btree (created_at DESC);

-- ---------------------------------------------------------------- FKs
-- O filtro por nspname importa: `conname` e unico por schema, nao no banco.
-- Sem ele, uma constraint homonima em outro schema faria o IF achar que a FK ja
-- existe, e a tabela ficaria sem integridade referencial em silencio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.conname = 'vm_status_history_vm_id_fkey' AND n.nspname = 'monitoring'
  ) THEN
    ALTER TABLE monitoring.vm_status_history
      ADD CONSTRAINT vm_status_history_vm_id_fkey
      FOREIGN KEY (vm_id) REFERENCES monitoring.vms(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.conname = 'disk_snapshots_vm_id_fkey' AND n.nspname = 'monitoring'
  ) THEN
    ALTER TABLE monitoring.disk_snapshots
      ADD CONSTRAINT disk_snapshots_vm_id_fkey
      FOREIGN KEY (vm_id) REFERENCES monitoring.vms(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.conname = 'vm_alerts_vm_id_fkey' AND n.nspname = 'monitoring'
  ) THEN
    ALTER TABLE monitoring.vm_alerts
      ADD CONSTRAINT vm_alerts_vm_id_fkey
      FOREIGN KEY (vm_id) REFERENCES monitoring.vms(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- =====================================================================
-- Registro na tabela de migrations
-- =====================================================================
-- Marca a migration como já aplicada, para que um `npm run migration:run`
-- futuro não tente criar tudo de novo.
--
-- Sem isto o comando ainda funcionaria (a migration é idempotente), mas o
-- banco ficaria "devendo" uma migration na listagem — e a próxima pessoa
-- não saberia dizer se o schema está em dia.
--
-- Só insere se a tabela `migrations` já existir: se você nunca rodou o
-- TypeORM neste banco, ela não existe ainda, e este bloco é no-op.
--
-- O IF é aninhado (e não `A AND B`) e o acesso à tabela é via EXECUTE de
-- propósito: o PL/pgSQL planeja a expressão inteira da condição antes de
-- avaliá-la, então mencionar monitoring.migrations num `AND` quebraria com
-- "relation does not exist" justamente no caso que este bloco quer tratar.
DO $$
DECLARE
  ja_registrada boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'monitoring' AND table_name = 'migrations'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM monitoring.migrations WHERE name = $1)'
      INTO ja_registrada
      USING 'CreateVmMonitoring1789603200000';

    IF NOT ja_registrada THEN
      EXECUTE 'INSERT INTO monitoring.migrations ("timestamp", name) VALUES ($1, $2)'
        USING 1789603200000::bigint, 'CreateVmMonitoring1789603200000';
    END IF;
  END IF;
END
$$;

COMMIT;

-- Conferência rápida do que foi criado:
--   \dt monitoring.*
--   \di monitoring.*
