import { SSHConfig, execSSHCommandRaw, getDefaultSSHConfig } from '../docker-ssh';
import { vmConfig } from '../../config/vm-config';
import { log } from '../../logger';
import { VmProvider } from './types';
import { ProxmoxSshProvider } from './proxmox-ssh';
import { LibvirtSshProvider } from './libvirt-ssh';
import { GovcSshProvider } from './govc-ssh';
import { ProxmoxApiProvider } from './proxmox-api';
import { NoneProvider } from './none';

export * from './types';

export interface ProviderDetection {
  kind: string;
  reason: string;
}

/**
 * Sonda o host SSH para descobrir qual camada de gerenciamento existe.
 *
 * A ordem importa: Proxmox também tem libvirt instalado em alguns setups, e `qm`
 * dá a resposta mais rica (QEMU + LXC), então ele vem primeiro.
 *
 * Roda um único comando shell -- uma conexão SSH em vez de quatro.
 */
export async function detectProvider(ssh: SSHConfig): Promise<ProviderDetection> {
  const probe = [
    'command -v qm >/dev/null 2>&1 && echo HAS_QM',
    'command -v virsh >/dev/null 2>&1 && echo HAS_VIRSH',
    'command -v govc >/dev/null 2>&1 && echo HAS_GOVC',
    'true',
  ].join('; ');

  try {
    const out = await execSSHCommandRaw(ssh, probe);

    if (out.includes('HAS_QM')) return { kind: 'proxmox-ssh', reason: '`qm` encontrado no host SSH' };
    if (out.includes('HAS_VIRSH')) return { kind: 'libvirt-ssh', reason: '`virsh` encontrado no host SSH' };
    if (out.includes('HAS_GOVC')) return { kind: 'govc-ssh', reason: '`govc` encontrado no host SSH' };

    return {
      kind: 'none',
      reason: 'nenhuma CLI de hypervisor (qm/virsh/govc) no host SSH — usando ping/TCP + heartbeat',
    };
  } catch (err: any) {
    return { kind: 'none', reason: `sondagem SSH falhou: ${err.message}` };
  }
}

let cached: VmProvider | null = null;

/**
 * Resolve o provider uma vez por processo e guarda em cache: a detecção custa uma
 * conexão SSH, e o ciclo roda a cada 2 minutos. Reinício do container refaz a
 * detecção, que é o momento certo (o parque pode ter mudado).
 */
export async function getVmProvider(): Promise<VmProvider> {
  if (cached) return cached;

  const configured = vmConfig.provider;
  const ssh = getDefaultSSHConfig();

  // A API do Proxmox não depende de SSH: se está configurada e foi pedida, usa direto.
  if (configured === 'proxmox-api') {
    cached = new ProxmoxApiProvider(vmConfig.proxmoxApi);
    log.warn('[VM] Provider: proxmox-api (configurado via VM_PROVIDER)');
    return cached;
  }

  if (configured === 'none') {
    cached = new NoneProvider();
    log.warn('[VM] Provider: none (configurado via VM_PROVIDER) — só ping/TCP + heartbeat');
    return cached;
  }

  if (!ssh) {
    // Sem SSH sobra a API do Proxmox, se estiver configurada; senão, nada.
    // Exige o secret tambem: sem ele a chamada sai sem credencial valida, volta
    // vazia todo ciclo, e o worker se comportaria como se nao houvesse VM alguma.
    if (vmConfig.proxmoxApi.url && vmConfig.proxmoxApi.tokenId && vmConfig.proxmoxApi.tokenSecret) {
      cached = new ProxmoxApiProvider(vmConfig.proxmoxApi);
      log.warn('[VM] Provider: proxmox-api (sem DOCKER_SSH_HOST, mas PROXMOX_API_URL configurado)');
      return cached;
    }
    cached = new NoneProvider();
    log.warn('[VM] Provider: none — DOCKER_SSH_HOST/DOCKER_SSH_USERNAME não configurados');
    return cached;
  }

  let kind: string = configured;

  if (configured === 'auto') {
    // Com a API do Proxmox configurada explicitamente, ela ganha da sondagem:
    // enxerga o cluster inteiro, não só o nó em que o SSH cai.
    if (vmConfig.proxmoxApi.url && vmConfig.proxmoxApi.tokenId && vmConfig.proxmoxApi.tokenSecret) {
      cached = new ProxmoxApiProvider(vmConfig.proxmoxApi);
      log.warn('[VM] Provider: proxmox-api (auto — PROXMOX_API_* configurado)');
      return cached;
    }

    const detected = await detectProvider(ssh);
    kind = detected.kind;
    log.warn(`[VM] Provider detectado: ${kind} (${detected.reason})`);
  }

  switch (kind) {
    case 'proxmox-ssh':
      cached = new ProxmoxSshProvider(ssh);
      break;
    case 'libvirt-ssh':
      cached = new LibvirtSshProvider(ssh);
      break;
    case 'govc-ssh':
      cached = new GovcSshProvider(ssh);
      break;
    default:
      cached = new NoneProvider();
  }

  return cached;
}

/** Só para testes e para o script de descoberta. */
export function resetVmProviderCache(): void {
  cached = null;
}
