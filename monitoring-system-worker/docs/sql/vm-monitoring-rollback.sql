-- =====================================================================
-- Rollback do monitoramento de VMs
-- =====================================================================
-- Equivale ao `down()` da migration CreateVmMonitoring / `npm run migration:revert`.
--
-- ATENÇÃO: apaga os dados históricos (estado das VMs, série de disco e
-- alertas). As tabelas de serviço (services, service_alerts, ...) não são
-- tocadas.
--
--     psql -h <host> -U <user> -d monitoring_system -f vm-monitoring-rollback.sql
-- =====================================================================

BEGIN;

-- Ordem inversa da criação: as filhas primeiro, por causa das FKs.
DROP TABLE IF EXISTS monitoring.vm_alerts;
DROP TABLE IF EXISTS monitoring.disk_snapshots;
DROP TABLE IF EXISTS monitoring.vm_status_history;
DROP TABLE IF EXISTS monitoring.vms;

-- Tira o registro da migration, para o TypeORM voltar a considerá-la pendente.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'monitoring' AND table_name = 'migrations'
  ) THEN
    EXECUTE 'DELETE FROM monitoring.migrations WHERE name = $1'
      USING 'CreateVmMonitoring1789603200000';
  END IF;
END
$$;

COMMIT;
