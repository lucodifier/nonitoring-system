import * as net from 'net';
import { SSHConfig, execSSHCommandRaw, getDefaultSSHConfig } from './docker-ssh';
import { vmConfig } from '../config/vm-config';
import { log } from '../logger';

export interface ReachabilityResult {
  reachable: boolean;
  method: 'tcp' | 'ping' | 'none';
  detail: string;
}

/**
 * Tenta um TCP connect. É a sonda preferida dentro de container: não precisa de
 * CAP_NET_RAW (que o ICMP exige e o container do worker não tem), e "porta aberta"
 * é um sinal mais forte de VM viva do que ICMP, que firewall costuma bloquear.
 */
function tcpProbe(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    try {
      socket.connect(port, ip);
    } catch {
      finish(false);
    }
  });
}

/**
 * ICMP a partir do host de gerência, pela sessão SSH que já usamos.
 *
 * Vale a pena mesmo tendo o TCP: a sonda sai de dentro da rede do parque, então
 * enxerga VM que o container do worker não alcança por roteamento/firewall.
 */
async function pingViaSsh(ssh: SSHConfig, ip: string, timeoutMs: number): Promise<boolean> {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));

  // Defesa em profundidade: o chamador já rejeitou o que não é IP, mas este valor
  // vai para uma linha de comando executada no host de gerência, então a checagem
  // fica também aqui -- quem adicionar um segundo chamador amanhã herda a proteção.
  if (!net.isIP(ip)) return false;

  try {
    // `ping` devolve exit code != 0 quando não há resposta, e execSSHCommandRaw
    // rejeita nesse caso -- é justamente o sinal de inalcançável.
    await execSSHCommandRaw(ssh, `ping -c 1 -W ${seconds} ${ip}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * VM alcançável? Primeiro TCP direto nas portas cadastradas; se todas falharem e
 * VM_PING_VIA_SSH estiver ligado, tenta ICMP a partir do host de gerência.
 *
 * Só devolve `reachable: false` depois de esgotar as duas vias -- o alerta de
 * "VM inacessível" ainda exige N falhas consecutivas por cima disso.
 */
export async function checkVmReachable(ip: string | null | undefined): Promise<ReachabilityResult> {
  if (!ip) {
    return { reachable: false, method: 'none', detail: 'VM sem IP cadastrado' };
  }

  // monitoring.vms.ip e' texto livre e vai parar numa linha de comando executada
  // por SSH no host de gerência. Sem esta checagem, um valor como
  // "10.0.0.1; rm -rf /" rodaria como comando la, com o usuario SSH do worker.
  // Nao alerta como VM caida: cadastro errado e problema de configuracao, e
  // tratar como queda geraria um alerta que ninguem consegue resolver.
  if (!net.isIP(ip)) {
    log.error(`[VM] IP cadastrado invalido, sonda ignorada: ${JSON.stringify(ip)}`);
    return { reachable: false, method: 'none', detail: `IP cadastrado inválido: ${ip}` };
  }

  const { ports, timeoutMs, pingViaSsh: usePing } = vmConfig.probe;

  for (const port of ports) {
    const ok = await tcpProbe(ip, port, timeoutMs);
    if (ok) {
      return { reachable: true, method: 'tcp', detail: `TCP ${ip}:${port} aberto` };
    }
  }

  if (usePing) {
    const ssh = getDefaultSSHConfig();
    if (ssh) {
      const ok = await pingViaSsh(ssh, ip, timeoutMs);
      if (ok) {
        return { reachable: true, method: 'ping', detail: `ICMP respondeu via ${ssh.host}` };
      }
      return {
        reachable: false,
        method: 'ping',
        detail: `sem resposta em TCP ${ports.join(',')} nem em ICMP via ${ssh.host}`,
      };
    }
    log.debug('[VM] VM_PING_VIA_SSH ligado, mas DOCKER_SSH_* não configurado — só TCP.');
  }

  return {
    reachable: false,
    method: 'tcp',
    detail: `sem resposta em TCP ${ports.join(',')}`,
  };
}
