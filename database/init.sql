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

INSERT INTO candidatos (numero, nome, partido, total_votos) VALUES
(10, 'Candidato A', 'Partido A', 0),
(20, 'Candidato B', 'Partido B', 0),
(99, 'Voto Nulo / Branco', 'Nenhum', 0)
ON CONFLICT (numero) DO NOTHING;
