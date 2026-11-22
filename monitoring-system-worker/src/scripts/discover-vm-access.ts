/**
 * Descoberta de acesso à camada de gerenciamento.
 *
 * Roda a mesma sondagem que o worker faz em VM_PROVIDER=auto, mas imprimindo o que
 * encontrou -- serve para responder "que acesso a gente realmente tem?" sem precisar
 * subir o worker nem adivinhar.
 *
 *   npm run discover:vms
 */
import * as dotenv from 'dotenv';
import { getDefaultSSHConfig, execSSHCommandRaw } from '../clients/docker-ssh';
import { detectProvider, getVmProvider, resetVmProviderCache } from '../clients/vm-provider';
import { vmConfig } from '../config/vm-config';

dotenv.config({ quiet: true });

const line = (s = '') => console.log(s);

async function main() {
  line('=== Descoberta de acesso ao hypervisor ===');
  line();

  const ssh = getDefaultSSHConfig();

  if (!ssh) {
    line('✗ DOCKER_SSH_HOST/DOCKER_SSH_USERNAME não configurados.');
    line('  Sem SSH, só resta a API do Proxmox (PROXMOX_API_*) ou ping/TCP + heartbeat.');
  } else {
    line(`→ SSH: ${ssh.username}@${ssh.host}:${ssh.port || 22}`);

    try {
      const uname = await execSSHCommandRaw(ssh, 'uname -a; systemd-detect-virt 2>/dev/null || true');
      line(`  Host: ${uname.trim().split('\n').join(' | ')}`);
    } catch (err: any) {
      line(`✗ Não foi possível executar comando via SSH: ${err.message}`);
      line('  Verifique DOCKER_SSH_PASSWORD / DOCKER_SSH_PRIVATE_KEY.');
      return;
    }

    const detection = await detectProvider(ssh);
    line(`  Detectado: ${detection.kind} — ${detection.reason}`);
  }

  line();
  line(`VM_PROVIDER configurado: ${vmConfig.provider}`);
  line(`PROXMOX_API_URL: ${vmConfig.proxmoxApi.url || '(vazio)'}`);
  line();

  resetVmProviderCache();
  const provider = await getVmProvider();
  line(`Provider efetivo: ${provider.name}`);

  const vms = await provider.listVms();
  if (vms.length === 0) {
    line('Nenhuma VM listada. O monitoramento vai depender de ping/TCP + heartbeat.');
  } else {
    line(`${vms.length} VM(s) encontradas:`);
    line();
    line('  PROVIDER_ID   STATUS      NOME');
    for (const vm of vms) {
      line(`  ${vm.providerId.padEnd(13)} ${vm.status.padEnd(11)} ${vm.name || ''}`);
    }
    line();
    line('Use PROVIDER_ID em monitoring.vms.provider_id para casar cada VM cadastrada.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Falha na descoberta:', err.message);
    process.exit(1);
  });
