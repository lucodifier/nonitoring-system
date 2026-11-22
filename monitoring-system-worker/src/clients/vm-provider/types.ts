/** Estado normalizado de uma VM, independente do hypervisor de origem. */
export interface VmState {
  /** ID da VM no hypervisor (VMID no Proxmox, nome do domínio no libvirt). */
  providerId: string;
  /** Nome legível da VM, quando o provider expõe. */
  name?: string;
  status: 'running' | 'stopped' | 'paused' | 'unknown';
  /** Linha/objeto cru da origem, guardado no metadata do alerta para diagnóstico. */
  raw?: string;
}

export interface VmProvider {
  /** Identificador curto, gravado em vm_status_history.source. */
  readonly name: string;
  listVms(): Promise<VmState[]>;
}

/**
 * Normaliza os vocabulários dos hypervisors para o nosso.
 *
 * Proxmox: running | stopped | paused | suspended
 * libvirt: running | idle | paused | pmsuspended | shut off | crashed | shutdown
 * vSphere: poweredOn | poweredOff | suspended
 *
 * Só "running" (e o "idle" do libvirt, que é uma VM viva sem carga) conta como OK.
 * Tudo que não reconhecemos vira 'unknown' e NÃO alerta -- mesma regra do Docker no
 * worker de serviços: não marcar problema em cima de leitura que não entendemos.
 */
export function normalizeStatus(raw: string): VmState['status'] {
  const s = (raw || '').trim().toLowerCase();

  if (s === 'running' || s === 'idle' || s === 'poweredon' || s === 'up' || s === 'active') {
    return 'running';
  }
  if (s === 'paused' || s === 'suspended' || s === 'pmsuspended' || s === 'blocked') {
    return 'paused';
  }
  if (
    s === 'stopped' ||
    s === 'shut off' ||
    s === 'shutoff' ||
    s === 'shutdown' ||
    // `virsh list` reporta "in shutdown" durante o desligamento. Sem isto viraria
    // 'unknown' e cairia na sonda de rede -- que ainda responde enquanto a VM
    // desliga, registrando como ativa uma VM que esta indo embora.
    s === 'in shutdown' ||
    s === 'poweredoff' ||
    s === 'crashed' ||
    s === 'dying' ||
    s === 'down'
  ) {
    return 'stopped';
  }
  return 'unknown';
}
