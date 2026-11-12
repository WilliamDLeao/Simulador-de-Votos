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
├── scripts/                   # [Squad 4] Scripts de validação, stress e teste de carga
│   ├── test_load_balancer.js      # Alternância/latência via GET /
│   ├── test_load_balancer.ps1     # Demonstração sequencial (Windows)
│   ├── stress_votacao.js          # Stress de POST /votar + integridade dos votos
│   ├── comparar_balanceadores.sh  # RR × least_conn (e outros) automatizado
│   └── resultados/                # CSVs gerados pelos testes (não versionados)
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

### 2. Stress do Caminho de Escrita (`POST /votar`)

O `test_load_balancer.js` mede alternância com `GET /`, mas **não exercita o banco** (a rota de saúde responde 200 mesmo com o Postgres fora). Para stress de verdade, use o `stress_votacao.js`, que grava votos, mede latência/vazão e **valida a integridade** (votos contabilizados == requisições com sucesso).

```bash
# Stress básico: 200 votos, 20 simultâneos
node ./scripts/stress_votacao.js

# Carga maior, gravando o resultado em CSV
node ./scripts/stress_votacao.js --total 1000 --concorrencia 50 \
  --cenario carga-pesada --csv ./scripts/resultados/carga.csv

# Falha injetada: derruba a Instancia-2 no meio da carga e religa após 6s
node ./scripts/stress_votacao.js --total 1000 --concorrencia 50 \
  --derrubar api_instancia_2

# Ver todas as opções
node ./scripts/stress_votacao.js --ajuda
```

O script faz aquecimento, lê a apuração antes/depois, compara com a contagem da tabela `votos` (via `docker exec`) e imprime um veredito **OK/FALHA**. Erros 502/503 durante a janela de `fail_timeout` do Nginx são esperados no teste de falha.

---

### 3. Comparar Algoritmos de Balanceamento (automático)

O comparador alterna o algoritmo em `nginx/nginx.conf`, recarrega o Nginx sem parar o container, roda N rodadas de stress para cada cenário e gera um resumo com medianas — exatamente o que o roteiro pede (avaliar escalonamentos tendo o **Round-Robin como baseline**).

```bash
# RR × Least Connections, 3 rodadas cada
./scripts/comparar_balanceadores.sh

# Mais carga e mais rodadas
./scripts/comparar_balanceadores.sh --rodadas 5 --total 500 --concorrencia 40

# Incluir também IP Hash e ponderado (weight=3 / weight=1)
./scripts/comparar_balanceadores.sh --algoritmos "rr least_conn ip_hash weighted"
```

Saídas:
- `scripts/resultados/comparacao_<timestamp>.csv` — uma linha por rodada;
- `scripts/resultados/comparacao_<timestamp>_resumo.csv` — medianas por cenário.

O `nginx.conf` original é restaurado automaticamente ao final. Requer Docker acessível sem `sudo` (ou rode com `sudo`) e Node.js instalado.

> **Expectativa para o relatório:** com respostas rápidas e uniformes, `least_conn` fica próximo do Round-Robin. A diferença aparece quando há latência heterogênea (contenção no Postgres, `pool max: 10` por API). O `ip_hash` tende a concentrar tudo em uma instância quando o cliente é único (o próprio script), o que também é um resultado válido a discutir.

---

### 4. Testar Resiliência do Banco de Dados (Requisito Prático)

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

### 5. Alternar Algoritmo de Balanceamento Manualmente (Nginx)

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

