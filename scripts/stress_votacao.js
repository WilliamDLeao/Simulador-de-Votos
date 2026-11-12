#!/usr/bin/env node
// ==============================================================================
// Script de STRESS do caminho de escrita (POST /votar) + verificação de integridade
//
// Diferente do test_load_balancer.js (que só faz GET / e mede alternância), este
// script exercita o banco de dados, que é o gargalo real do sistema, e valida que
// nenhum voto foi perdido ou duplicado sob carga.
//
// Uso:
//   node scripts/stress_votacao.js [opções]
//
// Opções:
//   --total <n>            Total de votos a enviar              (padrão: 200)
//   --concorrencia <n>     Requisições simultâneas              (padrão: 20)
//   --candidato <n>        Número do candidato                 (padrão: 10)
//   --url <url>            Endpoint de voto                     (padrão: http://localhost:80/votar)
//   --warmup <n>           Requisições de aquecimento (GET)     (padrão: 5)
//   --timeout <ms>         Timeout por requisição               (padrão: 10000)
//   --cenario <nome>       Rótulo gravado no CSV                (padrão: stress)
//   --csv <arquivo>        Anexa uma linha de resultado no CSV
//   --keepalive            Reutiliza conexões TCP (Agent keep-alive)
//   --silencioso           Não imprime linha por requisição
//   --derrubar <container> Derruba o container no meio da carga e religa depois
//   --duracao-falha <ms>   Tempo que o container fica parado      (padrão: 6000)
//   --sem-banco            Não consulta a contagem via docker exec
//   --resumo <arquivo.csv> Não executa carga: resume um CSV gerado
//   --ajuda                Mostra esta ajuda
//
// Exemplos:
//   node scripts/stress_votacao.js --total 500 --concorrencia 25
//   node scripts/stress_votacao.js --total 1000 --concorrencia 50 --derrubar api_instancia_2
//   node scripts/stress_votacao.js --resumo scripts/resultados/comparacao.csv
// ==============================================================================
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { performance } = require('perf_hooks');

const CABECALHO_CSV = [
    'timestamp', 'cenario', 'total', 'concorrencia', 'candidato', 'url', 'keepalive',
    'sucessos', 'erros', 'taxa_erro_pct', 'rps',
    'p50_ms', 'p95_ms', 'max_ms',
    'inst1_reqs', 'inst2_reqs', 'inst1_pct', 'inst2_pct',
    'delta_api', 'delta_db', 'integridade', 'eventos_falha'
].join(',');

// ------------------------------------------------------------------------------
// Argumentos
// ------------------------------------------------------------------------------
function parseArgs(argv) {
    const opts = {
        total: 200,
        concorrencia: 20,
        candidato: 10,
        url: 'http://localhost:80/votar',
        warmup: 5,
        timeout: 10000,
        cenario: 'stress',
        csv: null,
        keepalive: false,
        silencioso: false,
        derrubar: null,
        duracaoFalha: 6000,
        semBanco: false,
        resumo: null,
        ajuda: false
    };

    const posicionais = [];

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const valor = () => {
            const v = argv[++i];
            if (v === undefined) {
                console.error(`ERRO: o argumento ${arg} exige um valor.`);
                process.exit(2);
            }
            return v;
        };

        switch (arg) {
            case '--total': opts.total = parseInt(valor(), 10); break;
            case '--concorrencia': opts.concorrencia = parseInt(valor(), 10); break;
            case '--candidato': opts.candidato = parseInt(valor(), 10); break;
            case '--url': opts.url = valor(); break;
            case '--warmup': opts.warmup = parseInt(valor(), 10); break;
            case '--timeout': opts.timeout = parseInt(valor(), 10); break;
            case '--cenario': opts.cenario = valor(); break;
            case '--csv': opts.csv = valor(); break;
            case '--keepalive': opts.keepalive = true; break;
            case '--silencioso': opts.silencioso = true; break;
            case '--derrubar': opts.derrubar = valor(); break;
            case '--duracao-falha': opts.duracaoFalha = parseInt(valor(), 10); break;
            case '--sem-banco': opts.semBanco = true; break;
            case '--resumo': opts.resumo = valor(); break;
            case '--ajuda': case '-h': case '--help': opts.ajuda = true; break;
            default:
                if (arg.startsWith('-')) {
                    console.error(`ERRO: argumento desconhecido: ${arg} (use --ajuda)`);
                    process.exit(2);
                }
                posicionais.push(arg);
        }
    }

    // Compatibilidade com o estilo posicional do test_load_balancer.js
    if (posicionais.length > 0) opts.total = parseInt(posicionais[0], 10);
    if (posicionais.length > 1) opts.concorrencia = parseInt(posicionais[1], 10);

    if (!Number.isInteger(opts.total) || opts.total <= 0) {
        console.error('ERRO: --total deve ser um inteiro maior que zero.');
        process.exit(2);
    }
    if (!Number.isInteger(opts.concorrencia) || opts.concorrencia <= 0) {
        console.error('ERRO: --concorrencia deve ser um inteiro maior que zero.');
        process.exit(2);
    }
    if (!Number.isInteger(opts.candidato)) {
        console.error('ERRO: --candidato deve ser um inteiro.');
        process.exit(2);
    }

    return opts;
}

