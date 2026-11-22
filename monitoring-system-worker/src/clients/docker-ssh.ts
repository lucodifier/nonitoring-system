import { Client } from 'ssh2';
import * as dotenv from 'dotenv';
import { log } from '../logger';

dotenv.config({ quiet: true });

export interface SSHConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface ContainerStatus {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'restarting' | 'paused' | 'exited' | 'unknown';
  startedAt?: Date;
  uptime?: number;
  error?: string;
}

/**
 * Fingerprint SHA-256 esperado do host SSH (DOCKER_SSH_HOST_FINGERPRINT).
 *
 * Formato aceito: o mesmo que `ssh-keyscan -t rsa host | ssh-keygen -lf -` imprime,
 * ex. "SHA256:AbC123...". O prefixo "SHA256:" e opcional.
 *
 * Quando nao esta definido, o comportamento e exatamente o de antes (sem
 * verificacao) -- isto e' aditivo de proposito, para nao quebrar o monitoramento
 * Docker que ja roda em producao contra hosts sem fingerprint cadastrado.
 */
const getExpectedHostFingerprint = (): string | null => {
  const raw = (process.env.DOCKER_SSH_HOST_FINGERPRINT || '').trim();
  if (!raw) return null;
  return raw.replace(/^SHA256:/i, '');
};

/**
 * Monta as opcoes de conexao, aplicando a verificacao de chave de host quando
 * configurada. Sem isso, um host que se passe pelo DOCKER_SSH_HOST captura a
 * DOCKER_SSH_PASSWORD e pode devolver estado de VM falso.
 */
function applyHostVerification(connectOptions: any): void {
  const expected = getExpectedHostFingerprint();
  if (!expected) return;

  connectOptions.hostHash = 'sha256';
  connectOptions.hostVerifier = (hash: string) => {
    // ssh2 entrega o hash em hex ou base64 conforme a versao; o `ssh-keygen`
    // imprime base64 sem o '=' final. Comparamos das duas formas, sem case.
    const normalized = String(hash).replace(/=+$/, '');
    const ok =
      normalized.toLowerCase() === expected.toLowerCase() ||
      Buffer.from(normalized, 'hex').toString('base64').replace(/=+$/, '') === expected;

    if (!ok) {
      log.error(
        `[SSH] Chave do host NAO confere com DOCKER_SSH_HOST_FINGERPRINT (recebido: ${normalized}). Conexao recusada.`,
      );
    }
    return ok;
  };
}

/**
 * Conexões SSH reutilizadas: uma por usuário@host:porta, compartilhada por todos
 * os comandos do processo (ciclo de serviços, VMs, disco).
 *
 * Antes, cada comando abria e autenticava uma sessão SSH nova. Em prod isso dava
 * cerca de 85 logins por minuto contra o próprio host, e cada login gera 8 linhas
 * no auth.log e 2 no syslog: 850MB de auth.log por semana e o disco em 95%.
 *
 * A conexão fica aberta com keepalive. Se o servidor a fechar ou ela der erro, é
 * descartada e reaberta no próximo comando -- o custo de uma queda é um login a
 * mais, não um ciclo perdido.
 */
const connections = new Map<string, Promise<Client>>();

const connectionKey = (c: SSHConfig): string => `${c.username}@${c.host}:${c.port || 22}`;

function buildConnectOptions(sshConfig: SSHConfig): any {
  const connectOptions: any = {
    host: sshConfig.host,
    port: sshConfig.port || 22,
    username: sshConfig.username,
    // Mantém a sessão viva entre ciclos e detecta queda silenciosa (NAT, sshd reiniciado).
    keepaliveInterval: 30_000,
    keepaliveCountMax: 3,
    readyTimeout: 20_000,
  };

  if (sshConfig.password) {
    connectOptions.password = sshConfig.password;
  } else if (sshConfig.privateKey) {
    connectOptions.privateKey = sshConfig.privateKey;
    if (sshConfig.passphrase) {
      connectOptions.passphrase = sshConfig.passphrase;
    }
  }

  applyHostVerification(connectOptions);
  return connectOptions;
}

