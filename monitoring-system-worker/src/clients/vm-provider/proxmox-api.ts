import axios from 'axios';
import * as https from 'https';
import { VmProvider, VmState, normalizeStatus } from './types';
import { log } from '../../logger';

export interface ProxmoxApiConfig {
  url: string;
  tokenId: string;
  tokenSecret: string;
  rejectUnauthorized: boolean;
}

/**
 * Proxmox VE pela API HTTP, com API Token (não usuário/senha: token não expira e
 * pode ser limitado a PVEAuditor, que é tudo que este worker precisa).
 *
 * /cluster/resources?type=vm devolve QEMU e LXC do cluster inteiro numa chamada --
 * mais barato que um GET por nó.
 */
export class ProxmoxApiProvider implements VmProvider {
  readonly name = 'proxmox-api';

  constructor(private readonly config: ProxmoxApiConfig) {}

  async listVms(): Promise<VmState[]> {
    try {
      const response = await axios.get(`${this.config.url}/api2/json/cluster/resources`, {
        params: { type: 'vm' },
        headers: {
          Authorization: `PVEAPIToken=${this.config.tokenId}=${this.config.tokenSecret}`,
        },
        timeout: 10000,
        // O Proxmox costuma usar certificado autoassinado no parque interno.
        httpsAgent: new https.Agent({ rejectUnauthorized: this.config.rejectUnauthorized }),
      });

      const data: any[] = response.data?.data || [];

      return data.map((item) => ({
        providerId: String(item.vmid ?? item.id ?? ''),
        name: item.name || String(item.vmid ?? ''),
        status: normalizeStatus(String(item.status || '')),
        raw: `${item.type || 'vm'}/${item.vmid}=${item.status}`,
      }));
    } catch (err: any) {
      log.error(`[VM] proxmox-api: falha ao consultar ${this.config.url}: ${err.message}`);
      return [];
    }
  }
}
