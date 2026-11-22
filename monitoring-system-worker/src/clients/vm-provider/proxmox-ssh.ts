import { SSHConfig, execSSHCommandRaw } from '../docker-ssh';
import { VmProvider, VmState, normalizeStatus } from './types';
import { log } from '../../logger';

/**
 * Proxmox VE pela CLI, via a mesma sessão SSH que o worker já usa para Docker.
 *
 * Lê QEMU (`qm list`) e containers LXC (`pct list`) -- no parque os dois aparecem
 * como "VM" para quem opera, então ignorar LXC deixaria buraco no monitoramento.
 */
export class ProxmoxSshProvider implements VmProvider {
  readonly name = 'proxmox-ssh';

  constructor(private readonly ssh: SSHConfig) {}

  async listVms(): Promise<VmState[]> {
    const vms = await this.listQemu();
    const cts = await this.listLxc();
    return [...vms, ...cts];
  }

  private async listQemu(): Promise<VmState[]> {
    try {
      // Saída: VMID NAME STATUS MEM(MB) BOOTDISK(GB) PID
      const out = await execSSHCommandRaw(this.ssh, 'qm list');
      return this.parseTable(out, 'qemu');
    } catch (err: any) {
      log.error(`[VM] proxmox-ssh: falha em "qm list": ${err.message}`);
      return [];
    }
  }

  private async listLxc(): Promise<VmState[]> {
    try {
      // `pct list` falha se o nó não tiver LXC habilitado: não é motivo para
      // derrubar a leitura das VMs QEMU, então o erro só vira log.
      const out = await execSSHCommandRaw(this.ssh, 'pct list');
      return this.parseTable(out, 'lxc');
    } catch (err: any) {
      log.debug(`[VM] proxmox-ssh: "pct list" indisponível: ${err.message}`);
      return [];
    }
  }

  private parseTable(output: string, kind: 'qemu' | 'lxc'): VmState[] {
    const lines = (output || '').trim().split('\n');
    const result: VmState[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const id = parts[0];
      // Pula o cabeçalho (VMID / VMID NAME ...) e qualquer linha sem ID numérico.
      if (!/^\d+$/.test(id)) continue;

      // qm list:  VMID NAME STATUS ...
      // pct list: VMID STATUS LOCK NAME
      const status = kind === 'qemu' ? parts[2] : parts[1];
      const name = kind === 'qemu' ? parts[1] : parts[parts.length - 1];

      result.push({
        providerId: id,
        name,
        status: normalizeStatus(status),
        raw: line.trim(),
      });
    }

    return result;
  }
}
