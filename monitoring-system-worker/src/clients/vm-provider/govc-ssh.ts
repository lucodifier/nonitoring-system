import { SSHConfig, execSSHCommandRaw } from '../docker-ssh';
import { VmProvider, VmState, normalizeStatus } from './types';
import { log } from '../../logger';

/**
 * Aspas simples para uso seguro em linha de comando POSIX.
 * Fecha a aspa, escapa a aspa literal, reabre -- a forma canônica.
 */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * VMware (vCenter/ESXi) via `govc`, quando o binário está instalado no host SSH.
 * As credenciais ficam no ambiente do próprio host (GOVC_URL/GOVC_USERNAME/...),
 * então o worker não precisa carregar segredo de vSphere.
 */
export class GovcSshProvider implements VmProvider {
  readonly name = 'govc-ssh';

  constructor(private readonly ssh: SSHConfig) {}

  async listVms(): Promise<VmState[]> {
    try {
      // Duas chamadas, e não `govc vm.info $(govc ls ...)`.
      //
      // Naquele formato o shell divide a saída em espaços e quebras de linha: uma
      // VM ou pasta com espaço no nome vira dois argumentos, o comando falha, a
      // lista volta vazia e o worker para de enxergar VM parada. Aqui os caminhos
      // vêm um por linha e cada um entra aspado como um argumento só.
      const paths = (await execSSHCommandRaw(this.ssh, 'govc find -type m'))
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean);

      if (paths.length === 0) {
        log.warn('[VM] govc-ssh: `govc find -type m` não retornou nenhuma VM.');
        return [];
      }

      const args = paths.map(shellQuote).join(' ');
      const out = await execSSHCommandRaw(this.ssh, `govc vm.info -json ${args}`);

      const parsed = JSON.parse(out || '{}');
      // govc mudou a capitalização entre versões (VirtualMachines -> virtualMachines).
      const vms: any[] = parsed.virtualMachines || parsed.VirtualMachines || [];

      return vms.map((vm) => {
        const runtime = vm.runtime || vm.Runtime || {};
        const power = runtime.powerState || runtime.PowerState || '';
        const name = vm.name || vm.Name || '';
        const moref = vm.self?.value || vm.Self?.Value || name;

        return {
          providerId: String(moref),
          name,
          status: normalizeStatus(String(power)),
          raw: `${name}=${power}`,
        };
      });
    } catch (err: any) {
      log.error(`[VM] govc-ssh: falha ao listar VMs: ${err.message}`);
      return [];
    }
  }
}
