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

---

## 🚀 Como Executar o Projeto

### 1. Pré-requisitos
- [Docker](https://docs.docker.com/get-docker/) instalado e rodando.
- [Docker Compose](https://docs.docker.com/compose/) instalado (incluso no Docker Desktop).

### 2. Subir os Contêineres
Na raiz do projeto, execute:

```bash
docker compose up --build -d
```

> **O que isso faz?**
> - Constrói a imagem da API em Node.js (`backend/Dockerfile`).
> - Inicia os 4 contêineres: `proxy_nginx`, `api_instancia_1`, `api_instancia_2` e `db_postgres`.
> - Cria a rede isolada `rede_votacao` e o volume persistente `pgdata`.
> - Executa o script `database/init.sql` no banco na primeira inicialização.

Para verificar se todos os 4 serviços estão ativos e saudáveis:

```bash
docker compose ps
```

---

## 🧪 Como Testar

### 1. Testar o Balanceamento de Carga (Porta 80)

Apenas a porta `80` do Nginx está exposta para o host. As APIs (`5000`) e o Banco (`5432`) rodam de forma privada.

#### Opção A: No Navegador
Acesse: [http://localhost](http://localhost)  
Pressione `F5` repetidamente e observe o campo `"instancia"` alternando entre `Instancia-1` e `Instancia-2`.

#### Opção B: Script PowerShell (Windows)
```terminal WLS
explorer.exe .
``

```powershell
Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope Process
.\scripts\test_load_balancer.ps1 -TotalRequisicoes 10
```

#### Opção C: Script Node.js (Multiplataforma)
```bash
node ./scripts/test_load_balancer.js 10
```

#### Opção D: Via cURL / Terminal
```bash
# Verificação de saúde e alternância
curl http://localhost/

# Registrar um voto
curl -X POST http://localhost/votar \
  -H "Content-Type: application/json" \
  -d '{"candidato": 10}'
```

---

### 2. Testar Resiliência do Banco de Dados (Requisito Prático)

Demonstração de que a interrupção do banco não corrompe nem perde dados, graças ao **Docker Volume**:

```bash
# 1. Derruba o contêiner do banco
docker stop db_postgres

# 2. Inicia o contêiner novamente
docker start db_postgres

# 3. Consulta a integridade das tabelas e dados persistidos
docker exec -it db_postgres psql -U postgres -d votacao -c "SELECT * FROM candidatos;"
```

---

### 3. Alternar Algoritmo de Balanceamento (Nginx)

O Nginx está configurado por padrão com **Least Connections** (`least_conn`).

Caso queira avaliar a diferença em relação ao **Round-Robin** (baseline do roteiro):
1. Abra o arquivo `nginx/nginx.conf`.
2. Comente ou descomente a linha `least_conn;`:
   ```nginx
   upstream simulador_votacao {
       # least_conn;  # Comentado = Round-Robin padrão
       server api1:5000 max_fails=3 fail_timeout=5s;
       server api2:5000 max_fails=3 fail_timeout=5s;
   }
   ```
3. Recarregue a configuração do Nginx sem parar o container:
   ```bash
   docker exec proxy_nginx nginx -s reload
   ```

---

## 🛑 Como Parar os Serviços

Para parar os contêineres preservando os dados do banco:
```bash
docker compose down
```

Para parar os contêineres e **apagar todos os dados/volumes** (limpeza completa):
```bash
docker compose down -v
```

