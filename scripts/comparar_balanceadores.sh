#!/usr/bin/env bash
# ==============================================================================
# Comparador de algoritmos de balanceamento do Nginx
#
# Alterna o algoritmo no nginx/nginx.conf, recarrega o Nginx sem derrubar o
# container e roda o stress de votação N vezes para cada cenário, gravando os
# resultados em CSV e gerando um resumo com medianas.
#
# Uso:
#   ./scripts/comparar_balanceadores.sh [opções]
#
# Opções:
#   --rodadas <n>        Rodadas por algoritmo                    (padrão: 3)
#   --total <n>          Votos por rodada                         (padrão: 300)
#   --concorrencia <n>   Requisições simultâneas                  (padrão: 20)
#   --candidato <n>      Número do candidato                      (padrão: 10)
#   --url <url>          Endpoint de voto                         (padrão: http://localhost:80/votar)
#   --warmup <n>         Requisições de aquecimento por rodada    (padrão: 5)
#   --algoritmos "..."   Cenários a comparar                      (padrão: "rr least_conn")
#                        Disponíveis: rr, least_conn, ip_hash, weighted
#   --saida <arquivo>    CSV de saída                             (padrão: scripts/resultados/comparacao_<ts>.csv)
#   --ajuda              Mostra esta ajuda
#
# Exemplos:
#   ./scripts/comparar_balanceadores.sh
#   ./scripts/comparar_balanceadores.sh --rodadas 5 --total 500 --concorrencia 40
#   ./scripts/comparar_balanceadores.sh --algoritmos "rr least_conn ip_hash weighted"
#
# Observações:
#   - O nginx.conf original é restaurado automaticamente ao final (trap).
#   - Requer permissão para usar o Docker (ou sudo) e o Node.js instalado.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NGINX_CONF="$ROOT_DIR/nginx/nginx.conf"
STRESS_JS="$SCRIPT_DIR/stress_votacao.js"
RESULT_DIR="$SCRIPT_DIR/resultados"
BACKUP_CONF=""

RODADAS=3
TOTAL=300
CONCORRENCIA=20
CANDIDATO=10
URL="http://localhost:80/votar"
WARMUP=5
ALGORITMOS="rr least_conn"
SAIDA=""

# ------------------------------------------------------------------------------
# Ajuda
# ------------------------------------------------------------------------------
mostrar_ajuda() {
    awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 && !/^#/ { exit }' "${BASH_SOURCE[0]}"
    exit 0
}

# ------------------------------------------------------------------------------
# Argumentos
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --rodadas)        RODADAS="${2:?--rodadas exige um valor}"; shift 2 ;;
        --total)          TOTAL="${2:?--total exige um valor}"; shift 2 ;;
        --concorrencia)   CONCORRENCIA="${2:?--concorrencia exige um valor}"; shift 2 ;;
        --candidato)      CANDIDATO="${2:?--candidato exige um valor}"; shift 2 ;;
        --url)            URL="${2:?--url exige um valor}"; shift 2 ;;
        --warmup)         WARMUP="${2:?--warmup exige um valor}"; shift 2 ;;
        --algoritmos)     ALGORITMOS="${2:?--algoritmos exige um valor}"; shift 2 ;;
        --saida)          SAIDA="${2:?--saida exige um valor}"; shift 2 ;;
        --ajuda|-h|--help) mostrar_ajuda ;;
        *)
            echo "ERRO: argumento desconhecido: $1 (use --ajuda)" >&2
            exit 2
            ;;
    esac
done

# ------------------------------------------------------------------------------
# Pré-condições
# ------------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
    echo "ERRO: Node.js não encontrado no PATH." >&2
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "ERRO: Docker não encontrado no PATH." >&2
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "ERRO: sem acesso ao daemon do Docker." >&2
    echo "      Adicione seu usuário ao grupo 'docker' ou execute com sudo." >&2
    exit 1
fi

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'proxy_nginx'; then
    echo "ERRO: o container 'proxy_nginx' não está rodando." >&2
    echo "      Suba a stack com: docker compose up -d --build" >&2
    exit 1
fi

if [[ ! -f "$NGINX_CONF" ]]; then
    echo "ERRO: arquivo não encontrado: $NGINX_CONF" >&2
    exit 1
fi

mkdir -p "$RESULT_DIR"
if [[ -z "$SAIDA" ]]; then
    SAIDA="$RESULT_DIR/comparacao_$(date +%Y%m%d_%H%M%S).csv"
fi
mkdir -p "$(dirname "$SAIDA")"

# ------------------------------------------------------------------------------
# Restauração da configuração original
# ------------------------------------------------------------------------------
BACKUP_CONF="$(mktemp -t nginx.conf.XXXXXX)"
cp "$NGINX_CONF" "$BACKUP_CONF"

restaurar() {
    if [[ -f "$BACKUP_CONF" ]]; then
        cp "$BACKUP_CONF" "$NGINX_CONF"
        rm -f "$BACKUP_CONF"
    fi
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'proxy_nginx'; then
        docker exec proxy_nginx nginx -t >/dev/null 2>&1 || true
        docker exec proxy_nginx nginx -s reload >/dev/null 2>&1 || true
        echo "↩️  nginx.conf original restaurado e Nginx recarregado."
    else
        echo "↩️  nginx.conf original restaurado (container não estava rodando)."
    fi
}
trap restaurar EXIT
trap 'restaurar; exit 130' INT TERM

