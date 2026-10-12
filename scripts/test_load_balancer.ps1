
param(
    [int]$TotalRequisicoes = 10,
    [string]$Url = "http://localhost:80"
)

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "Iniciando teste de balanceamento de carga no Nginx" -ForegroundColor Cyan
Write-Host "Alvo: $Url | Total de Requisições: $TotalRequisicoes" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

$contagemInstancias = @{}

for ($i = 1; $i -le $TotalRequisicoes; $i++) {
    try {
        $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 5
        $instancia = $response.processadoPor.instancia
        $hostname = $response.processadoPor.hostname

        if (-not $contagemInstancias.ContainsKey($instancia)) {
            $contagemInstancias[$instancia] = 0
        }
        $contagemInstancias[$instancia]++

        Write-Host "[$i/$TotalRequisicoes] Processado por: $instancia (Host: $hostname)" -ForegroundColor Green
    }
    catch {
        Write-Host "[$i/$TotalRequisicoes] Falha ao conectar: $_" -ForegroundColor Red
    }
    Start-Sleep -Milliseconds 150
}

Write-Host "`n----------------------------------------------------------------------" -ForegroundColor Yellow
Write-Host "Resumo da Distribuicao de Carga:" -ForegroundColor Yellow
foreach ($instancia in $contagemInstancias.Keys) {
    $qtd = $contagemInstancias[$instancia]
    $pct = [math]::Round(($qtd / $TotalRequisicoes) * 100, 1)
    Write-Host "- $instancia : $qtd requisicoes ($pct%)" -ForegroundColor Yellow
}
Write-Host "----------------------------------------------------------------------" -ForegroundColor Yellow
