const Docker = require('dockerode');
import * as dotenv from 'dotenv';
import { checkContainerStatusSSH, getContainerStatsSSH, SSHConfig } from './docker-ssh';
import { log } from '../logger';

dotenv.config({ quiet: true });

export interface DockerConfig {
  host?: string;
  port?: number;
  socketPath?: string;
  // SSH config (para conexão remota via SSH)
  ssh?: SSHConfig;
}

// Configurações globais do Docker via .env (fallback se não configurado no serviço)
const DEFAULT_DOCKER_HOST = process.env.DOCKER_HOST;
const DEFAULT_DOCKER_PORT = process.env.DOCKER_PORT ? parseInt(process.env.DOCKER_PORT) : undefined;
const DEFAULT_DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH;

// SSH config para Docker remoto
const DEFAULT_SSH_HOST = process.env.DOCKER_SSH_HOST;
const DEFAULT_SSH_PORT = process.env.DOCKER_SSH_PORT ? parseInt(process.env.DOCKER_SSH_PORT) : 22;
const DEFAULT_SSH_USERNAME = process.env.DOCKER_SSH_USERNAME;
const DEFAULT_SSH_PASSWORD = process.env.DOCKER_SSH_PASSWORD;
const DEFAULT_SSH_PRIVATE_KEY = process.env.DOCKER_SSH_PRIVATE_KEY;

export interface ContainerStatus {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'restarting' | 'paused' | 'exited' | 'unknown';
  startedAt?: Date;
  uptime?: number; // em segundos
  error?: string; // Mensagem de erro se houver problema de conexão
}

/**
 * Cria um cliente Docker baseado na configuração
 * Prioridade: config do serviço > .env > padrão local
 */
export const createDockerClient = (config?: DockerConfig): any => {
  try {
    // Usa configuração do serviço se disponível
    const socketPath = config?.socketPath || DEFAULT_DOCKER_SOCKET_PATH;
    const host = config?.host || DEFAULT_DOCKER_HOST;
    const port = config?.port || DEFAULT_DOCKER_PORT;

    if (socketPath) {
      log.info(`  Using Docker socket: ${socketPath}`);
      return new Docker({ socketPath });
    } else if (host) {
      const dockerPort = port || 2375;
      log.info(`  Using Docker remote: ${host}:${dockerPort}`);
      return new Docker({
        host: host,
        port: dockerPort,
      });
    } else {
      log.info(`  Using Docker default (local socket)`);
      return new Docker();
    }
  } catch (error: any) {
    log.error('Failed to create Docker client:', error.message);
    if (error.stack) {
      log.error(error.stack);
    }
    return null;
  }
};

/**
 * Verifica se um container está rodando
 * Retorna null se não conseguir conectar (erro de conexão), não se o container não existe
 */
export const checkContainerStatus = async (
  containerIdOrName: string,
  dockerConfig?: DockerConfig
): Promise<ContainerStatus | null> => {
  // Se SSH config está disponível, usa SSH
  if (dockerConfig?.ssh) {
    log.info(`  Using SSH to check container: ${dockerConfig.ssh.host}:${dockerConfig.ssh.port || 22}`);
    return await checkContainerStatusSSH(containerIdOrName, dockerConfig.ssh);
  }

  const docker: any = createDockerClient(dockerConfig);
  
  if (!docker) {
    return {
      id: '',
      name: containerIdOrName,
      status: 'unknown',
      error: 'Docker client not available',
    };
  }

  try {
    const container = docker.getContainer(containerIdOrName);
    const inspect = await container.inspect();

    const status = inspect.State.Status as ContainerStatus['status'];
    const startedAt = inspect.State.StartedAt ? new Date(inspect.State.StartedAt) : undefined;
    
    // Calcular uptime
    let uptime: number | undefined;
    if (startedAt && status === 'running') {
      uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    }

    return {
      id: inspect.Id,
      name: inspect.Name.replace(/^\//, ''), // Remove barra inicial
      status: status === 'running' ? 'running' : 
              status === 'exited' ? 'exited' :
              status === 'restarting' ? 'restarting' :
              status === 'paused' ? 'paused' : 'stopped',
      startedAt,
      uptime,
    };
  } catch (error: any) {
    if (error.statusCode === 404) {
      // Container não encontrado - isso é um problema real, não um erro de conexão
      return {
        id: '',
        name: containerIdOrName,
        status: 'stopped',
        error: `Container not found: ${containerIdOrName}`,
      };
    }
    
    // Erro de conexão ou outro erro - não marcar como DOWN
    log.error(`Error checking container ${containerIdOrName}:`, error.message);
    return {
      id: '',
      name: containerIdOrName,
      status: 'unknown',
      error: `Connection error: ${error.message}`,
    };
  }
};

/**
 * Lista todos os containers em execução
 */
export const listRunningContainers = async (dockerConfig?: DockerConfig): Promise<ContainerStatus[]> => {
  const docker: any = createDockerClient(dockerConfig);
  
  if (!docker) {
    return [];
  }

  try {
    const containers = await docker.listContainers({ all: false }); // apenas running
    
    return containers.map(container => {
      const status = container.Status.includes('Up') ? 'running' as const :
                     container.Status.includes('Restarting') ? 'restarting' as const :
                     container.Status.includes('Paused') ? 'paused' as const :
                     'stopped' as const;

      return {
        id: container.Id,
        name: container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12),
        status,
        startedAt: container.Status.includes('Up') ? new Date(container.Created * 1000) : undefined,
      };
    });
  } catch (error: any) {
    log.error(`Error listing containers:`, error.message);
    return [];
  }
};

