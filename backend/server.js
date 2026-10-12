const express = require('express');
const os = require('os');

const app = express();

// Middleware para processar JSON no corpo das requisições
app.use(express.json());

// Variáveis de ambiente e identificadores do container
const PORT = process.env.PORT || 5000;
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'Instancia-Sem-Nome';
const HOSTNAME = os.hostname(); // Em containers, retorna o ID do container!

let totalVotosNestaInstancia = 0;

// Rota raiz: Usada para verificar saúde e testar alternância no navegador
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        mensagem: 'Simulador de Votos — API ativa com Express',
        processadoPor: {
            instancia: INSTANCE_NAME,
            hostname: HOSTNAME
        },
        timestamp: new Date().toISOString()
    });
});

// Rota para registrar voto
app.post('/votar', (req, res) => {
    const { candidato } = req.body;
    totalVotosNestaInstancia++;

    res.json({
        sucesso: true,
        mensagem: `Voto computado com sucesso para o candidato ${candidato || 'não especificado'}!`,
        votosRecebidosNestaInstancia: totalVotosNestaInstancia,
        processadoPor: {
            instancia: INSTANCE_NAME,
            hostname: HOSTNAME
        },
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[${INSTANCE_NAME}] API Express rodando na porta ${PORT} (Host/Container ID: ${HOSTNAME})`);
});