function getConnection(sshConfig: SSHConfig): Promise<Client> {
  const key = connectionKey(sshConfig);
  const existing = connections.get(key);
  if (existing) return existing;

  const pending = new Promise<Client>((resolve, reject) => {
    const conn = new Client();
    let ready = false;

    // Só remove do cache se ainda for esta conexão: uma reconexão pode já ter
    // substituído a entrada, e apagar a nova por engano geraria login em dobro.
    const forget = (why: string) => {
      if (connections.get(key) === pending) {
        connections.delete(key);
        log.debug(`[SSH] Conexão com ${key} descartada (${why}).`);
      }
    };

    conn.on('ready', () => {
      ready = true;
      log.info(`[SSH] Conectado a ${key} (sessão reutilizável).`);
      resolve(conn);
    });
    conn.on('error', (err) => {
      forget(`erro: ${err.message}`);
      if (!ready) reject(err);
    });
    conn.on('close', () => forget('fechada pelo servidor'));
    conn.on('end', () => forget('encerrada'));

    conn.connect(buildConnectOptions(sshConfig));
  });

  connections.set(key, pending);
  return pending;
}

/** Abre um canal exec na conexão já autenticada. Não fecha a conexão ao terminar. */
function runCommand(conn: Client, command: string, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      stream.on('close', (code: number) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`${label} failed with code ${code}: ${stderr || stdout}`));
        }
      });

      stream.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    });
  });
}

/** Erros que indicam que a sessão caiu, e não que o comando falhou. */
const isConnectionLost = (err: any): boolean =>
  /not connected|connection (closed|reset|lost)|ECONNRESET|EPIPE|channel open failure/i.test(err?.message || '');

async function execSSH(sshConfig: SSHConfig, command: string, label: string): Promise<string> {
  const conn = await getConnection(sshConfig);
  try {
    return await runCommand(conn, command, label);
  } catch (err: any) {
    if (!isConnectionLost(err)) throw err;

    // A sessão morreu entre um ciclo e outro. Reabre uma única vez; se falhar de
    // novo o erro sobe e o chamador trata como já tratava.
    log.warn(`[SSH] Sessão com ${connectionKey(sshConfig)} caiu (${err.message}); reconectando.`);
    connections.delete(connectionKey(sshConfig));
    const fresh = await getConnection(sshConfig);
    return runCommand(fresh, command, label);
  }
}

/**
 * Executa um comando arbitrário no host via SSH (ex: df, uptime)
 */
export async function execSSHCommandRaw(sshConfig: SSHConfig, command: string): Promise<string> {
  return execSSH(sshConfig, command, 'Command');
}

/**
 * Executa um comando Docker via SSH
 */
async function execDockerCommand(command: string, sshConfig: SSHConfig): Promise<string> {
  return execSSH(sshConfig, `docker ${command}`, 'Docker command');
}

/**
 * Verifica status de um container via SSH
 */
