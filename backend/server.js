const express = require('express');
const { Pool } = require('pg');
const os = require('os');

const app = express();
app.use(express.json());

// Middleware de log para visualização de requisições em tempo real
app.use((req, _res, next) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${timestamp}] [${INSTANCE_NAME}] ${req.method} ${req.originalUrl || req.url}`);
    next();
});

// ==============================================================================
// CONFIGURAÇÃO E METADADOS DO CONTAINER
// ==============================================================================
const PORT = process.env.PORT || 5000;
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'Instancia-Sem-Nome';
const HOSTNAME = os.hostname();

// Pool de conexões centralizado com o PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'votacao',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
    console.error(`[${INSTANCE_NAME}] Erro inesperado no pool do banco:`, err.message);
});

// Metadados padrão para comprovação de balanceamento e auditoria
const meta = () => ({
    processadoPor: {
        instancia: INSTANCE_NAME,
        hostname: HOSTNAME
    },
    timestamp: new Date().toISOString()
});

// Helper para resposta de falha no banco de dados
const respostaErroBanco = (res, err, operacao) => {
    console.error(`[${INSTANCE_NAME}] Erro ao ${operacao}:`, err.message);
    return res.status(503).json({
        sucesso: false,
        mensagem: 'Banco de dados temporariamente indisponível',
        erro: err.message,
        ...meta()
    });
};

// ==============================================================================
// ROTAS DA API
// ==============================================================================

// 1. Health Check e Teste de Balanceamento
app.get('/', async (_req, res) => {
    let statusBanco = 'conectado';
    try {
        await pool.query('SELECT 1');
    } catch {
        statusBanco = 'desconectado';
    }

    res.json({
        status: 'online',
        banco: statusBanco,
        mensagem: 'Simulador de Votos — API ativa com Express e PostgreSQL',
        ...meta()
    });
});

// 2. Listagem de Candidatos
app.get('/candidatos', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT numero, nome, partido, total_votos FROM candidatos ORDER BY numero ASC'
        );
        res.json({ sucesso: true, candidatos: rows, ...meta() });
    } catch (err) {
        respostaErroBanco(res, err, 'buscar candidatos');
    }
});

// 3. Registro de Voto (Atômico em 1 único round-trip via CTE)
app.post('/votar', async (req, res) => {
    const rawNumero = req.body?.numero ?? req.body?.candidato;
    const numeroCandidato = Number.isInteger(rawNumero) ? rawNumero : parseInt(rawNumero, 10);

    if (isNaN(numeroCandidato)) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Informe o número do candidato no formato { "numero": 10 } ou { "candidato": 10 }',
            ...meta()
        });
    }

    try {
        // Atualiza a contagem e registra a auditoria em um único comando atômico
        const { rows } = await pool.query(
            `WITH updated AS (
                UPDATE candidatos
                SET total_votos = total_votos + 1
                WHERE numero = $1
                RETURNING id, numero, nome, total_votos
            ),
            inserted AS (
                INSERT INTO votos (candidato_id, instancia_origem)
                SELECT id, $2 FROM updated
            )
            SELECT numero, nome, total_votos FROM updated`,
            [numeroCandidato, INSTANCE_NAME]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                sucesso: false,
                mensagem: `Candidato com número ${numeroCandidato} não encontrado`,
                ...meta()
            });
        }

        const candidato = rows[0];
        res.json({
            sucesso: true,
            mensagem: `Voto computado com sucesso para ${candidato.nome} (${candidato.numero})!`,
            candidato: {
                numero: candidato.numero,
                nome: candidato.nome,
                totalVotosAtualizado: candidato.total_votos
            },
            ...meta()
        });
    } catch (err) {
        respostaErroBanco(res, err, 'registrar voto');
    }
});

// 4. Apuração dos Votos
app.get('/apuracao', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT numero, nome, partido, total_votos FROM candidatos ORDER BY total_votos DESC, numero ASC'
        );

        const totalGeral = rows.reduce((acc, c) => acc + (Number(c.total_votos) || 0), 0);
        const apuracao = rows.map((c) => {
            const votos = Number(c.total_votos) || 0;
            const percentual = totalGeral > 0 ? `${((votos / totalGeral) * 100).toFixed(2)}%` : '0.00%';
            return {
                numero: c.numero,
                nome: c.nome,
                partido: c.partido,
                total_votos: votos,
                percentual
            };
        });

        res.json({
            sucesso: true,
            totalVotosGeral: totalGeral,
            apuracao,
            ...meta()
        });
    } catch (err) {
        respostaErroBanco(res, err, 'buscar apuração');
    }
});

// ==============================================================================
// INICIALIZAÇÃO DO SERVIDOR
// ==============================================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[${INSTANCE_NAME}] API Express ativa na porta ${PORT} (ID Container: ${HOSTNAME})`);
});
