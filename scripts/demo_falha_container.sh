#!/usr/bin/env bash
# Derruba UM dos 4 containers e prova que os demais continuam de pé
# e que nenhum voto confirmado é perdido.
#
# Uso: ./scripts/demo_falha_container.sh [container] [votos]
#   container: api_instancia_1 (padrão) | api_instancia_2 | db_postgres | proxy_nginx
#   votos:     quantidade de votos enviados durante a falha (padrão 20)

ALVO="${1:-api_instancia_1}"
VOTOS="${2:-20}"
URL="http://localhost"
DB="db_postgres"
CONTAINERS=(proxy_nginx api_instancia_1 api_instancia_2 db_postgres)

passo() { echo; echo "=== $1 ==="; }

estado() {
  for c in "${CONTAINERS[@]}"; do
    s=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "inexistente")
    printf "  %-18s %s\n" "$c" "$s"
  done
}

total_votos() {
  # soma do contador e quantidade de linhas na tabela de auditoria
  docker exec "$DB" psql -U postgres -d votacao -tA -c \
    "SELECT COALESCE(SUM(total_votos),0) || '|' || (SELECT COUNT(*) FROM votos) FROM candidatos;" 2>/dev/null
}

aguardar_db() {
  for _ in $(seq 1 30); do
    docker exec "$DB" pg_isready -U postgres -d votacao >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

if ! printf '%s\n' "${CONTAINERS[@]}" | grep -qx "$ALVO"; then
  echo "Container inválido: $ALVO"; echo "Use um de: ${CONTAINERS[*]}"; exit 1
fi

passo "1. Estado inicial dos 4 containers"
estado

passo "2. Contagem de votos ANTES da falha"
ANTES=$(total_votos)
if [ -z "$ANTES" ]; then echo "Não consegui consultar o banco. A stack está no ar?"; exit 1; fi
SOMA_ANTES=${ANTES%%|*}; LINHAS_ANTES=${ANTES##*|}
echo "  Soma dos contadores : $SOMA_ANTES"
echo "  Registros em 'votos': $LINHAS_ANTES"

passo "3. FALHA: docker stop $ALVO"
docker stop "$ALVO" >/dev/null && echo "  $ALVO parado."
estado

passo "4. Enviando $VOTOS votos pelo Nginx com $ALVO fora do ar"
OK=0; FALHA=0; declare -A POR_INSTANCIA
for i in $(seq 1 "$VOTOS"); do
  RESP=$(curl -s -m 8 -w ' HTTP:%{http_code}' -X POST "$URL/votar" \
    -H 'Content-Type: application/json' -d '{"candidato": 10}')
  CODE=${RESP##*HTTP:}
  if [ "$CODE" = "200" ]; then
    OK=$((OK+1))
    INST=$(echo "$RESP" | grep -o '"instancia":"[^"]*"' | head -1 | cut -d'"' -f4)
    POR_INSTANCIA[$INST]=$(( ${POR_INSTANCIA[$INST]:-0} + 1 ))
  else
    FALHA=$((FALHA+1))
  fi
done
echo "  Votos confirmados (HTTP 200): $OK"
echo "  Votos recusados/erro        : $FALHA"
for k in "${!POR_INSTANCIA[@]}"; do echo "  Atendidos por $k: ${POR_INSTANCIA[$k]}"; done

passo "5. Os demais containers continuam rodando?"
estado

passo "6. RECUPERAÇÃO: docker start $ALVO"
docker start "$ALVO" >/dev/null && echo "  $ALVO iniciado."
if [ "$ALVO" = "$DB" ]; then
  echo "  Aguardando o PostgreSQL aceitar conexões..."
  aguardar_db || { echo "  Banco não ficou pronto a tempo."; exit 1; }
else
  sleep 3
fi
estado

passo "7. Contagem de votos DEPOIS"
DEPOIS=$(total_votos)
SOMA_DEPOIS=${DEPOIS%%|*}; LINHAS_DEPOIS=${DEPOIS##*|}
ESPERADO=$((SOMA_ANTES + OK))
ESPERADO_LINHAS=$((LINHAS_ANTES + OK))
echo "  Soma dos contadores : $SOMA_DEPOIS (esperado: $ESPERADO)"
echo "  Registros em 'votos': $LINHAS_DEPOIS (esperado: $ESPERADO_LINHAS)"

passo "RESULTADO"
if [ "$SOMA_DEPOIS" -eq "$ESPERADO" ] && [ "$LINHAS_DEPOIS" -eq "$ESPERADO_LINHAS" ]; then
  echo "  OK: nenhum voto confirmado foi perdido."
else
  echo "  ATENÇÃO: contagem diferente do esperado. Verifique os logs."
  exit 1
fi