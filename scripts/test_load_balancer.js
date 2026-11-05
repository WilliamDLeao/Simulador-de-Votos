// ==============================================================================
// Script de Validação de Balanceamento de Carga e Latência (Node.js)
// Uso:
//   node scripts/test_load_balancer.js [total] [concorrencia] [url]
//
// Exemplos:
//   node scripts/test_load_balancer.js 20          (20 requisições sequenciais)
//   node scripts/test_load_balancer.js 50 10       (50 requisições, 10 simultâneas)
//   node scripts/test_load_balancer.js 100 20      (100 requisições, 20 simultâneas)
// ==============================================================================
const http = require('http');
const { performance } = require('perf_hooks');

// Parseamento flexível de argumentos
const argTotal = process.argv[2];
let argConcorrencia = process.argv[3];
let argUrl = process.argv[4];

// Compatibilidade: se o 2º argumento for uma URL (ex: http://...), ele é a URL
if (argConcorrencia && argConcorrencia.startsWith('http')) {
    argUrl = argConcorrencia;
    argConcorrencia = '1';
}

const TOTAL_REQUISICOES = parseInt(argTotal, 10) || 10;
const CONCORRENCIA = Math.max(1, parseInt(argConcorrencia, 10) || 1);
const URL_ALVO = argUrl || 'http://localhost:80/';

console.log('='.repeat(78));
console.log('🚀 SIMULADOR DE CARGA E BENCHMARK DE LATÊNCIA — NGINX');
console.log(`• URL Alvo:         ${URL_ALVO}`);
console.log(`• Total de Carga:   ${TOTAL_REQUISICOES} requisições`);
console.log(`• Concorrência:     ${CONCORRENCIA} simultânea(s)`);
console.log('='.repeat(78));

const estatisticas = {
    contagem: {},
    latencias: [],
    latenciasPorInstancia: {},
    erros: 0
};

function formatMs(ms) {
    return ms < 10 ? ms.toFixed(2) : ms.toFixed(1);
}

function calcularEstatisticas(lista) {
    if (lista.length === 0) return { min: 0, max: 0, media: 0, p50: 0, p95: 0 };
    const ordenadas = [...lista].sort((a, b) => a - b);
    const soma = ordenadas.reduce((acc, val) => acc + val, 0);
    const media = soma / ordenadas.length;
    const min = ordenadas[0];
    const max = ordenadas[ordenadas.length - 1];
    const p50 = ordenadas[Math.floor(ordenadas.length * 0.50)];
    const p95 = ordenadas[Math.min(ordenadas.length - 1, Math.floor(ordenadas.length * 0.95))];
    return { min, max, media, p50, p95 };
}

function fazerRequisicao(index) {
    return new Promise((resolve) => {
        const tInicio = performance.now();

        const req = http.get(URL_ALVO, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const latencia = performance.now() - tInicio;
                try {
                    const json = JSON.parse(data);
                    const instancia = json.processadoPor?.instancia || 'Desconhecida';
                    const hostname = json.processadoPor?.hostname || 'N/A';

                    estatisticas.contagem[instancia] = (estatisticas.contagem[instancia] || 0) + 1;
                    estatisticas.latencias.push(latencia);

                    if (!estatisticas.latenciasPorInstancia[instancia]) {
                        estatisticas.latenciasPorInstancia[instancia] = [];
                    }
                    estatisticas.latenciasPorInstancia[instancia].push(latencia);

                    console.log(
                        `[Req #${String(index).padStart(3, '0')}] ` +
                        `Status: ${res.statusCode} | ` +
                        `Respondido por: ${instancia.padEnd(12)} | ` +
                        `Container: ${hostname.slice(0, 8)} | ` +
                        `Latência: ${formatMs(latencia).padStart(6)} ms`
                    );
                } catch {
                    estatisticas.erros++;
                    console.log(`[Req #${index}] Resposta JSON inválida (Latência: ${formatMs(latencia)} ms)`);
                }
                resolve();
            });
        });

        req.on('error', (err) => {
            const latencia = performance.now() - tInicio;
            estatisticas.erros++;
            console.error(`[Req #${index}] Erro: ${err.message} (${formatMs(latencia)} ms)`);
            resolve();
        });

        req.setTimeout(8000, () => {
            req.destroy();
            estatisticas.erros++;
            console.error(`[Req #${index}] Timeout de 8s atingido`);
            resolve();
        });
    });
}

// Pool concorrente: executa até N requisições simultâneas por vez
async function executar() {
    const tGeralInicio = performance.now();
    let indiceAtual = 1;

    async function worker() {
        while (indiceAtual <= TOTAL_REQUISICOES) {
            const id = indiceAtual++;
            await fazerRequisicao(id);
        }
    }

    // Lança workers em paralelo até atingir o limite de concorrência
    const workers = [];
    const poolSize = Math.min(CONCORRENCIA, TOTAL_REQUISICOES);
    for (let i = 0; i < poolSize; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    const tGeralTotal = performance.now() - tGeralInicio;
    const statsGerais = calcularEstatisticas(estatisticas.latencias);
    const totalSucessos = estatisticas.latencias.length;
    const rps = totalSucessos > 0 ? (totalSucessos / (tGeralTotal / 1000)).toFixed(1) : 0;

    console.log('\n' + '='.repeat(78));
    console.log('📊 RESUMO DO BALANCEAMENTO E PERFORMANCE');
    console.log('='.repeat(78));
    console.log(`• Tempo total do teste:    ${(tGeralTotal / 1000).toFixed(2)} segundos`);
    console.log(`• Vazão (Throughput):      ${rps} requisições/segundo`);
    console.log(`• Requisições com sucesso: ${totalSucessos} de ${TOTAL_REQUISICOES}`);
    if (estatisticas.erros > 0) {
        console.log(`• Falhas / Erros:          ${estatisticas.erros}`);
    }

    console.log('\n⚖️  DISTRIBUIÇÃO DE CARGA ENTRE AS INSTÂNCIAS:');
    for (const [instancia, qtd] of Object.entries(estatisticas.contagem)) {
        const pct = ((qtd / totalSucessos) * 100).toFixed(1);
        const statsInstancia = calcularEstatisticas(estatisticas.latenciasPorInstancia[instancia] || []);
        console.log(
            `  * ${instancia.padEnd(14)}: ${String(qtd).padStart(3)} reqs (${pct.padStart(5)}%) | ` +
            `Latência Média: ${formatMs(statsInstancia.media)} ms (Min: ${formatMs(statsInstancia.min)} ms / Max: ${formatMs(statsInstancia.max)} ms)`
        );
    }

    console.log('\n⏱️  MÉTRICAS GERAIS DE LATÊNCIA (Resposta do Nginx):');
    console.log(`  * Mínima:  ${formatMs(statsGerais.min)} ms`);
    console.log(`  * Média:   ${formatMs(statsGerais.media)} ms`);
    console.log(`  * P50 (Mediana): ${formatMs(statsGerais.p50)} ms`);
    console.log(`  * P95:     ${formatMs(statsGerais.p95)} ms`);
    console.log(`  * Máxima:  ${formatMs(statsGerais.max)} ms`);
    console.log('='.repeat(78) + '\n');
}

executar();
