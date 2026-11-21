#!/usr/bin/env bash
# Troca o algoritmo de balanceamento do Nginx sem editar o arquivo na mão.
# Uso: ./scripts/trocar_algoritmo.sh [rr|least_conn|ip_hash]
# Sem argumento, mostra um menu.

CONF="$(dirname "$0")/../nginx/nginx.conf"
CONTAINER="proxy_nginx"

if [ -z "$1" ]; then
  echo "Escolha o algoritmo:"
  echo "  1) Round Robin"
  echo "  2) Least Connections"
  echo "  3) IP Hash"
  read -rp "Opção: " op
  case "$op" in
    1) escolha="rr" ;;
    2) escolha="least_conn" ;;
    3) escolha="ip_hash" ;;
    *) echo "Opção inválida"; exit 1 ;;
  esac
else
  escolha="$1"
fi

case "$escolha" in
  rr)         linha="" ;;
  least_conn) linha="least_conn;" ;;
  ip_hash)    linha="ip_hash;" ;;
  *) echo "Algoritmo inválido: $escolha (use rr, least_conn ou ip_hash)"; exit 1 ;;
esac

# Edita uma cópia temporária e grava de volta com "cat >", que preserva o inode.
# (sed -i troca o inode e o bind mount do Docker continuaria vendo o arquivo antigo.)
TMP="$(mktemp)"
sed -E '/^[[:space:]]*(least_conn|ip_hash);/d' "$CONF" > "$TMP"

# Insere o novo logo depois da abertura do upstream (Round Robin = nada)
if [ -n "$linha" ]; then
  sed -i "/upstream simulador_votacao {/a\\        $linha" "$TMP"
fi

cat "$TMP" > "$CONF"
rm -f "$TMP"

echo "Algoritmo definido: $escolha"

# Valida e recarrega
if docker exec "$CONTAINER" nginx -t && docker exec "$CONTAINER" nginx -s reload; then
  echo "Nginx recarregado."
  docker exec "$CONTAINER" nginx -T 2>/dev/null | grep -A3 "upstream simulador_votacao"
else
  echo "Erro ao recarregar. Confira o nginx.conf."
  exit 1
fi
