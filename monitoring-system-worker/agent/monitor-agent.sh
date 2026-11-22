#!/usr/bin/env bash
#
# Agente de heartbeat do monitoring-system — Linux.
#
# Envia hostname + uso de disco para o worker a cada execução. Rode via cron a
# cada 5 minutos:
#
#   */5 * * * * /opt/monitoring/monitor-agent.sh >> /var/log/monitor-agent.log 2>&1
#
# Configuração por ambiente (ou editando os defaults abaixo):
#   MONITOR_URL    URL do endpoint  (ex: http://10.10.10.223:5080/monitor/heartbeat)
#   MONITOR_TOKEN  token do worker  (MONITOR_HEARTBEAT_TOKEN)
#   MONITOR_HOSTNAME  sobrescreve o hostname (precisa bater com monitoring.vms.hostname)
#
# Sem dependência de jq: o JSON é montado à mão, porque instalar jq em toda VM do
# parque é justamente o tipo de atrito que faz o agente não ser instalado.

set -uo pipefail

# Sem default: o token vai no header, e um destino padrao embutido mandaria a
# credencial para um host que talvez nao seja o certo (ou nem exista mais) se a
# variavel faltar. Prefira https:// quando o trafego sair da rede interna.
MONITOR_URL="${MONITOR_URL:-}"
MONITOR_TOKEN="${MONITOR_TOKEN:-}"
MONITOR_HOSTNAME="${MONITOR_HOSTNAME:-$(hostname)}"
MONITOR_TIMEOUT="${MONITOR_TIMEOUT:-15}"

# Tipos de filesystem a ignorar: pseudo-FS e montagens de container não são disco
# real e só poluiriam a série da projeção.
EXCLUDE_FS_TYPES="tmpfs,devtmpfs,squashfs,overlay,aufs,proc,sysfs,cgroup,cgroup2,devpts,iso9660,ramfs,fuse.gvfsd-fuse,nsfs,tracefs,debugfs,mqueue,hugetlbfs,configfs,pstore,securityfs,binfmt_misc,autofs,efivarfs,fusectl"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ -z "$MONITOR_URL" ]; then
  log "ERRO: MONITOR_URL não definido (ex: https://monitor.interno/monitor/heartbeat)."
  exit 1
fi

if [ -z "$MONITOR_TOKEN" ]; then
  log "ERRO: MONITOR_TOKEN não definido."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  log "ERRO: curl não encontrado."
  exit 1
fi

# Escapa o que quebraria o JSON: barra invertida, aspas e caracteres de controle.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' | tr -d '\000-\010\013\014\016-\037'
}

# df -P  -> uma linha por FS, sem quebrar nomes longos (o -P é o que garante isso).
# -B1    -> bytes, para converter para GB aqui e não depender do bloco do sistema.
# -x     -> exclui um tipo de FS por flag; o loop monta as flags a partir da lista.
exclude_flags=()
IFS=',' read -ra types <<< "$EXCLUDE_FS_TYPES"
for t in "${types[@]}"; do
  exclude_flags+=("-x" "$t")
done

disks_json=""
while read -r _fs total used _avail _pct mount; do
  # Pula o cabeçalho e linhas sem número.
  case "$total" in
    ''|*[!0-9]*) continue ;;
  esac
  [ -z "$mount" ] && continue
  [ "$total" -le 0 ] && continue

  # bytes -> GB com 2 casas, via awk (bash não faz ponto flutuante).
  total_gb=$(awk -v b="$total" 'BEGIN { printf "%.2f", b / 1073741824 }')
  used_gb=$(awk -v b="$used"  'BEGIN { printf "%.2f", b / 1073741824 }')

  esc_mount=$(json_escape "$mount")
  entry="{\"mount\":\"${esc_mount}\",\"totalGb\":${total_gb},\"usedGb\":${used_gb}}"

  if [ -z "$disks_json" ]; then
    disks_json="$entry"
  else
    disks_json="${disks_json},${entry}"
  fi
done < <(df -P -B1 "${exclude_flags[@]}" 2>/dev/null | tail -n +2)

if [ -z "$disks_json" ]; then
  log "AVISO: nenhum filesystem elegível encontrado; enviando heartbeat sem discos."
fi

esc_hostname=$(json_escape "$MONITOR_HOSTNAME")
payload="{\"hostname\":\"${esc_hostname}\",\"disks\":[${disks_json}]}"

# -sS: silencioso, mas mostra erro. --fail-with-body dá exit != 0 em 4xx/5xx e
# ainda imprime o corpo, que é onde o worker explica o motivo (ex: host não cadastrado).
response=$(curl -sS --fail-with-body \
  --max-time "$MONITOR_TIMEOUT" \
  -X POST "$MONITOR_URL" \
  -H "Authorization: Bearer ${MONITOR_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$payload" 2>&1)
status=$?

if [ $status -eq 0 ]; then
  log "OK: heartbeat enviado ($MONITOR_HOSTNAME) — $response"
else
  log "ERRO ($status) ao enviar heartbeat: $response"
fi

exit $status