export async function checkContainerStatusSSH(
  containerName: string,
  sshConfig: SSHConfig
): Promise<ContainerStatus | null> {
  try {
    // Primeiro tenta busca exata pelo nome completo
    // IMPORTANTE: Docker pode retornar o nome com ou sem barra inicial
    let escapedName = containerName.replace(/"/g, '\\"');
    log.info(`  Searching for container with exact name: ${containerName}`);
    let psOutput = await execDockerCommand(
      `ps -a --filter "name=^${escapedName}$" --format "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.CreatedAt}}"`,
      sshConfig
    );
    
    // Se não encontrar, tenta também sem o ^ e $ (busca mais flexível)
    if (!psOutput.trim()) {
      log.info(`  Exact match failed, trying without anchors for: ${containerName}`);
      psOutput = await execDockerCommand(
        `ps -a --filter "name=${escapedName}" --format "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.CreatedAt}}"`,
        sshConfig
      );
    }

    // Se ainda não encontrar, tenta sem o filtro e busca manualmente
    if (!psOutput.trim()) {
      log.info(`  Container still not found with filters, listing all containers to search for: ${containerName}`);
      const allContainers = await execDockerCommand(
        `ps -a --format "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.CreatedAt}}"`,
        sshConfig
      );
      
      // Buscar manualmente pelo nome (pode ter prefixo como projeto-)
      const lines = allContainers.trim().split('\n');
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
          // Nomes podem ter barra inicial e podem ser múltiplos separados por vírgula
          const namesStr = parts[1].replace(/^\//, ''); // Remove barra inicial
          const names = namesStr.split(',').map(n => n.trim()); // Separa múltiplos nomes
          
          // Verifica cada nome
          for (const name of names) {
            // Tenta match exato, parcial ou se termina/com inicia com o nome
            if (name === containerName || 
                name === `/${containerName}` || // Docker às vezes retorna com /
                name.endsWith(`-${containerName}`) ||
                name.endsWith(`_${containerName}`) ||
                name.startsWith(`${containerName}-`) ||
                name.startsWith(`${containerName}_`)) {
              psOutput = line;
              log.info(`  ✓ Found container with name match: "${name}" (searching for: "${containerName}")`);
              break;
            }
          }
          if (psOutput.trim()) break;
        }
      }
    }

    if (!psOutput.trim()) {
      // Container não encontrado após todas as tentativas
      log.warn(`  ⚠️  Container ${containerName} not found after exhaustive search`);
      return {
        id: '',
        name: containerName,
        status: 'stopped',
        error: `Container ${containerName} not found`,
      };
    }

    const lines = psOutput.trim().split('\n');
    if (lines.length === 0 || !lines[0]) {
      log.warn(`  ⚠️  No output from docker ps after search`);
      return {
        id: '',
        name: containerName,
        status: 'stopped',
        error: `Container ${containerName} not found`,
      };
    }
    
    const line = lines[0];
    const parts = line.split('\t');

    if (parts.length < 4) {
      log.warn(`  ⚠️  Failed to parse docker ps output. Parts length: ${parts.length}, Line: ${line}`);
      return {
        id: '',
        name: containerName,
        status: 'unknown',
        error: 'Failed to parse docker ps output',
      };
    }

    const id = parts[0];
    const name = parts[1].replace(/^\//, ''); // Remove barra inicial se houver (Docker às vezes retorna /container-name)
    const statusStr = parts[2];
    const createdAtStr = parts[3];
    
    log.info(`  ✓ Found container: ID=${id.substring(0, 12)}, Name="${name}", Status="${statusStr}"`);

    // Parse status
    let status: ContainerStatus['status'] = 'unknown';
    if (statusStr.includes('Up')) {
      status = 'running';
    } else if (statusStr.includes('Exited')) {
      status = 'exited';
    } else if (statusStr.includes('Restarting')) {
      status = 'restarting';
    } else if (statusStr.includes('Paused')) {
      status = 'paused';
    } else {
      status = 'stopped';
    }

    // Calcular uptime se estiver rodando
    let uptime: number | undefined;
    let startedAt: Date | undefined;

    if (status === 'running') {
      // Executa docker inspect para pegar StartedAt - usar o nome encontrado
      const nameToInspect = name || containerName; // Usar o nome encontrado no docker ps
      try {
        const inspectOutput = await execDockerCommand(
          `inspect ${nameToInspect} --format '{{.State.StartedAt}}'`,
          sshConfig
        );
        const startedAtStr = inspectOutput.trim();
        if (startedAtStr && startedAtStr !== '0001-01-01T00:00:00Z') {
          startedAt = new Date(startedAtStr);
          uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);
        }
      } catch (e) {
        // Ignora erro de inspect
        log.warn(`  ⚠️  Could not inspect container ${nameToInspect} for uptime: ${(e as Error).message}`);
      }
    }

    log.info(`  ✓ Container check result: name=${name}, status=${status}, id=${id.substring(0, 12)}`);
    return {
      id,
      name: name || containerName, // Retornar o nome encontrado ou o original
      status,
      startedAt,
      uptime,
    };
  } catch (error: any) {
    log.error(`Error checking container ${containerName} via SSH:`, error.message);
    return {
      id: '',
      name: containerName,
      status: 'unknown',
      error: `SSH connection error: ${error.message}`,
    };
  }
}

/**
 * Obtém estatísticas de uso de recursos via SSH
 */