function imprimirAjuda() {
    const linhas = fs.readFileSync(__filename, 'utf8').split('\n');
    const saida = [];
    for (let i = 1; i < linhas.length; i++) {
        const linha = linhas[i];
        if (linha.startsWith('//')) {
            saida.push(linha.replace(/^\/\/ ?/, ''));
            continue;
        }
        if (linha.trim() === '') {
            saida.push('');
            continue;
        }
        break;
    }
    console.log(saida.join('\n'));
}

// ------------------------------------------------------------------------------
// Utilitários
// ------------------------------------------------------------------------------
function formatMs(ms) {
    return ms < 10 ? ms.toFixed(2) : ms.toFixed(1);
}

function sanitizar(valor) {
    return String(valor ?? '').replace(/[\r\n,]+/g, ' ').trim();
}

function calcularEstatisticas(lista) {
    if (lista.length === 0) return { min: 0, max: 0, media: 0, p50: 0, p95: 0 };
    const ordenadas = [...lista].sort((a, b) => a - b);
    const soma = ordenadas.reduce((acc, val) => acc + val, 0);
    return {
        min: ordenadas[0],
        max: ordenadas[ordenadas.length - 1],
        media: soma / ordenadas.length,
        p50: ordenadas[Math.floor(ordenadas.length * 0.50)],
        p95: ordenadas[Math.min(ordenadas.length - 1, Math.floor(ordenadas.length * 0.95))]
    };
}

function mediana(lista) {
    if (lista.length === 0) return 0;
    const ordenadas = [...lista].sort((a, b) => a - b);
    const meio = Math.floor(ordenadas.length / 2);
    return ordenadas.length % 2 === 0
        ? (ordenadas[meio - 1] + ordenadas[meio]) / 2
        : ordenadas[meio];
}

function urlApuracaoDe(urlVotar) {
    const u = new URL(urlVotar);
    u.pathname = /\/votar\/?$/.test(u.pathname)
        ? u.pathname.replace(/\/votar\/?$/, '/apuracao')
        : '/apuracao';
    return u;
}