# ------------------------------------------------------------------------------
# Manipulação do algoritmo no upstream
# ------------------------------------------------------------------------------
aplicar_algoritmo() {
    local alg="$1"

    # 1) Normaliza qualquer diretiva/comentário de algoritmo para um marcador
    sed -i -E 's,^[[:space:]]*#?[[:space:]]*(least_conn|ip_hash);.*$,        # ALGORITMO,' "$NGINX_CONF"
    sed -i -E 's|^[[:space:]]*#[[:space:]]*ALGORITMO.*$|        # ALGORITMO|' "$NGINX_CONF"
    sed -i -E 's|^[[:space:]]*#[[:space:]]*round-robin.*$|        # ALGORITMO|' "$NGINX_CONF"
    sed -i -E 's|^[[:space:]]*#[[:space:]]*ponderado.*$|        # ALGORITMO|' "$NGINX_CONF"

    # 2) Normaliza as linhas dos servidores (remove weight de execuções anteriores)
    sed -i -E 's|^[[:space:]]*server api1:5000.*$|        server api1:5000 max_fails=3 fail_timeout=5s;|' "$NGINX_CONF"
    sed -i -E 's|^[[:space:]]*server api2:5000.*$|        server api2:5000 max_fails=3 fail_timeout=5s;|' "$NGINX_CONF"

    # 3) Aplica o cenário desejado
    case "$alg" in
        rr)
            sed -i 's|^[[:space:]]*# ALGORITMO$|        # round-robin (padrao do Nginx)|' "$NGINX_CONF"
            ;;
        least_conn)
            sed -i 's|^[[:space:]]*# ALGORITMO$|        least_conn;|' "$NGINX_CONF"
            ;;
        ip_hash)
            sed -i 's|^[[:space:]]*# ALGORITMO$|        ip_hash;|' "$NGINX_CONF"
            ;;
        weighted)
            sed -i 's|^[[:space:]]*# ALGORITMO$|        # ponderado: api1 com peso 3, api2 com peso 1|' "$NGINX_CONF"
            sed -i -E 's|^([[:space:]]*server api1:5000).*$|\1 weight=3 max_fails=3 fail_timeout=5s;|' "$NGINX_CONF"
            sed -i -E 's|^([[:space:]]*server api2:5000).*$|\1 weight=1 max_fails=3 fail_timeout=5s;|' "$NGINX_CONF"
            ;;
        *)
            echo "ERRO: algoritmo desconhecido: $alg" >&2
            return 1
            ;;
    esac

    if grep -qE '^[[:space:]]*# ALGORITMO' "$NGINX_CONF"; then
        echo "ERRO: marcador de algoritmo não foi substituído para '$alg'." >&2
        return 1
    fi

    # 4) Valida e recarrega
    if ! docker exec proxy_nginx nginx -t >/dev/null 2>&1; then
        echo "ERRO: configuração inválida após aplicar '$alg'." >&2
        docker exec proxy_nginx nginx -t >&2 || true
        return 1
    fi
    docker exec proxy_nginx nginx -s reload >/dev/null

    if ! grep -qE '^[[:space:]]*(least_conn|ip_hash);' "$NGINX_CONF" && [[ "$alg" == "least_conn" || "$alg" == "ip_hash" ]]; then
        echo "ERRO: diretiva '$alg' não foi aplicada ao nginx.conf." >&2
        return 1
    fi

    return 0
}

# ------------------------------------------------------------------------------
# Execução
# ------------------------------------------------------------------------------
echo "======================================================================"
echo "⚖️  COMPARADOR DE BALANCEADORES — NGINX"
echo "======================================================================"
echo "• Algoritmos:    $ALGORITMOS"
echo "• Rodadas:       $RODADAS por algoritmo"
echo "• Carga:         $TOTAL votos, concorrência $CONCORRENCIA, candidato $CANDIDATO"
echo "• URL:           $URL"
echo "• CSV de saída:  $SAIDA"
echo "======================================================================"

for alg in $ALGORITMOS; do
    echo ""
    echo "----------------------------------------------------------------------"
    echo "▶ Cenário: $alg"
    echo "----------------------------------------------------------------------"

    if ! aplicar_algoritmo "$alg"; then
        echo "⚠️  Cenário '$alg' ignorado." >&2
        continue
    fi

    for rodada in $(seq 1 "$RODADAS"); do
        echo ""
        echo "  ▶ $alg — rodada $rodada/$RODADAS"
        if ! node "$STRESS_JS" \
            --total "$TOTAL" \
            --concorrencia "$CONCORRENCIA" \
            --candidato "$CANDIDATO" \
            --url "$URL" \
            --warmup "$WARMUP" \
            --cenario "$alg" \
            --csv "$SAIDA" \
            --silencioso; then
            echo "⚠️  Rodada $rodada de '$alg' terminou com inconsistência (veja o relatório acima)." >&2
        fi
        sleep 1
    done
done

echo ""
echo "======================================================================"
echo "✅ Coleta concluída."
echo "======================================================================"

node "$STRESS_JS" --resumo "$SAIDA"

echo "📄 CSV detalhado: $SAIDA"
echo "📄 Resumo:        ${SAIDA%.csv}_resumo.csv"
