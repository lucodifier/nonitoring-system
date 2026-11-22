import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * VM cadastrada para monitoramento.
 *
 * `providerId` é o identificador da VM no hypervisor/cloud (VMID no Proxmox, nome do
 * domínio no libvirt, moref no vSphere). Fica separado de `hostname` porque o worker
 * casa heartbeat por hostname e estado do hypervisor por providerId -- são chaves
 * diferentes, vindas de fontes diferentes, e nem toda VM tem as duas.
 */
@Entity('vms', { schema: 'monitoring' })
export class Vm {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 255, unique: true })
  hostname: string;

  @Column({ length: 45, nullable: true })
  ip: string;

  @Column({ name: 'provider_id', length: 255, nullable: true })
  providerId: string;

  @Column({ length: 255, nullable: true })
  name: string;

  @Column({ default: true })
  enabled: boolean;

  /** Último heartbeat recebido em POST /monitor/heartbeat. Null = nunca enviou. */
  @Column({ name: 'last_heartbeat_at', type: 'timestamp', nullable: true })
  lastHeartbeatAt: Date;

  /**
   * Falhas consecutivas de ping/TCP. Persistido (e não em memória) para que o
   * contador sobreviva ao restart do container -- senão todo deploy zeraria a
   * contagem e o alerta de "VM inacessível" nunca chegaria aos 3 ciclos.
   */
  @Column({ name: 'consecutive_probe_failures', type: 'int', default: 0 })
  consecutiveProbeFailures: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