// ------------------------------------------------------------------------------
// Cliente HTTP
// ------------------------------------------------------------------------------
function criarCliente(opts) {
    const agente = opts.keepalive
        ? new http.Agent({ keepAlive: true, maxSockets: opts.concorrencia })
        : undefined;

    return function requisicao(urlObj, metodo, corpo) {
        return new Promise((resolve) => {
            let finalizado = false;
            const finalizar = (resultado) => {
                if (finalizado) return;
                finalizado = true;
                resolve(resultado);
            };

            const payload = corpo ? JSON.stringify(corpo) : null;
            const porta = urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80);
            const modulo = urlObj.protocol === 'https:' ? https : http;
            const tInicio = performance.now();

            const req = modulo.request({
                protocol: urlObj.protocol,
                hostname: urlObj.hostname,
                port: porta,
                path: urlObj.pathname + urlObj.search,
                method: metodo,
                agent: agente,
                headers: payload
                    ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                    : undefined
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    let json = null;
                    try { json = JSON.parse(data); } catch { /* resposta não-JSON */ }
                    finalizar({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        latencia: performance.now() - tInicio,
                        json,
                        upstream: res.headers['x-upstream-backend'] || null,
                        erro: null
                    });
                });
                res.on('error', (err) => finalizar({
                    ok: false, status: 0, latencia: performance.now() - tInicio,
                    json: null, upstream: null, erro: err.message
                }));
            });

            req.setTimeout(opts.timeout, () => {
                req.destroy(new Error(`timeout de ${opts.timeout} ms`));
            });

            req.on('error', (err) => finalizar({
                ok: false, status: 0, latencia: performance.now() - tInicio,
                json: null, upstream: null, erro: err.message
            }));

            if (payload) req.write(payload);
            req.end();
        });
    };
}

// ------------------------------------------------------------------------------
// Verificação de integridade
// ------------------------------------------------------------------------------
function contarVotosNoBanco() {
    return new Promise((resolve) => {
        execFile(
            'docker',
            ['exec', 'db_postgres', 'psql', '-U', 'postgres', '-d', 'votacao', '-tAc', 'SELECT count(*) FROM votos;'],
            { timeout: 10000 },
            (err, stdout) => {
                if (err) return resolve(null);
                const total = parseInt(String(stdout).trim(), 10);
                resolve(Number.isFinite(total) ? total : null);
            }
        );
    });
}

// ------------------------------------------------------------------------------
// Injeção de falha sob carga
// ------------------------------------------------------------------------------
function criarInjecaoDeFalha(opts, eventos) {
    const estado = { disparada: false, promessa: null };

    estado.agendar = (concluidas) => {
        if (!opts.derrubar || estado.disparada) return;
        const gatilho = Math.max(1, Math.floor(opts.total * 0.3));
        if (concluidas < gatilho) return;

        estado.disparada = true;
        const tStop = new Date().toISOString();
        eventos.push(`${tStop} docker stop ${opts.derrubar}`);

        estado.promessa = new Promise((resolve) => {
            execFile('docker', ['stop', opts.derrubar], (err) => {
                if (err) {
                    eventos.push(`FALHA ao parar ${opts.derrubar}: ${err.message}`);
                    return resolve();
                }
                setTimeout(() => {
                    const tStart = new Date().toISOString();
                    eventos.push(`${tStart} docker start ${opts.derrubar}`);
                    execFile('docker', ['start', opts.derrubar], (err2) => {
                        if (err2) eventos.push(`FALHA ao iniciar ${opts.derrubar}: ${err2.message}`);
                        resolve();
                    });
                }, opts.duracaoFalha);
            });
        });
    };

    return estado;
}

