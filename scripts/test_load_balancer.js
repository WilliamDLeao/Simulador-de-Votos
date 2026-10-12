// ==============================================================================
// Script de Validação de Balanceamento de Carga (Node.js)
// Execução: node scripts/test_load_balancer.js [totalRequisicoes] [url]
// ==============================================================================
const http = require('http');

const TOTAL_REQUISICOES = parseInt(process.argv[2], 10) || 10;
const URL_ALVO = process.argv[3] || 'http://localhost:80/';

console.log('='.repeat(70));
console.log(`Testando alternância do Nginx em: ${URL_ALVO}`);
console.log(`Disparando ${TOTAL_REQUISICOES} requisições sequenciais...`);
console.log('='.repeat(70));

const contagem = {};

function fazerRequisicao(index) {
    return new Promise((resolve) => {
        const req = http.get(URL_ALVO, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const instancia = json.processadoPor?.instancia || 'Desconhecida';
                    const hostname = json.processadoPor?.hostname || 'N/A';
                    contagem[instancia] = (contagem[instancia] || 0) + 1;
                    console.log(`[Req ${index}/${TOTAL_REQUISICOES}] Respondido por: ${instancia} (Host ID: ${hostname})`);
                } catch {
                    console.log(`[Req ${index}/${TOTAL_REQUISICOES}] Resposta inválida: ${data.slice(0, 40)}`);
                }
                resolve();
            });
        });

        req.on('error', (err) => {
            console.error(`[Req ${index}/${TOTAL_REQUISICOES}] Erro de conexão: ${err.message}`);
            resolve();
        });

        req.setTimeout(5000, () => {
            req.destroy();
            console.error(`[Req ${index}/${TOTAL_REQUISICOES}] Timeout de 5s atingido`);
            resolve();
        });
    });
}

async function executar() {
    for (let i = 1; i <= TOTAL_REQUISICOES; i++) {
        await fazerRequisicao(i);
        await new Promise(r => setTimeout(r, 150));
    }

    console.log('\n' + '-'.repeat(70));
    console.log('RESUMO DO BALANCEAMENTO:');
    for (const [instancia, qtd] of Object.entries(contagem)) {
        const pct = ((qtd / TOTAL_REQUISICOES) * 100).toFixed(1);
        console.log(`* ${instancia}: ${qtd} requisições (${pct}%)`);
    }
    console.log('-'.repeat(70));
}

executar();
