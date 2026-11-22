import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline migration: monitoring.service_alerts existe no schema (dump-20251215.sql) e na
 * entity ServiceAlert, mas sumiu do banco de produção (nunca houve migrations formais até
 * agora - o schema era mantido via dump/SQL manual). Usa IF NOT EXISTS porque este é o
 * primeiro run do TypeORM migrations neste banco e as demais tabelas já existem.
 */
export class CreateServiceAlerts1785366615791 implements MigrationInterface {
  name = 'CreateServiceAlerts1785366615791';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE SEQUENCE IF NOT EXISTS monitoring.service_alerts_id_seq
        START WITH 1
        INCREMENT BY 1
        NO MINVALUE
        NO MAXVALUE
        CACHE 1
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS monitoring.service_alerts (
        id bigint NOT NULL DEFAULT nextval('monitoring.service_alerts_id_seq'::regclass),
        service_id character varying(100) NOT NULL,
        alert_type character varying(50) NOT NULL,
        severity character varying(50) NOT NULL,
        title character varying(255) NOT NULL,
        message text NOT NULL,
        threshold_value double precision,
        current_value double precision,
        resolved boolean DEFAULT false,
        notified boolean DEFAULT false,
        notification_channels jsonb,
        acknowledged boolean DEFAULT false,
        acknowledged_by character varying(100),
        acknowledged_at timestamp without time zone,
        created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
        resolved_at timestamp without time zone,
        resolved_by character varying(100),
        metadata jsonb,
        CONSTRAINT service_alerts_pkey PRIMARY KEY (id)
      )
    `);

    await queryRunner.query(`
      ALTER SEQUENCE monitoring.service_alerts_id_seq OWNED BY monitoring.service_alerts.id
    `);

    await queryRunner.query(`
      COMMENT ON TABLE monitoring.service_alerts IS 'Alertas gerados automaticamente pelo sistema de monitoramento'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN monitoring.service_alerts.alert_type IS 'Tipo do alerta: down, restart, error, degraded, high_cpu, high_memory'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN monitoring.service_alerts.severity IS 'Severidade: critical, warning, info'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN monitoring.service_alerts.acknowledged IS 'Indica se o alerta foi reconhecido por um operador'
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON monitoring.service_alerts USING btree (created_at DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_alerts_metadata ON monitoring.service_alerts USING gin (metadata)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_alerts_notification_channels ON monitoring.service_alerts USING gin (notification_channels)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_alerts_notified ON monitoring.service_alerts USING btree (notified)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_alerts_pending_notification ON monitoring.service_alerts USING btree (created_at) WHERE ((notified = false) AND (resolved = false))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_alerts_service_time ON monitoring.service_alerts USING btree (service_id, created_at DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_alerts_type ON monitoring.service_alerts USING btree (alert_type)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON monitoring.service_alerts USING btree (service_id, severity, created_at DESC) WHERE (resolved = false)`);

    const fkExists = await queryRunner.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'service_alerts_service_id_fkey'`,
    );
    if (fkExists.length === 0) {
      await queryRunner.query(`
        ALTER TABLE monitoring.service_alerts
          ADD CONSTRAINT service_alerts_service_id_fkey
          FOREIGN KEY (service_id) REFERENCES monitoring.services(id) ON DELETE CASCADE
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS monitoring.service_alerts`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS monitoring.service_alerts_id_seq`);
  }
}
