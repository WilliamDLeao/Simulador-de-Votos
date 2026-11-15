# =============================================================================
# DEMO DE RESILIENCIA E PERSISTENCIA — SQUAD 3
# Simulador de Votos — Pratica 1 — Sistemas Operacionais Modernos
# =============================================================================
# Uso:
#   Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope Process
#   .\scripts\demo_resiliencia.ps1
# =============================================================================

$BaseUrl     = "http://localhost"
$ContainerDB = "db_postgres"
$SEP         = "=" * 70
$SEP2        = "-" * 70

# =============================================================================
# FUNCOES AUXILIARES
# =============================================================================

function Escreve-Passo($num, $titulo) {
    Write-Host ""
    Write-Host $SEP -ForegroundColor Cyan
    Write-Host " PASSO $num -- $titulo" -ForegroundColor Cyan
    Write-Host $SEP -ForegroundColor Cyan
}

function Consulta-Apuracao($label) {
    $uri = "$BaseUrl/apuracao"
    try {
        $r = Invoke-RestMethod -Uri $uri -Method GET -TimeoutSec 5
        Write-Host ""
        Write-Host "  [$label] Total de votos: $($r.totalVotosGeral)" -ForegroundColor Yellow
        foreach ($c in $r.apuracao) {
            $linha = "  * #" + $c.numero + "  " + $c.nome + "  -->  " + $c.total_votos + " votos (" + $c.percentual + ")"
            Write-Host $linha -ForegroundColor White
        }
        return $r
    } catch {
        Write-Host "  [$label] ERRO: API nao respondeu (banco offline)" -ForegroundColor Red
        return $null
    }
}

function Registra-Voto($numeroCandidato) {
    $uri  = "$BaseUrl/votar"
    $body = '{"numero":' + $numeroCandidato + '}'
    try {
        $r = Invoke-RestMethod -Uri $uri -Method POST -ContentType "application/json" -Body $body -TimeoutSec 5
        if ($r.sucesso) {
            $instancia = $r.processadoPor.instancia
            $total     = $r.candidato.totalVotosAtualizado
            Write-Host "  [OK] Candidato #$numeroCandidato aceito | Total: $total | Via: $instancia" -ForegroundColor Green
            return $true
        }
    } catch {
        Write-Host "  [ERRO] Falha ao votar no candidato #$numeroCandidato" -ForegroundColor Red
    }
    return $false
}

# =============================================================================
# INICIO DA DEMO
# =============================================================================

Write-Host ""
Write-Host $SEP -ForegroundColor Magenta
Write-Host " DEMO -- ISOLAMENTO DE ARMAZENAMENTO COM DOCKER VOLUME" -ForegroundColor Magenta
Write-Host " Squad 3: Banco e Resiliencia | Simulador de Votos" -ForegroundColor Magenta
Write-Host $SEP -ForegroundColor Magenta

# -----------------------------------------------------------------------------
# PASSO 0 — Containers ativos
# -----------------------------------------------------------------------------
Escreve-Passo "0" "Verificando estado inicial dos containers"
docker ps --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}"

# -----------------------------------------------------------------------------
# PASSO 1 — Inspecionar volume
# -----------------------------------------------------------------------------
Escreve-Passo "1" "Inspecionando o Docker Volume 'pgdata'"
Write-Host ""
Write-Host "  Detalhes fisicos do volume (onde os dados ficam no HD):" -ForegroundColor Green
docker volume inspect pgdata

# -----------------------------------------------------------------------------
# PASSO 2 — Apuracao inicial
# -----------------------------------------------------------------------------
Escreve-Passo "2" "Apuracao ANTES dos votos de teste"
$antes = Consulta-Apuracao "ESTADO_INICIAL"

# -----------------------------------------------------------------------------
# PASSO 3 — Inserir votos de teste
# -----------------------------------------------------------------------------
Escreve-Passo "3" "Inserindo votos de teste via API"

$votosOk = 0
$candidatos = @(10, 10, 20, 10, 99)
foreach ($num in $candidatos) {
    $ok = Registra-Voto $num
    if ($ok) { $votosOk++ }
    Start-Sleep -Milliseconds 300
}
Write-Host ""
Write-Host "  Votos inseridos com sucesso: $votosOk de $($candidatos.Count)" -ForegroundColor Yellow

# -----------------------------------------------------------------------------
# PASSO 4 — Apuracao depois dos votos
# -----------------------------------------------------------------------------
Escreve-Passo "4" "Apuracao APOS os votos (confirmando gravacao no banco)"
$depoisDeInserir = Consulta-Apuracao "APOS_VOTOS"
$totalAntes = 0
if ($depoisDeInserir) {
    $totalAntes = $depoisDeInserir.totalVotosGeral
}

# -----------------------------------------------------------------------------
# PASSO 5 — Arquivos fisicos do PostgreSQL
# -----------------------------------------------------------------------------
Escreve-Passo "5" "Verificando arquivos fisicos dentro do volume"
Write-Host ""
Write-Host "  Listando /var/lib/postgresql/data dentro do container:" -ForegroundColor Green
docker exec $ContainerDB ls -lh /var/lib/postgresql/data

