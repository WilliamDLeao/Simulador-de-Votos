#!/usr/bin/env node
// ==============================================================================
// SIMULADOR DE ATAQUE DDoS — USO EXCLUSIVO EM LABORATÓRIO / INFRAESTRUTURA PRÓPRIA
// ------------------------------------------------------------------------------
// Objetivo: demonstrar em sala o esgotamento de conexões do proxy e a degradação
//           da API sob carga extrema, gerando tráfego HTTP GET / a partir de
//           duas ou mais máquinas atacantes.
//
// Uso:
//   node scripts/demo_ddos_local.js [duracao_s] [workers] [url] [conexoes/worker] --confirm-local-lab
//
// Padrões: duracao=30s, workers=4, url=http://localhost:80/, conexoes=100
// Exemplo (um atacante):
//   node scripts/demo_ddos_local.js 45 8 http://192.168.1.10 150 --confirm-local-lab
// Exemplo (segundo atacante, ao mesmo tempo, na outra máquina):
//   node scripts/demo_ddos_local.js 45 8 http://192.168.1.10 150 --confirm-local-lab
//
// SALVAGUARDAS:
//   - exige a flag --confirm-local-lab (evita disparo acidental);
//   - aceita somente localhost, 127.0.0.1, ::1 ou IPs privados (RFC1918);
//   - duração máxima de 120 s e limites de workers/conexões;
//   - usa apenas GET / (não injeta votos no banco de dados).
//
// Durante o teste, em OUTRO terminal do servidor, acompanhe:
//   docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
//   docker exec proxy_nginx tail -f /var/log/nginx/error.log
//   curl -m 3 -o /dev/null -w 'HTTP %{http_code}\n' http://localhost/
// ==============================================================================

const http = require('http');
const { isMainThread, parentPort, workerData, Worker } = require('worker_threads');
const { performance } = require('perf_hooks');

const FLAG_CONFIRMACAO = '--confirm-local-lab';

function alvoPermitido(hostname) {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h === '::1') return true;

    const o = h.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (o[0] === 127 || o[0] === 10) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    return false;
}

// ------------------------------------------------------------------------------
// WORKER: mantém N conexões HTTP keep-alive ocupadas até o prazo final.
// ------------------------------------------------------------------------------
function executarWorker() {
    const { url, deadline, conexoes, id } = workerData;
    const destino = new URL(url);
    const agent = new http.Agent({ keepAlive: true, maxSockets: conexoes, maxFreeSockets: 16 });

    const stats = {
        id,
        enviadas: 0,
        sucesso: 0,
        erros: 0,
        somaLatencia: 0,
        maxLatencia: 0,
        status: {}
    };

    const opcoes = {
        hostname: destino.hostname,
        port: destino.port || 80,
        path: (destino.pathname || '/') + (destino.search || ''),
        method: 'GET',
        agent,
        headers: { Connection: 'Keep-Alive' }
    };

    let emVoo = 0;

    function aoTerminar(latencia, codigo, falhou) {
        emVoo--;
        stats.enviadas++;
        if (falhou) {
            stats.erros++;
        } else {
            stats.sucesso++;
            stats.somaLatencia += latencia;
            if (latencia > stats.maxLatencia) stats.maxLatencia = latencia;
            stats.status[codigo] = (stats.status[codigo] || 0) + 1;
        }
        if (performance.now() < deadline) setImmediate(preencher);
    }

    function preencher() {
        while (emVoo < conexoes && performance.now() < deadline) {
            emVoo++;
            const inicio = performance.now();
            const req = http.request(opcoes, (res) => {
                const latencia = performance.now() - inicio;
                res.resume();
                aoTerminar(latencia, res.statusCode, false);
            });
            req.on('error', () => aoTerminar(0, null, true));
            req.setTimeout(3000, () => req.destroy(new Error('timeout')));
            req.end();
        }
    }

    preencher();
    setTimeout(() => {
        agent.destroy();
        parentPort.postMessage(stats);
    }, Math.max(0, deadline - performance.now()) + 800);
}

