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
├── frontend/                  # Interface web estática (HTML/CSS/JS, sem build)
│   ├── index.html
│   ├── styles.css
│   └── app.js
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

O Nginx está configurado por padrão com **Least Connections** (`least_conn`), que envia cada requisição para a réplica com menos conexões ativas. Esse é o algoritmo usado na demonstração ao vivo porque o roteiro da prática exige que o navegador alterne entre as duas aplicações. O **IP Hash** (`ip_hash`) foi avaliado apenas como extra: ele fixa cada IP de cliente em uma réplica (afinidade) e, por isso, não alterna quando o teste é feito por um único cliente. Os resultados dos três algoritmos estão na Seção 4.3 de [`docs/RELATORIO.md`](docs/RELATORIO.md), com o `ip_hash` detalhado na Seção 4.3.1.

Caso queira avaliar o **Round-Robin** (baseline do roteiro) ou o **IP Hash** (extra):
1. Abra o arquivo `nginx/nginx.conf`.
2. Comente ou descomente a linha desejada dentro do bloco `upstream`:
   ```nginx
   upstream simulador_votacao {
       least_conn;       # Padrão ativo: alterna entre as réplicas
       # ip_hash;        # Extra: fixa o cliente em uma réplica
       # (sem nenhuma diretiva = Round-Robin, baseline do roteiro)
       server api1:5000 max_fails=3 fail_timeout=5s;
       server api2:5000 max_fails=3 fail_timeout=5s;
   }
   ```
3. Recarregue a configuração do Nginx sem parar o container:
   ```bash
   docker exec proxy_nginx nginx -s reload
   ```

#### Alternativa: trocar o algoritmo pelo script

Em vez de editar o arquivo na mão, use `scripts/trocar_algoritmo.sh`. Ele remove o algoritmo atual do bloco `upstream`, insere o escolhido, valida com `nginx -t` e recarrega o Nginx sem reiniciar o container.

```bash
bash scripts/trocar_algoritmo.sh rr           # Round-Robin (baseline)
bash scripts/trocar_algoritmo.sh least_conn   # Least Connections
bash scripts/trocar_algoritmo.sh ip_hash      # IP Hash
bash scripts/trocar_algoritmo.sh              # sem argumento: mostra um menu
```

> **Nota técnica:** o script edita uma cópia temporária (`mktemp`) e sobrescreve `nginx.conf` com `cat "$TMP" > "$CONF"` para preservar o *inode* do arquivo no *bind mount* do Docker (usar `sed -i` diretamente no arquivo trocaria o inode e faria o container continuar lendo a versão antiga). Após trocar o algoritmo, você pode confirmar a configuração ativa com `docker exec proxy_nginx nginx -T | grep -A3 upstream`.

---

### 4. Testar a Falha de um Container (script `demo_falha_container.sh`)

Derruba **um** dos 4 containers (`proxy_nginx`, `api_instancia_1`, `api_instancia_2` ou `db_postgres`) com `docker stop`, envia votos pelo Nginx durante a falha, reinicia o container e prova duas coisas: os demais containers continuam rodando e nenhum voto confirmado é perdido.

**Pré-requisitos:** stack no ar (`docker compose up --build -d`), `docker` e `curl` disponíveis e execução a partir da raiz do projeto. No Windows, use o Git Bash.

```bash
bash scripts/demo_falha_container.sh                      # padrão: api_instancia_1, 20 votos
bash scripts/demo_falha_container.sh api_instancia_2 50   # alvo e nº de votos
bash scripts/demo_falha_container.sh db_postgres 20
bash scripts/demo_falha_container.sh proxy_nginx
```

Parâmetros posicionais: `[container] [votos]`. O script não precisa de configuração adicional (URL `http://localhost` e nomes dos containers estão no topo do arquivo).

**Etapas executadas:**
1. Mostra o estado dos 4 containers.
2. Registra a contagem de votos antes (soma de `candidatos.total_votos` e nº de linhas em `votos`).
3. `docker stop` no container escolhido.
4. Envia os votos via `POST /votar` pelo Nginx e conta quantos retornaram HTTP 200 e qual instância atendeu.
5. Mostra que os demais containers seguem em execução.
6. `docker start` no container (se for o banco, espera o `pg_isready`).
7. Compara a contagem final com a esperada (antes + votos confirmados) e imprime `OK` ou `ATENÇÃO`.

**Comportamento esperado por alvo:**

| Alvo | Durante a falha | Resultado esperado |
| :--- | :--- | :--- |
| `api_instancia_1` / `api_instancia_2` | Nginx envia tudo à instância saudável | Todos os votos confirmados, nenhum perdido |
| `db_postgres` | API responde 503 (banco indisponível) | Votos recusados não contam; os dados anteriores permanecem (Docker Volume) |
| `proxy_nginx` | Porta 80 sem resposta | Nenhum voto confirmado; dados intactos no banco |

---

### 5. Acompanhar em Tempo Real

Abra dois terminais antes de rodar o script de falha. No Git Bash o comando `watch` não existe; use um laço `while` (Ctrl+C para parar).

```bash
# Terminal 1: estado dos containers
while true; do clear; docker ps -a --format "table {{.Names}}\t{{.Status}}"; sleep 1; done

# Terminal 2: votos no banco
while true; do clear; docker exec db_postgres psql -U postgres -d votacao -c "SELECT numero, nome, total_votos FROM candidatos ORDER BY numero;"; sleep 1; done
```

Se o `docker exec` falhar no Git Bash por conversão de caminhos, prefixe com `MSYS_NO_PATHCONV=1`. Também é possível acompanhar a apuração em `http://localhost/apuracao` e os containers na aba *Containers* do Docker Desktop. Opcional: `docker compose logs -f api1 api2` mostra qual instância atende cada voto.

---

### 6. Problemas Comuns

**`Conflict. The container name "/db_postgres" is already in use`:** existe uma stack antiga criada a partir de outra pasta (outro nome de projeto Compose). Derrube-a **sem** `-v`, para não apagar o volume `pgdata`, e suba de novo:

```bash
docker ps -a --format "table {{.Names}}\t{{.Status}}"
docker compose -p simulador-de-votos-main down    # ajuste o nome do projeto antigo, se for outro
docker compose up --build -d
```

**`$'\r': command not found` ao rodar um `.sh`:** o arquivo veio com quebras de linha do Windows. Corrija com `sed -i 's/\r$//' scripts/<arquivo>.sh`.

---

### 7. Interface Web (frontend)

Além dos endpoints JSON, o projeto inclui uma interface web simples (HTML/CSS/JavaScript puro, sem build) servida pelo próprio Nginx em **[http://localhost/app](http://localhost/app)**.

A interface permite:

- ver o estado da API e do banco, o hostname do container e a instância que respondeu;
- acompanhar a distribuição das requisições entre `Instancia-1` e `Instancia-2` (contadores atualizados a cada chamada à API);
- selecionar um candidato e registrar votos via `POST /votar`;
- acompanhar a apuração com total geral, barras e percentuais, com atualização automática a cada 5 segundos.

A rota `/` continua respondendo ao health check da API — ela não foi alterada, então os scripts de balanceamento seguem funcionando. Se a stack já estiver rodando, recrie apenas o contêiner do Nginx para montar o novo volume:

```bash
docker compose up -d nginx
```

A interface chama `/candidatos`, `/votar` e `/apuracao` na mesma origem do proxy, portanto não é necessário configurar CORS.

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