/**
 * Busca container por nome ou ID parcial
 */
export const findContainerByName = async (
  searchName: string,
  dockerConfig?: DockerConfig
): Promise<ContainerStatus | null> => {
  const docker: any = createDockerClient(dockerConfig);
  
  if (!docker) {
    return null;
  }

  try {
    const containers = await docker.listContainers({ all: true });
    
    const found = containers.find(container => {
      const names = container.Names.map(n => n.replace(/^\//, ''));
      return names.some(name => 
        name === searchName || 
        name.includes(searchName) || 
        searchName.includes(name)
      );
    });

    if (!found) {
      return null;
    }

    return await checkContainerStatus(found.Id, dockerConfig);
  } catch (error: any) {
    log.error(`Error finding container ${searchName}:`, error.message);
    return null;
  }
};

/**
 * Obtém estatísticas de uso de recursos de um container
 */
export const getContainerStats = async (
  containerIdOrName: string,
  dockerConfig?: DockerConfig
): Promise<{
  cpuPercent: number;
  memoryUsage: number; // MB
  memoryLimit: number; // MB
  networkRx: number; // bytes
  networkTx: number; // bytes
} | null> => {
  // Se SSH config está disponível, usa SSH
  if (dockerConfig?.ssh) {
    return await getContainerStatsSSH(containerIdOrName, dockerConfig.ssh);
  }

  const docker: any = createDockerClient(dockerConfig);
  
  if (!docker) {
    return null;
  }

  try {
    const container = docker.getContainer(containerIdOrName);
    const stats = await container.stats({ stream: false });

    // Calcular CPU percentual (média entre CPUs)
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
    const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats?.system_cpu_usage || 0);
    const numCpus = stats.cpu_stats.online_cpus || 1;
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

    // Memória em MB
    const memoryUsage = stats.memory_stats.usage ? stats.memory_stats.usage / 1024 / 1024 : 0;
    const memoryLimit = stats.memory_stats.limit ? stats.memory_stats.limit / 1024 / 1024 : 0;

    // Network
    const networks = stats.networks || {};
    const networkRx: number = Object.values(networks).reduce((sum: number, net: any) => sum + (net.rx_bytes || 0), 0) as number;
    const networkTx: number = Object.values(networks).reduce((sum: number, net: any) => sum + (net.tx_bytes || 0), 0) as number;

    return {
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memoryUsage: Math.round(memoryUsage * 100) / 100,
      memoryLimit: Math.round(memoryLimit * 100) / 100,
      networkRx,
      networkTx,
    };
  } catch (error: any) {
    if (error.statusCode === 404) {
      return null;
    }
    const msg = error.message || '';
    if (msg.includes('No such container') || msg.includes('not found')) {
      log.warn(`  Container "${containerIdOrName}" not found for stats. Check container_id in DB.`);
    } else {
      log.error(`Error getting stats for container ${containerIdOrName}:`, error.message);
    }
    return null;
  }
};