export async function getContainerStatsSSH(
  containerName: string,
  sshConfig: SSHConfig
): Promise<{
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
} | null> {
  try {
    // Executa docker stats uma vez (não streaming)
    const statsOutput = await execDockerCommand(
      `stats ${containerName} --no-stream --format "{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"`,
      sshConfig
    );

    if (!statsOutput.trim()) {
      return null;
    }

    const parts = statsOutput.trim().split('\t');
    if (parts.length < 3) {
      return null;
    }

    // Parse CPU percent
    const cpuPercent = parseFloat(parts[0].replace('%', '')) || 0;

    // Parse Memory (formato: "123.45MiB / 512MiB")
    const memParts = parts[1].split(' / ');
    const memoryUsageStr = memParts[0];
    const memoryLimitStr = memParts[1] || memoryUsageStr;

    // Converter para MB
    const memoryUsage = parseMemoryToMB(memoryUsageStr);
    const memoryLimit = parseMemoryToMB(memoryLimitStr);

    // Parse Network (formato: "1.2GB / 3.4GB")
    const netParts = parts[2].split(' / ');
    const networkRxStr = netParts[0];
    const networkTxStr = netParts[1] || '0B';

    const networkRx = parseSizeToBytes(networkRxStr);
    const networkTx = parseSizeToBytes(networkTxStr);

    return {
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memoryUsage: Math.round(memoryUsage * 100) / 100,
      memoryLimit: Math.round(memoryLimit * 100) / 100,
      networkRx,
      networkTx,
    };
  } catch (error: any) {
    const msg = error.message || '';
    if (msg.includes('No such container') || msg.includes('not found')) {
      log.warn(`  Container "${containerName}" not found for stats (name may differ on host). Check container_id in DB.`);
    } else {
      log.error(`Error getting stats for ${containerName} via SSH:`, error.message);
    }
    return null;
  }
}

/**
 * Converte string de memória (ex: "123.45MiB") para MB
 */
function parseMemoryToMB(memoryStr: string): number {
  const match = memoryStr.match(/^([\d.]+)\s*(KiB|MiB|GiB|KB|MB|GB)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  switch (unit) {
    case 'KB':
    case 'KIB':
      return value / 1024;
    case 'MB':
    case 'MIB':
      return value;
    case 'GB':
    case 'GIB':
      return value * 1024;
    default:
      return 0;
  }
}

/**
 * Converte string de tamanho (ex: "1.2GB") para bytes
 */
function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|KiB|MiB|GiB)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  switch (unit) {
    case 'B':
      return value;
    case 'KB':
    case 'KIB':
      return value * 1024;
    case 'MB':
    case 'MIB':
      return value * 1024 * 1024;
    case 'GB':
    case 'GIB':
      return value * 1024 * 1024 * 1024;
    default:
      return 0;
  }
}

export interface DiskUsageEntry {
  mount: string;
  usedPercent: number;
}

/**
 * Obtém uso de disco no host via SSH (comando df -P).
 * Retorna lista de pontos de montagem com percentual de uso.
 */
export async function getDiskUsageSSH(sshConfig: SSHConfig): Promise<DiskUsageEntry[]> {
  try {
    const output = await execSSHCommandRaw(sshConfig, 'df -P');
    const lines = output.trim().split('\n');
    const result: DiskUsageEntry[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const pctStr = parts.find((p) => p.endsWith('%'));
      const usedPercent = pctStr ? parseInt(pctStr.replace('%', ''), 10) : NaN;
      const mount = parts[parts.length - 1];

      if (!isNaN(usedPercent) && mount && mount !== 'on') {
        result.push({ mount, usedPercent });
      }
    }

    return result;
  } catch (error: any) {
    log.error('Error getting disk usage via SSH:', error.message);
    return [];
  }
}


/**
 * Configuração SSH padrão do parque (DOCKER_SSH_*), ou null quando não configurada.
 *
 * Este objeto era montado à mão em dois pontos do worker.ts; com o monitoramento de
 * VMs passariam a ser cinco. Centralizar evita que um deles esqueça a privateKey.
 */
export function getDefaultSSHConfig(): SSHConfig | null {
  const host = process.env.DOCKER_SSH_HOST;
  const username = process.env.DOCKER_SSH_USERNAME;

  if (!host || !username) return null;

  return {
    host,
    port: process.env.DOCKER_SSH_PORT ? parseInt(process.env.DOCKER_SSH_PORT, 10) : 22,
    username,
    password: process.env.DOCKER_SSH_PASSWORD || undefined,
    privateKey: process.env.DOCKER_SSH_PRIVATE_KEY || undefined,
  };
}
