import { SSHConfig, execSSHCommandRaw } from '../docker-ssh';
import { VmProvider, VmState, normalizeStatus } from './types';
import { log } from '../../logger';

/**
 * KVM/libvirt via `virsh`, na mesma sessão SSH usada para Docker.
 *
 * Usa `virsh list --all` (tabela) em vez de um `virsh domstate` por domínio:
 * uma conexão SSH por ciclo, e não uma por VM.
 */
export class LibvirtSshProvider implements VmProvider {
  readonly name = 'libvirt-ssh';

  constructor(private readonly ssh: SSHConfig) {}

  async listVms(): Promise<VmState[]> {
    try {
      // Saída: " Id   Name   State" + separador "-----" + linhas
      const out = await execSSHCommandRaw(this.ssh, 'virsh list --all');
      const lines = (out || '').trim().split('\n');
      const result: VmState[] = [];
      let pastHeader = false;

      for (const line of lines) {
        if (/^-{3,}/.test(line.trim())) {
          pastHeader = true;
          continue;
        }
        if (!pastHeader) continue;

        const parts = line.trim().split(/\s+/);
        // "- nome shut off" => id, nome, e o estado pode ter espaço ("shut off")
        if (parts.length < 3) continue;

        const name = parts[1];
        const state = parts.slice(2).join(' ');

        result.push({
          providerId: name,
          name,
          status: normalizeStatus(state),
          raw: line.trim(),
        });
      }

      return result;
    } catch (err: any) {
      log.error(`[VM] libvirt-ssh: falha em "virsh list --all": ${err.message}`);
      return [];
    }
  }
}