// ------------------------------------------------------------------------------
// Execução do stress
// ------------------------------------------------------------------------------
async function executarStress(opts) {
    const alvo = new URL(opts.url);
    const urlApuracao = urlApuracaoDe(opts.url);
    const requisicao = criarCliente(opts);

    const eventosFalha = [];
    const injecao = criarInjecaoDeFalha(opts, eventosFalha);

    console.log('='.repeat(78));
    console.log('🔥 STRESS DO CAMINHO DE ESCRITA (POST /votar) — SIMULADOR DE VOTOS');
    console.log('='.repeat(78));
    console.log(`• Endpoint de voto:  ${alvo.toString()}`);
    console.log(`• Endpoint apuração: ${urlApuracao.toString()}`);
    console.log(`• Total de votos:    ${opts.total}`);
    console.log(`• Concorrência:      ${opts.concorrencia} simultânea(s)`);
    console.log(`• Candidato:         ${opts.candidato}`);
    console.log(`• Keep-alive:        ${opts.keepalive ? 'ATIVO (conexões reutilizadas)' : 'inativo (uma conexão TCP por request)'}`);
    if (opts.derrubar) {
        console.log(`• Falha injetada:    docker stop ${opts.derrubar} (~30% da carga, ${opts.duracaoFalha} ms parado)`);
    }
    console.log('='.repeat(78));

    // 1) Aquecimento (GET /apuracao aquece Nginx, Node e pool do Postgres sem gravar votos)
    if (opts.warmup > 0) {
        let aquecidos = 0;
        for (let i = 0; i < opts.warmup; i++) {
            const r = await requisicao(urlApuracao, 'GET');
            if (r.ok) aquecidos++;
        }
        console.log(`🔥 Aquecimento: ${aquecidos}/${opts.warmup} requisições OK (descartadas das métricas)\n`);
    }

    // 2) Baseline antes da carga
    const baseline = await requisicao(urlApuracao, 'GET');
    if (!baseline.ok || !baseline.json) {
        console.error(`ERRO: não foi possível ler a apuração inicial (${baseline.erro || `HTTP ${baseline.status}`}).`);
        console.error('Verifique se a stack está no ar: docker compose up -d --build');
        return 2;
    }
    const totalBaseline = Number(baseline.json.totalVotosGeral) || 0;
    const baselineBanco = opts.semBanco ? null : await contarVotosNoBanco();
    console.log(`📌 Baseline: ${totalBaseline} votos na API` +
        (baselineBanco === null ? ' (contagem no banco indisponível)' : ` / ${baselineBanco} linhas em votos`) + '\n');

    // 3) Carga concorrente
    const estatisticas = {
        contagem: {},
        latencias: [],
        errosPorStatus: {},
        sucessos: 0,
        erros: 0
    };

    let indiceAtual = 1;
    let concluidas = 0;

    const registrar = (id, r) => {
        const instancia = r.json?.processadoPor?.instancia || 'Desconhecida';
        const hostname = r.json?.processadoPor?.hostname || 'N/A';

        if (r.ok) {
            estatisticas.sucessos++;
            estatisticas.latencias.push(r.latencia);
            estatisticas.contagem[instancia] = (estatisticas.contagem[instancia] || 0) + 1;
        } else {
            estatisticas.erros++;
            const chave = r.status > 0 ? `HTTP ${r.status}` : (r.erro || 'erro de rede');
            estatisticas.errosPorStatus[chave] = (estatisticas.errosPorStatus[chave] || 0) + 1;
        }

        if (opts.silencioso) return;

        const rotulo = r.ok ? '✔' : '✘';
        const detalhe = r.ok
            ? `Respondido por: ${instancia.padEnd(12)} | Container: ${hostname.slice(0, 8)}`
            : `FALHA: ${r.erro || `HTTP ${r.status}`}`;
        console.log(
            `${rotulo} [Voto #${String(id).padStart(4, '0')}] ` +
            `${detalhe.padEnd(58)} | Latência: ${formatMs(r.latencia).padStart(7)} ms`
        );
    };

    async function worker() {
        while (indiceAtual <= opts.total) {
            const id = indiceAtual++;
            const r = await requisicao(alvo, 'POST', { numero: opts.candidato });
            concluidas++;
            registrar(id, r);
            injecao.agendar(concluidas);
        }
    }

    const tGeralInicio = performance.now();
    const poolSize = Math.min(opts.concorrencia, opts.total);
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
    const tGeralTotal = performance.now() - tGeralInicio;

    // Garante que o container derrubado volte ao ar antes de medir a integridade
    if (injecao.promessa) {
        console.log('\n⏳ Aguardando a religação do container para validar a integridade...');
        await injecao.promessa;
        // Folga para o container reiniciar o Node e reabrir o pool do Postgres
        await new Promise((r) => setTimeout(r, 2500));
    }

    // 4) Apuração final e integridade
    const final = await requisicao(urlApuracao, 'GET');
    const totalFinal = final.ok && final.json ? Number(final.json.totalVotosGeral) || 0 : null;
    const finalBanco = opts.semBanco ? null : await contarVotosNoBanco();

    const deltaApi = totalFinal === null ? null : totalFinal - totalBaseline;
    const deltaBanco = (finalBanco === null || baselineBanco === null) ? null : finalBanco - baselineBanco;

    const problemas = [];
    const avisos = [];
    // Sob falha injetada, uma resposta pode se perder DEPOIS do commit no banco
    // (o voto fica gravado, mas o cliente recebe erro). Isso é esperado e não é
    // perda de dados; por isso só tratamos "votos a menos" como falha grave.
    const tolerarExcedente = Boolean(opts.derrubar);

    const avaliarDelta = (nome, delta) => {
        if (delta === null) {
            problemas.push(`não foi possível medir o delta ${nome}`);
            return;
        }
        if (delta < estatisticas.sucessos) {
            problemas.push(`${nome} registrou ${delta}, mas ${estatisticas.sucessos} requisições tiveram sucesso (perda de votos)`);
        } else if (delta > estatisticas.sucessos) {
            const msg = `${nome} registrou ${delta} (${delta - estatisticas.sucessos} a mais que os sucessos: resposta perdida após o commit)`;
            if (tolerarExcedente) avisos.push(msg);
            else problemas.push(msg);
        }
    };

    avaliarDelta('a API', deltaApi);
    if (opts.semBanco) {
        avisos.push('contagem no banco não verificada (--sem-banco)');
    } else if (deltaBanco === null) {
        avisos.push('contagem no banco indisponível (docker exec falhou); integridade avaliada apenas pela API');
    } else {
        avaliarDelta('o banco', deltaBanco);
    }

    const integridade = problemas.length === 0 ? 'OK' : 'FALHA';

    // 5) Relatório
    const stats = calcularEstatisticas(estatisticas.latencias);
    const rps = estatisticas.sucessos > 0 ? (estatisticas.sucessos / (tGeralTotal / 1000)) : 0;
    const taxaErro = opts.total > 0 ? (estatisticas.erros / opts.total) * 100 : 0;
    const totalDistribuido = Object.values(estatisticas.contagem).reduce((a, b) => a + b, 0);
    const pct = (qtd) => (totalDistribuido > 0 ? (qtd / totalDistribuido) * 100 : 0);

    console.log('\n' + '='.repeat(78));
    console.log('📊 RESUMO DO STRESS DE ESCRITA');
    console.log('='.repeat(78));
    console.log(`• Tempo total:             ${(tGeralTotal / 1000).toFixed(2)} s`);
    console.log(`• Vazão (Throughput):      ${rps.toFixed(1)} votos/segundo`);
    console.log(`• Sucessos:                ${estatisticas.sucessos} de ${opts.total}`);
    console.log(`• Erros:                   ${estatisticas.erros} (${taxaErro.toFixed(2)}%)`);
    if (Object.keys(estatisticas.errosPorStatus).length > 0) {
        console.log('• Detalhe dos erros:');
        for (const [chave, qtd] of Object.entries(estatisticas.errosPorStatus)) {
            console.log(`    - ${chave}: ${qtd}`);
        }
    }

    console.log('\n⚖️  DISTRIBUIÇÃO DE ESCRITA ENTRE AS INSTÂNCIAS:');
    if (totalDistribuido === 0) {
        console.log('  (nenhuma resposta bem-sucedida para distribuir)');
    }
    for (const [instancia, qtd] of Object.entries(estatisticas.contagem)) {
        console.log(
            `  * ${instancia.padEnd(14)}: ${String(qtd).padStart(4)} votos (${pct(qtd).toFixed(1).padStart(5)}%)`
        );
    }

    console.log('\n⏱️  LATÊNCIA DAS ESCRITAS BEM-SUCEDIDAS:');
    console.log(`  * Mínima:        ${formatMs(stats.min)} ms`);
    console.log(`  * Média:         ${formatMs(stats.media)} ms`);
    console.log(`  * P50 (Mediana): ${formatMs(stats.p50)} ms`);
    console.log(`  * P95:           ${formatMs(stats.p95)} ms`);
    console.log(`  * Máxima:        ${formatMs(stats.max)} ms`);

    console.log('\n🧮 VERIFICAÇÃO DE INTEGRIDADE:');
    console.log(`  * Votos contabilizados pela API (delta): ${deltaApi === null ? 'n/d' : deltaApi}`);
    console.log(`  * Linhas novas na tabela votos (delta):  ${deltaBanco === null ? 'n/d' : deltaBanco}`);
    console.log(`  * Requisições com sucesso:               ${estatisticas.sucessos}`);
    if (avisos.length > 0) {
        for (const a of avisos) console.log(`    ℹ ${a}`);
    }
    if (problemas.length > 0) {
        for (const p of problemas) console.log(`    ⚠ ${p}`);
    }
    console.log(`  * Veredito: ${integridade === 'OK' ? '✅ OK — nenhum voto perdido ou duplicado' : '❌ FALHA — inconsistência detectada'}`);

    if (eventosFalha.length > 0) {
        console.log('\n💥 EVENTOS DE FALHA INJETADA:');
        for (const evento of eventosFalha) console.log(`  * ${evento}`);
        console.log('  (erros 502/503 durante a janela de fail_timeout são esperados)');
    }
    console.log('='.repeat(78) + '\n');

    // 6) CSV
    if (opts.csv) {
        const qtdInst1 = estatisticas.contagem['Instancia-1'] || 0;
        const qtdInst2 = estatisticas.contagem['Instancia-2'] || 0;

        const linha = [
            new Date().toISOString(),
            sanitizar(opts.cenario),
            opts.total,
            opts.concorrencia,
            opts.candidato,
            sanitizar(alvo.toString()),
            opts.keepalive ? 'sim' : 'nao',
            estatisticas.sucessos,
            estatisticas.erros,
            taxaErro.toFixed(2),
            rps.toFixed(2),
            stats.p50.toFixed(2),
            stats.p95.toFixed(2),
            stats.max.toFixed(2),
            qtdInst1,
            qtdInst2,
            pct(qtdInst1).toFixed(2),
            pct(qtdInst2).toFixed(2),
            deltaApi === null ? 'n/d' : deltaApi,
            deltaBanco === null ? 'n/d' : deltaBanco,
            integridade,
            sanitizar(eventosFalha.join('; '))
        ].join(',');

        const dir = path.dirname(path.resolve(opts.csv));
        fs.mkdirSync(dir, { recursive: true });
        const precisaCabecalho = !fs.existsSync(opts.csv) || fs.statSync(opts.csv).size === 0;
        fs.appendFileSync(opts.csv, (precisaCabecalho ? CABECALHO_CSV + '\n' : '') + linha + '\n');
        console.log(`💾 Resultado anexado em: ${opts.csv}`);
    }

    return integridade === 'OK' ? 0 : 1;
}