# -----------------------------------------------------------------------------
# PASSO 6 — DOCKER STOP (simula falha)
# -----------------------------------------------------------------------------
Escreve-Passo "6" "SIMULANDO FALHA: docker stop $ContainerDB"
Write-Host ""
Write-Host "  >>> Derrubando o container do banco agora..." -ForegroundColor Red
docker stop $ContainerDB
Write-Host "  >>> Container $ContainerDB PARADO." -ForegroundColor Red

Start-Sleep -Seconds 2

# -----------------------------------------------------------------------------
# PASSO 7 — Comportamento da API com banco offline
# -----------------------------------------------------------------------------
Escreve-Passo "7" "Testando API com banco offline (esperado: erro 503)"
Write-Host ""
Write-Host "  Tentando acessar /apuracao com o banco desligado..." -ForegroundColor Yellow

$respostaOffline = Consulta-Apuracao "BANCO_OFFLINE"

Write-Host ""
Write-Host "  Resposta HTTP bruta via curl:" -ForegroundColor Green
curl.exe -s -o NUL -w "  HTTP Status Code: %{http_code}" "$BaseUrl/apuracao"
Write-Host ""
curl.exe -s "$BaseUrl/apuracao"
Write-Host ""

# -----------------------------------------------------------------------------
# PASSO 8 — DOCKER START (restauracao)
# -----------------------------------------------------------------------------
Escreve-Passo "8" "RESTAURANDO: docker start $ContainerDB"
Write-Host ""
Write-Host "  >>> Iniciando o container do banco novamente..." -ForegroundColor Green
docker start $ContainerDB
Write-Host "  >>> Aguardando PostgreSQL aceitar conexoes (12 segundos)..." -ForegroundColor Yellow
Start-Sleep -Seconds 12

# -----------------------------------------------------------------------------
# PASSO 9 — Apuracao apos restauracao
# -----------------------------------------------------------------------------
Escreve-Passo "9" "Apuracao APOS restauracao -- validando persistencia"
$depoisDeRestaurar = Consulta-Apuracao "POS_RESTAURACAO"

# -----------------------------------------------------------------------------
# PASSO 10 — Comparacao dos totais
# -----------------------------------------------------------------------------
Escreve-Passo "10" "Comparacao dos totais e Conclusao"
Write-Host ""
Write-Host $SEP2 -ForegroundColor Cyan
Write-Host " RESULTADO FINAL -- VERIFICACAO DE INTEGRIDADE" -ForegroundColor Cyan
Write-Host $SEP2 -ForegroundColor Cyan

$totalDepois = 0
if ($depoisDeRestaurar) {
    $totalDepois = $depoisDeRestaurar.totalVotosGeral
}

Write-Host ""
Write-Host "  Total de votos ANTES do docker stop : $totalAntes" -ForegroundColor White
Write-Host "  Total de votos APOS  o docker start : $totalDepois" -ForegroundColor White
Write-Host ""

if ($totalAntes -gt 0 -and $totalAntes -eq $totalDepois) {
    Write-Host "  [APROVADO] Nenhum voto foi perdido!" -ForegroundColor Green
    Write-Host "  O Docker Volume 'pgdata' garantiu a persistencia fisica dos dados." -ForegroundColor Green
} elseif ($totalDepois -eq 0) {
    Write-Host "  [ATENCAO] Nao foi possivel confirmar (banco pode ainda estar iniciando)." -ForegroundColor Yellow
    Write-Host "  Aguarde mais alguns segundos e consulte: curl $BaseUrl/apuracao" -ForegroundColor Yellow
} else {
    Write-Host "  [FALHA] Totais divergem -- investigar." -ForegroundColor Red
}

# -----------------------------------------------------------------------------
# PASSO 11 — Consulta SQL direta
# -----------------------------------------------------------------------------
Escreve-Passo "11" "Inspecao SQL direta dentro do container"
Write-Host ""
Write-Host "  Tabela candidatos:" -ForegroundColor Green
docker exec $ContainerDB psql -U postgres -d votacao -c "SELECT numero, nome, partido, total_votos FROM candidatos ORDER BY numero;"

Write-Host ""
Write-Host "  Tabela votos (ultimos 10 registros de auditoria):" -ForegroundColor Green
docker exec $ContainerDB psql -U postgres -d votacao -c "SELECT v.id, c.numero, c.nome, v.instancia_origem, v.criado_em FROM votos v JOIN candidatos c ON c.id = v.candidato_id ORDER BY v.id DESC LIMIT 10;"

# -----------------------------------------------------------------------------
# FIM
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host $SEP -ForegroundColor Magenta
Write-Host " DEMO CONCLUIDA -- Isolamento de armazenamento validado." -ForegroundColor Magenta
Write-Host $SEP -ForegroundColor Magenta
Write-Host ""
