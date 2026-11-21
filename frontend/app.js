(() => {
    'use strict';

    // A interface é servida pelo próprio Nginx (mesma origem da API).
    // Para usar outro endereço, defina window.SIMULADOR_API_BASE antes deste script.
    const API_BASE = window.SIMULADOR_API_BASE || '';
    const AUTO_REFRESH_MS = 5000;

    const el = (id) => document.getElementById(id);

    const state = {
        candidatos: [],
        selecionado: null,
        contadores: {},
        carregando: false
    };

    const numeroFormatado = new Intl.NumberFormat('pt-BR');

    function escapar(valor) {
        return String(valor ?? '').replace(/[&<>"']/g, (caractere) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[caractere]));
    }

    function registrarInstancia(meta) {
        const nome = meta?.processadoPor?.instancia;
        if (!nome) return;
        state.contadores[nome] = (state.contadores[nome] || 0) + 1;
        renderizarBalanceamento();
    }

    async function api(caminho, opcoes = {}) {
        const resposta = await fetch(`${API_BASE}${caminho}`, {
            ...opcoes,
            headers: {
                ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
                ...(opcoes.headers || {})
            }
        });

        let dados;
        try {
            dados = await resposta.json();
        } catch {
            throw new Error(`Resposta inválida da API (HTTP ${resposta.status})`);
        }

        registrarInstancia(dados);

        if (!resposta.ok) {
            throw new Error(dados.mensagem || dados.erro || `Erro HTTP ${resposta.status}`);
        }
        return dados;
    }

    function renderizarStatus(dados) {
        const apiOk = dados.status === 'online';
        const bancoOk = dados.banco === 'conectado';

        el('api-status').textContent = apiOk ? 'online' : 'indisponível';
        el('api-status').className = `valor ${apiOk ? 'ok' : 'erro'}`;

        el('db-status').textContent = bancoOk ? 'conectado' : 'desconectado';
        el('db-status').className = `valor ${bancoOk ? 'ok' : 'erro'}`;

        el('instancia-atual').textContent = dados.processadoPor?.instancia || '—';
        el('hostname-atual').textContent = dados.processadoPor?.hostname || '—';

        const timestamp = dados.timestamp ? new Date(dados.timestamp) : new Date();
        el('ultima-atualizacao').textContent = Number.isNaN(timestamp.getTime())
            ? '—'
            : timestamp.toLocaleTimeString('pt-BR');
    }

    function renderizarBalanceamento() {
        const c1 = state.contadores['Instancia-1'] || 0;
        const c2 = state.contadores['Instancia-2'] || 0;
        const total = c1 + c2;

        el('contador-instancia-1').textContent = c1;
        el('contador-instancia-2').textContent = c2;
        el('barra-instancia-1').style.width = total ? `${(c1 / total) * 100}%` : '0%';
        el('barra-instancia-2').style.width = total ? `${(c2 / total) * 100}%` : '0%';
        el('total-requisicoes').textContent = `${total} requisição(ões) nesta sessão`;
    }

    function renderizarCandidatos() {
        const container = el('lista-candidatos');

        if (!state.candidatos.length) {
            container.innerHTML = '<p class="vazio">Nenhum candidato disponível.</p>';
            return;
        }

        container.innerHTML = state.candidatos.map((candidato) => {
            const selecionado = state.selecionado === candidato.numero;
            const votos = Number(candidato.total_votos) || 0;
            return `
                <button type="button" class="candidato ${selecionado ? 'selecionado' : ''}"
                        data-numero="${escapar(candidato.numero)}" aria-pressed="${selecionado}">
                    <span class="numero">${escapar(candidato.numero)}</span>
                    <span class="dados">
                        <strong>${escapar(candidato.nome)}</strong>
                        <small>${escapar(candidato.partido)} · ${numeroFormatado.format(votos)} voto(s)</small>
                    </span>
                    <span class="check" aria-hidden="true">✓</span>
                </button>`;
        }).join('');

        container.querySelectorAll('.candidato').forEach((botao) => {
            botao.addEventListener('click', () => {
                state.selecionado = Number(botao.dataset.numero);
                el('dica-selecao').textContent = `Pronto para votar no candidato ${state.selecionado}.`;
                renderizarCandidatos();
            });
        });

        el('btn-votar').disabled = state.selecionado === null || state.carregando;
    }

    function renderizarApuracao(dados) {
        el('total-geral').textContent = numeroFormatado.format(dados.totalVotosGeral || 0);

        const status = el('apuracao-status');
        const tabela = el('tabela-apuracao');

        if (!dados.apuracao?.length) {
            status.textContent = '';
            tabela.innerHTML = '<p class="vazio">Nenhum voto apurado ainda.</p>';
            return;
        }

        status.textContent = '';
        tabela.innerHTML = dados.apuracao.map((candidato, indice) => {
            const percentual = Number.parseFloat(candidato.percentual) || 0;
            return `
                <div class="linha-apuracao">
                    <div class="linha-topo">
                        <span class="posicao">${indice + 1}.</span>
                        <span class="numero-candidato">${escapar(candidato.numero)}</span>
                        <span class="nome-apuracao">${escapar(candidato.nome)}</span>
                        <span class="partido">${escapar(candidato.partido)}</span>
                        <span class="votos">${numeroFormatado.format(candidato.total_votos)}</span>
                        <span class="percentual">${escapar(candidato.percentual)}</span>
                    </div>
                    <div class="barra-votos"><div style="width: ${percentual}%"></div></div>
                </div>`;
        }).join('');
    }

    let timeoutToast;
    function mostrarToast(mensagem, tipo = 'sucesso') {
        const toast = el('toast');
        clearTimeout(timeoutToast);
        toast.textContent = mensagem;
        toast.className = `toast visivel ${tipo}`;
        timeoutToast = setTimeout(() => { toast.className = 'toast'; }, 5000);
    }

    async function carregarStatus(silencioso = false) {
        try {
            renderizarStatus(await api('/'));
        } catch (erro) {
            if (!silencioso) mostrarToast(erro.message, 'erro');
            el('api-status').textContent = 'sem resposta';
            el('api-status').className = 'valor erro';
        }
    }

    async function carregarCandidatos(silencioso = false) {
        try {
            state.candidatos = (await api('/candidatos')).candidatos || [];
            renderizarCandidatos();
        } catch (erro) {
            if (!silencioso) mostrarToast(erro.message, 'erro');
            el('lista-candidatos').innerHTML = '<p class="vazio">Não foi possível carregar os candidatos.</p>';
        }
    }

    async function carregarApuracao(silencioso = false) {
        try {
            renderizarApuracao(await api('/apuracao'));
        } catch (erro) {
            if (!silencioso) mostrarToast(erro.message, 'erro');
            el('tabela-apuracao').innerHTML = '<p class="vazio">Não foi possível carregar a apuração.</p>';
        }
    }

    async function atualizarTudo(silencioso = false) {
        if (state.carregando) return;
        state.carregando = true;
        el('btn-atualizar').disabled = true;
        el('btn-votar').disabled = true;

        try {
            await Promise.all([
                carregarStatus(silencioso),
                carregarCandidatos(silencioso),
                carregarApuracao(silencioso)
            ]);
        } finally {
            state.carregando = false;
            el('btn-atualizar').disabled = false;
            renderizarCandidatos();
        }
    }

    async function votar() {
        if (state.selecionado === null || state.carregando) return;

        const numero = state.selecionado;
        const botao = el('btn-votar');
        state.carregando = true;
        botao.disabled = true;
        botao.textContent = 'Computando voto…';
        el('btn-atualizar').disabled = true;

        try {
            const resposta = await api('/votar', {
                method: 'POST',
                body: JSON.stringify({ numero })
            });
            mostrarToast(resposta.mensagem || 'Voto computado com sucesso!', 'sucesso');

            if (resposta.candidato) {
                const candidato = state.candidatos.find((c) => c.numero === resposta.candidato.numero);
                if (candidato) candidato.total_votos = resposta.candidato.totalVotosAtualizado;
            }

            await Promise.all([
                carregarCandidatos(true),
                carregarApuracao(true),
                carregarStatus(true)
            ]);
        } catch (erro) {
            mostrarToast(erro.message, 'erro');
        } finally {
            state.carregando = false;
            botao.textContent = '✓ Confirmar voto';
            el('btn-atualizar').disabled = false;
            renderizarCandidatos();
        }
    }

    el('btn-votar').addEventListener('click', votar);
    el('btn-atualizar').addEventListener('click', () => atualizarTudo());

    setInterval(() => {
        if (el('chk-auto').checked && !state.carregando) {
            atualizarTudo(true);
        }
    }, AUTO_REFRESH_MS);

    atualizarTudo();
})();
