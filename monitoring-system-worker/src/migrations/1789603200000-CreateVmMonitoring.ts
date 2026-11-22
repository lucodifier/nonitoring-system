import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Monitoramento preditivo de VMs.
 *
 * Cria as quatro tabelas do fluxo: cadastro (vms), série de estado (vm_status_history),
 * série de disco que alimenta a projeção (disk_snapshots) e os alertas (vm_alerts).
 *
 * Usa IF NOT EXISTS pelo mesmo motivo da baseline de service_alerts: o schema
 * `monitoring` deste banco nasceu de dump/SQL manual, então a migration precisa ser
 * idempotente contra um banco que talvez já tenha parte disso.
 */
export class CreateVmMonitoring1789603200000 implements MigrationInterface {
  name = 'CreateVmMonitoring1789603200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS monitoring`);

    // ---------------------------------------------------------------- vms
    await queryRunner.query(`
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
      )
    `);

    await queryRunner.query(
      `COMMENT ON TABLE monitoring.vms IS 'VMs monitoradas: estado via hypervisor, ping/TCP e heartbeat do agente'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN monitoring.vms.provider_id IS 'ID da VM no hypervisor/cloud (VMID do Proxmox, nome do domínio no libvirt, moref no vSphere)'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN monitoring.vms.consecutive_probe_failures IS 'Falhas seguidas de ping/TCP; persistido para o contador sobreviver a restart do worker'`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_vms_enabled ON monitoring.vms USING btree (enabled) WHERE (enabled = true)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_vms_provider_id ON monitoring.vms USING btree (provider_id)`,
    );

    // ------------------------------------------------- vm_status_history
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS monitoring.vm_status_history (
        id bigserial NOT NULL,
        vm_id bigint NOT NULL,
        status character varying(50) NOT NULL,
        source character varying(50),
        checked_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT vm_status_history_pkey PRIMARY KEY (id)
      )
    `);

    await queryRunner.query(
      `COMMENT ON COLUMN monitoring.vm_status_history.status IS 'running, stopped, paused, unreachable, unknown'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_vm_status_history_vm_time ON monitoring.vm_status_history USING btree (vm_id, checked_at DESC)`,
    );

    // ---------------------------------------------------- disk_snapshots
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS monitoring.disk_snapshots (
        id bigserial NOT NULL,
        vm_id bigint NOT NULL,
        mount character varying(255) NOT NULL,
        total_gb double precision NOT NULL,
        used_gb double precision NOT NULL,
        collected_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT disk_snapshots_pkey PRIMARY KEY (id)
      )
    `);

    await queryRunner.query(
      `COMMENT ON TABLE monitoring.disk_snapshots IS 'Série de uso de disco enviada pelo agente na VM; base da regressão linear da projeção'`,
    );
    // Índice na ordem (vm_id, mount, collected_at DESC): é exatamente a leitura da
    // projeção -- últimos N dias de um mount de uma VM.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_disk_snapshots_vm_mount_time ON monitoring.disk_snapshots USING btree (vm_id, mount, collected_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_disk_snapshots_collected_at ON monitoring.disk_snapshots USING btree (collected_at)`,
    );

    // --------------------------------------------------------- vm_alerts
    await queryRunner.query(`
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
      )
    `);

    await queryRunner.query(
      `COMMENT ON COLUMN monitoring.vm_alerts.type IS 'down, paused, disk_warning, disk_critical, no_heartbeat'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN monitoring.vm_alerts.scope IS 'Chave secundária do alerta (o mount, nos alertas de disco)'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN monitoring.vm_alerts.resolved_at IS 'Nulo = alerta aberto; preenchido ao normalizar, junto da mensagem de resolução'`,
    );

    // Índice parcial dos alertas abertos: é a consulta do anti-spam, a cada ciclo.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_vm_alerts_open ON monitoring.vm_alerts USING btree (vm_id, type, scope, created_at DESC) WHERE (resolved_at IS NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_vm_alerts_created_at ON monitoring.vm_alerts USING btree (created_at DESC)`,
    );

    // ---------------------------------------------------------------- FKs
    await this.addFkIfMissing(
      queryRunner,
      'vm_status_history_vm_id_fkey',
      `ALTER TABLE monitoring.vm_status_history
         ADD CONSTRAINT vm_status_history_vm_id_fkey
         FOREIGN KEY (vm_id) REFERENCES monitoring.vms(id) ON DELETE CASCADE`,
    );
    await this.addFkIfMissing(
      queryRunner,
      'disk_snapshots_vm_id_fkey',
      `ALTER TABLE monitoring.disk_snapshots
         ADD CONSTRAINT disk_snapshots_vm_id_fkey
         FOREIGN KEY (vm_id) REFERENCES monitoring.vms(id) ON DELETE CASCADE`,
    );
    await this.addFkIfMissing(
      queryRunner,
      'vm_alerts_vm_id_fkey',
      `ALTER TABLE monitoring.vm_alerts
         ADD CONSTRAINT vm_alerts_vm_id_fkey
         FOREIGN KEY (vm_id) REFERENCES monitoring.vms(id) ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS monitoring.vm_alerts`);
    await queryRunner.query(`DROP TABLE IF EXISTS monitoring.disk_snapshots`);
    await queryRunner.query(`DROP TABLE IF EXISTS monitoring.vm_status_history`);
    await queryRunner.query(`DROP TABLE IF EXISTS monitoring.vms`);
  }

  /**
   * `conname` e' unico por schema, nao no banco inteiro. Sem filtrar o namespace,
   * uma constraint homonima em OUTRO schema faria esta checagem achar que a FK ja
   * existe -- e a tabela em `monitoring` ficaria sem integridade referencial, em
   * silencio.
   */
  private async addFkIfMissing(queryRunner: QueryRunner, name: string, sql: string): Promise<void> {
    const exists = await queryRunner.query(
      `SELECT 1
         FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = $1 AND n.nspname = 'monitoring'`,
      [name],
    );
    if (exists.length === 0) {
      await queryRunner.query(sql);
    }
  }
}
