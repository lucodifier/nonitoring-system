import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Service } from './entities/service.entity';
const Docker = require('dockerode');
const { Client } = require('ssh2');

@Injectable()
export class DockerService {
  constructor(
    @InjectRepository(Service)
    private servicesRepository: Repository<Service>,
    private configService: ConfigService,
  ) {}

  private async execDockerCommandSSH(command: string, sshConfig: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => {
        conn.exec(`docker ${command}`, (err: any, stream: any) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          let stdout = '';
          let stderr = '';
          stream.on('close', (code: number) => {
            conn.end();
            // Para comandos start/stop/restart, código 0 ou 1 pode ser aceito
            // (código 1 pode indicar que o container já estava no estado desejado)
            if (code === 0 || (code === 1 && command.includes('start') || command.includes('stop') || command.includes('restart'))) {
              resolve(stdout);
            } else {
              reject(new Error(`Docker command failed with code ${code}: ${stderr || stdout}`));
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
      conn.on('error', reject);
      conn.connect(sshConfig);
    });
  }

  private getDockerConfig(service: Service): { useSSH: boolean; sshConfig?: any; docker?: any } {
    // Verificar se precisa usar SSH (usar ConfigService do NestJS)
    const sshHost = this.configService.get<string>('DOCKER_SSH_HOST');
    const sshUsername = this.configService.get<string>('DOCKER_SSH_USERNAME');
    const sshPassword = this.configService.get<string>('DOCKER_SSH_PASSWORD');
    const sshPrivateKey = this.configService.get<string>('DOCKER_SSH_PRIVATE_KEY');

    // Priorizar SSH se configurado
    if (sshHost && sshUsername) {
      return {
        useSSH: true,
        sshConfig: {
          host: sshHost,
          port: this.configService.get<number>('DOCKER_SSH_PORT', 22),
          username: sshUsername,
          password: sshPassword,
          privateKey: sshPrivateKey,
        },
      };
    }

    // Tentar Docker local apenas se socket estiver disponível (Linux/Mac)
    const socketPath = this.configService.get<string>('DOCKER_SOCKET_PATH', '/var/run/docker.sock');
    const fs = require('fs');
    
    // Verificar se o socket existe antes de tentar usar
    try {
      // No Windows, verificar se é Windows e não tentar usar socket Unix
      const isWindows = process.platform === 'win32';
      
      if (!isWindows && fs.existsSync(socketPath)) {
        return {
          useSSH: false,
          docker: new Docker({ socketPath }),
        };
      }
      
      // No Windows ou se socket não existe, requer SSH
      if (isWindows || !fs.existsSync(socketPath)) {
        throw new BadRequestException(
          'Docker SSH configuration required. Please set DOCKER_SSH_HOST and DOCKER_SSH_USERNAME environment variables in your .env file. ' +
          'Example:\n' +
          'DOCKER_SSH_HOST=10.10.10.223\n' +
          'DOCKER_SSH_USERNAME=desenvol_prod\n' +
          'DOCKER_SSH_PASSWORD=your_password'
        );
      }
    } catch (error: any) {
      // Se já é BadRequestException, relançar
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Outros erros: requer SSH
      throw new BadRequestException(
        'Docker SSH configuration required. Please set DOCKER_SSH_HOST and DOCKER_SSH_USERNAME environment variables in your .env file.'
      );
    }

    // Fallback (não deveria chegar aqui)
    throw new BadRequestException('Docker configuration not available');
  }

  async startService(serviceId: string): Promise<{ success: boolean; message: string }> {
    const service = await this.servicesRepository.findOne({ where: { id: serviceId } });
    if (!service) {
      throw new BadRequestException(`Service ${serviceId} not found`);
    }

    const containerName = service.containerId || serviceId;
    const config = this.getDockerConfig(service);

    try {
      if (config.useSSH && config.sshConfig) {
        // Usar SSH
        await this.execDockerCommandSSH(`start ${containerName}`, config.sshConfig);
        return { success: true, message: `Service ${serviceId} started successfully` };
      } else if (config.docker) {
        // Usar Docker local
        const containers = await config.docker.listContainers({ all: true });
        const container = containers.find((c: any) => 
          c.Names.some((name: string) => name.includes(containerName))
        );

        if (!container) {
          throw new BadRequestException(`Container ${containerName} not found`);
        }

        const dockerContainer = config.docker.getContainer(container.Id);
        await dockerContainer.start();
        return { success: true, message: `Service ${serviceId} started successfully` };
      } else {
        throw new BadRequestException('Docker configuration not available');
      }
    } catch (error: any) {
      throw new BadRequestException(`Failed to start service: ${error.message}`);
    }
  }

  async stopService(serviceId: string): Promise<{ success: boolean; message: string }> {
    const service = await this.servicesRepository.findOne({ where: { id: serviceId } });
    if (!service) {
      throw new BadRequestException(`Service ${serviceId} not found`);
    }

    const containerName = service.containerId || serviceId;
    const config = this.getDockerConfig(service);

    try {
      if (config.useSSH && config.sshConfig) {
        // Usar SSH - executar comando docker stop diretamente
        await this.execDockerCommandSSH(`stop ${containerName}`, config.sshConfig);
        return { success: true, message: `Service ${serviceId} stopped successfully` };
      } else if (config.docker) {
        // Usar Docker local
        const containers = await config.docker.listContainers({ all: true });
        // Buscar container por nome exato ou parcial
        const container = containers.find((c: any) => {
          const names = c.Names || [];
          return names.some((name: string) => {
            const cleanName = name.replace(/^\//, ''); // Remove barra inicial
            return cleanName === containerName || cleanName.includes(containerName) || containerName.includes(cleanName);
          });
        });

        if (!container) {
          throw new BadRequestException(`Container ${containerName} not found`);
        }

        const dockerContainer = config.docker.getContainer(container.Id);
        await dockerContainer.stop();
        return { success: true, message: `Service ${serviceId} stopped successfully` };
      } else {
        throw new BadRequestException('Docker configuration not available');
      }
    } catch (error: any) {
      throw new BadRequestException(`Failed to stop service: ${error.message}`);
    }
  }

  async restartService(serviceId: string): Promise<{ success: boolean; message: string }> {
    const service = await this.servicesRepository.findOne({ where: { id: serviceId } });
    if (!service) {
      throw new BadRequestException(`Service ${serviceId} not found`);
    }

    const containerName = service.containerId || serviceId;
    const config = this.getDockerConfig(service);

    try {
      if (config.useSSH && config.sshConfig) {
        // Usar SSH - executar comando docker restart diretamente
        await this.execDockerCommandSSH(`restart ${containerName}`, config.sshConfig);
        return { success: true, message: `Service ${serviceId} restarted successfully` };
      } else if (config.docker) {
        // Usar Docker local
        const containers = await config.docker.listContainers({ all: true });
        // Buscar container por nome exato ou parcial
        const container = containers.find((c: any) => {
          const names = c.Names || [];
          return names.some((name: string) => {
            const cleanName = name.replace(/^\//, ''); // Remove barra inicial
            return cleanName === containerName || cleanName.includes(containerName) || containerName.includes(cleanName);
          });
        });

        if (!container) {
          throw new BadRequestException(`Container ${containerName} not found`);
        }

        const dockerContainer = config.docker.getContainer(container.Id);
        await dockerContainer.restart();
        return { success: true, message: `Service ${serviceId} restarted successfully` };
      } else {
        throw new BadRequestException('Docker configuration not available');
      }
    } catch (error: any) {
      throw new BadRequestException(`Failed to restart service: ${error.message}`);
    }
  }
}

