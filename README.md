# Simulador de Votos — Estrutura do Projeto

Projeto para a **Prática 1 — Infraestrutura Web e Balanceamento de Carga** (Sistemas Operacionais Modernos - CEFET-MG / UFCI-MG).

---

## 📁 Estrutura de Diretórios e Responsabilidades

```text
Simulador-de-Votos/
├── AGENTS.md                  # Convenções de commits (Conventional Commits)
├── README.md                  # Visão geral do projeto e das squads
├── pratica.pdf                # Especificação do trabalho prático
├── docker-compose.yml         # [Squad 1] Orquestração dos 4 containers
├── nginx/                     # [Squad 1] Configurações do Proxy Reverso
│   └── nginx.conf
├── backend/                   # [Squad 2] Código-fonte da API de votação
│   └── ...
├── database/                  # [Squad 3] Scripts de banco e schema
│   └── init.sql
├── scripts/                   # [Squad 4] Scripts de validação e teste de carga
│   └── ...
└── docs/                      # [Squad 4] Relatório técnico em LaTeX
    └── main.tex
```

---

## 👥 Divisão das Squads

| Squad | Módulo / Pasta | Responsabilidades Práticas |
| :--- | :--- | :--- |
| **Squad 1 — Infraestrutura e Proxy** | `docker-compose.yml`, `nginx/` | Escrever o `docker-compose.yml` (4 containers), configurar o Proxy Reverso (apenas porta 80 externa), isolar na Docker Network. |
| **Squad 2 — Backend** | `backend/` | Desenvolver a API de votação (2 instâncias simultâneas) retornando o hostname do container. |
| **Squad 3 — Banco e Resiliência** | `database/` | Configurar o SGBD, schema das tabelas, Docker Volume e teste de tolerância a falhas (`docker stop`). |
| **Squad 4 — Validação e Consolidação** | `scripts/`, `docs/` | Criar script de validação de carga/alternância, avaliar Round-Robin vs outros e estruturar o relatório LaTeX. |