// ------------------------------------------------------------------------------
// Resumo de um CSV (mediana por cenário) — usado pelo comparar_balanceadores.sh
// ------------------------------------------------------------------------------
function resumir(arquivo) {
    if (!fs.existsSync(arquivo)) {
        console.error(`ERRO: CSV não encontrado: ${arquivo}`);
        return 2;
    }

    const linhas = fs.readFileSync(arquivo, 'utf8').trim().split(/\r?\n/);
    if (linhas.length < 2) {
        console.error('ERRO: CSV sem linhas de dados.');
        return 2;
    }

    const cabecalho = linhas[0].split(',');
    const col = Object.fromEntries(cabecalho.map((nome, i) => [nome, i]));

    const obrigatorias = ['cenario', 'rps', 'p50_ms', 'p95_ms', 'max_ms', 'taxa_erro_pct', 'inst1_pct', 'inst2_pct', 'integridade'];
    for (const nome of obrigatorias) {
        if (!(nome in col)) {
            console.error(`ERRO: coluna "${nome}" ausente no CSV.`);
            return 2;
        }
    }

    const grupos = new Map();
    for (const linha of linhas.slice(1)) {
        if (!linha.trim()) continue;
        const c = linha.split(',');
        const cenario = c[col.cenario];
        if (!grupos.has(cenario)) grupos.set(cenario, []);
        grupos.get(cenario).push({
            rps: Number(c[col.rps]),
            p50: Number(c[col.p50_ms]),
            p95: Number(c[col.p95_ms]),
            max: Number(c[col.max_ms]),
            erro: Number(c[col.taxa_erro_pct]),
            inst1: Number(c[col.inst1_pct]),
            inst2: Number(c[col.inst2_pct]),
            integridade: c[col.integridade]
        });
    }

    console.log('\n' + '='.repeat(96));
    console.log('📊 RESUMO COMPARATIVO (mediana das rodadas por cenário)');
    console.log('='.repeat(96));
    console.log(
        'Cenário'.padEnd(14) +
        'Rodadas'.padStart(8) +
        'RPS'.padStart(10) +
        'P50 (ms)'.padStart(11) +
        'P95 (ms)'.padStart(11) +
        'Máx (ms)'.padStart(11) +
        'Erro %'.padStart(9) +
        'Inst1 %'.padStart(10) +
        'Inst2 %'.padStart(10) +
        'Integr.'.padStart(10)
    );
    console.log('-'.repeat(96));

    const linhasResumo = [];
    for (const [cenario, rodadas] of grupos) {
        const valor = (campo) => mediana(rodadas.map((r) => r[campo]));
        const integridade = rodadas.every((r) => r.integridade === 'OK') ? 'OK' : 'FALHA';

        const resumo = {
            cenario,
            rodadas: rodadas.length,
            rps: valor('rps'),
            p50: valor('p50'),
            p95: valor('p95'),
            max: valor('max'),
            erro: valor('erro'),
            inst1: valor('inst1'),
            inst2: valor('inst2'),
            integridade
        };

        console.log(
            cenario.padEnd(14) +
            String(resumo.rodadas).padStart(8) +
            resumo.rps.toFixed(1).padStart(10) +
            resumo.p50.toFixed(1).padStart(11) +
            resumo.p95.toFixed(1).padStart(11) +
            resumo.max.toFixed(1).padStart(11) +
            resumo.erro.toFixed(2).padStart(9) +
            resumo.inst1.toFixed(1).padStart(10) +
            resumo.inst2.toFixed(1).padStart(10) +
            integridade.padStart(10)
        );

        linhasResumo.push([
            sanitizar(cenario), resumo.rodadas,
            resumo.rps.toFixed(2), resumo.p50.toFixed(2), resumo.p95.toFixed(2), resumo.max.toFixed(2),
            resumo.erro.toFixed(2), resumo.inst1.toFixed(2), resumo.inst2.toFixed(2), integridade
        ].join(','));
    }
    console.log('='.repeat(96) + '\n');

    const arquivoResumo = arquivo.replace(/\.csv$/i, '') + '_resumo.csv';
    fs.writeFileSync(
        arquivoResumo,
        'cenario,rodadas,rps_mediana,p50_mediana_ms,p95_mediana_ms,max_mediana_ms,taxa_erro_mediana_pct,inst1_pct_mediana,inst2_pct_mediana,integridade_geral\n' +
        linhasResumo.join('\n') + '\n'
    );
    console.log(`💾 Resumo salvo em: ${arquivoResumo}\n`);

    return 0;
}

// ------------------------------------------------------------------------------
// Main
// ------------------------------------------------------------------------------
(async () => {
    const opts = parseArgs(process.argv);

    if (opts.ajuda) {
        imprimirAjuda();
        process.exit(0);
    }
    if (opts.resumo) {
        process.exit(resumir(opts.resumo));
    }

    const codigo = await executarStress(opts);
    process.exit(codigo);
})().catch((err) => {
    console.error('ERRO inesperado:', err);
    process.exit(1);
});