// ------------------------------------------------------------------------------
// PROCESSO PRINCIPAL: valida os parâmetros, lança os workers e agrega os dados.
// ------------------------------------------------------------------------------
function main() {
    const args = process.argv.slice(2);
    const confirmado = args.includes(FLAG_CONFIRMACAO);
    const pos = args.filter((a) => a !== FLAG_CONFIRMACAO);

    const duracao = Math.min(120, Math.max(1, parseInt(pos[0], 10) || 30));
    const workers = Math.min(32, Math.max(1, parseInt(pos[1], 10) || 4));
    const url = pos[2] || 'http://localhost:80/';
    const conexoes = Math.min(500, Math.max(1, parseInt(pos[3], 10) || 100));

    let destino;
    try {
        destino = new URL(url);
    } catch {
        console.error('URL inválida.');
        process.exit(1);
    }
    if (!['http:', 'https:'].includes(destino.protocol)) {
        console.error('Use http:// ou https://.');
        process.exit(1);
    }
    if (!alvoPermitido(destino.hostname)) {
        console.error(`ALVO BLOQUEADO: "${destino.hostname}" não é localhost nem IP privado (RFC1918).`);
        console.error('Este script só pode ser usado contra infraestrutura própria de laboratório.');
        process.exit(1);
    }
    if (!confirmado) {
        console.error('AVISO: este script simula um ataque DDoS contra o alvo informado.');
        console.error('Use APENAS em rede isolada de laboratório, com permissão do professor');
        console.error('e contra containers que você mesmo hospeda. Nunca aponte para IPs públicos.');
        console.error(`Para prosseguir, adicione a flag ${FLAG_CONFIRMACAO} ao comando.`);
        process.exit(1);
    }

    const totalConexoes = workers * conexoes;
    console.log('='.repeat(76));
    console.log('SIMULADOR DE ATAQUE DDoS LOCAL — DEMONSTRAÇÃO EM SALA');
    console.log('='.repeat(76));
    console.log(`• Alvo autorizado:  ${url} (rede local/privada)`);
    console.log(`• Duração:          ${duracao} s`);
    console.log(`• Workers:          ${workers}`);
    console.log(`• Conexões/worker:  ${conexoes} (total ≈ ${totalConexoes})`);
    console.log('• Acompanhe no servidor: docker stats / logs do proxy');
    console.log('='.repeat(76) + '\n');

    const deadline = performance.now() + duracao * 1000;
    const agregado = { enviadas: 0, sucesso: 0, erros: 0, somaLatencia: 0, maxLatencia: 0, status: {} };
    let concluidos = 0;

    function finalizar() {
        const tempo = duracao;
        console.log('\n' + '='.repeat(76));
        console.log('FIM DO TESTE DE CARGA');
        console.log('='.repeat(76));
        console.log(`• Requisições enviadas: ${agregado.enviadas}`);
        console.log(`• Sucesso / falhas:     ${agregado.sucesso} / ${agregado.erros}`);
        console.log(`• Vazão média:          ${(agregado.enviadas / tempo).toFixed(1)} req/s`);
        console.log(`• Latência média:       ${(agregado.somaLatencia / (agregado.sucesso || 1)).toFixed(1)} ms`);
        console.log(`• Latência máxima:      ${agregado.maxLatencia.toFixed(1)} ms`);
        console.log('• Códigos HTTP:         ' + JSON.stringify(agregado.status));
        console.log('\nVerifique a recuperação:');
        console.log('  docker compose ps');
        console.log("  curl -m 3 -o /dev/null -w 'HTTP %{http_code}\\n' http://localhost/");
        console.log('  docker compose restart nginx   # se o proxy não voltar');
        console.log('='.repeat(76) + '\n');
    }

    for (let i = 1; i <= workers; i++) {
        const w = new Worker(__filename, { workerData: { url, deadline, conexoes, id: i } });
        w.on('message', (s) => {
            agregado.enviadas += s.enviadas;
            agregado.sucesso += s.sucesso;
            agregado.erros += s.erros;
            agregado.somaLatencia += s.somaLatencia;
            agregado.maxLatencia = Math.max(agregado.maxLatencia, s.maxLatencia);
            for (const [codigo, qtd] of Object.entries(s.status)) {
                agregado.status[codigo] = (agregado.status[codigo] || 0) + qtd;
            }
            concluidos++;
            if (concluidos === workers) finalizar();
        });
        w.on('error', (err) => console.error(`[worker ${i}] erro: ${err.message}`));
    }
}

if (isMainThread) {
    main();
} else {
    executarWorker();
}
