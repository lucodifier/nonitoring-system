import { VmProvider, VmState } from './types';

/**
 * Sem acesso ao hypervisor. Não é erro: o ciclo continua com ping/TCP e heartbeat,
 * que é exatamente o cenário "não tenho acesso às VMs, no máximo ping".
 */
export class NoneProvider implements VmProvider {
  readonly name = 'none';

  async listVms(): Promise<VmState[]> {
    return [];
  }
}
