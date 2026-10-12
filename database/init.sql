-- ============================================================================
-- SCRIPT DE INICIALIZAÇÃO DO BANCO DE DADOS (PostgreSQL 15)
-- Projeto: Simulador de Votos
-- ============================================================================

CREATE TABLE IF NOT EXISTS candidatos (
    id SERIAL PRIMARY KEY,
    numero INT UNIQUE NOT NULL,
    nome VARCHAR(100) NOT NULL,
    partido VARCHAR(50) NOT NULL,
    total_votos INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS votos (
    id SERIAL PRIMARY KEY,
    candidato_id INT REFERENCES candidatos(id),
    instancia_origem VARCHAR(50) NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inserção de candidatos iniciais para validação do sistema
INSERT INTO candidatos (numero, nome, partido, total_votos) VALUES
(10, 'Candidato Alpha', 'Partido da Inovação', 0),
(20, 'Candidato Beta', 'Partido da Estabilidade', 0),
(99, 'Voto Nulo / Branco', 'Nenhum', 0)
ON CONFLICT (numero) DO NOTHING;
