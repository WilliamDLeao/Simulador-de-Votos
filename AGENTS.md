# Diretrizes de Desenvolvimento e Padrão de Commits

Este documento define as convenções e padrões adotados no projeto **Simulador de Votos**. Todos os colaboradores e agentes devem seguir estas diretrizes para manter o histórico de alterações limpo, rastreável e padronizado.

---

## Padrão de Commits: Conventional Commits

Todas as mensagens de commit devem seguir a especificação do [Conventional Commits v1.0.0](https://www.conventionalcommits.org/pt-br/v1.0.0/).

### Estrutura da Mensagem

```text
<tipo>[escopo opcional]: <descrição>

[corpo opcional]

[rodapé(s) opcional(is)]
```

---

### Tipos Permitidos

| Tipo | Descrição | Exemplo |
| :--- | :--- | :--- |
| **`feat`** | Nova funcionalidade para o usuário ou sistema | `feat(urna): adiciona contagem de votos em tempo real` |
| **`fix`** | Correção de um bug | `fix(eleicao): corrige condicao de empate no segundo turno` |
| **`docs`** | Alterações apenas em documentação | `docs: atualiza instrucoes no README` |
| **`style`** | Formatação, indentação ou estilo que não alteram a lógica do código | `style: formata arquivos com clang-format` |
| **`refactor`** | Refatoração de código que não corrige bug nem adiciona funcionalidade | `refactor(voto): simplifica validacao de titulo de eleitor` |
| **`perf`** | Alteração de código com foco em melhoria de desempenho | `perf(apuracao): otimiza busca binaria dos candidatos` |
| **`test`** | Adição ou correção de testes automatizados | `test(urna): adiciona testes unitarios para votos nulos` |
| **`chore`** | Tarefas de manutenção, scripts auxiliares ou ferramentas de configuração | `chore: remove arquivos temporarios do build` |
| **`build`** | Mudanças no sistema de compilação ou dependências externas (Makefile, CMake, etc.) | `build: adiciona flag -Wall no Makefile` |
| **`ci`** | Alterações em arquivos e scripts de CI/CD (GitHub Actions, etc.) | `ci: configura workflow de compilacao automatica` |

---

### Regras Gerais

1. **Descrição (Título):**
   - Use letras minúsculas no início da descrição (ex.: `feat: adiciona...` em vez de `feat: Adiciona...`).
   - Não coloque ponto final (`.`) ao término do título.
   - Seja conciso e direto ao ponto (máximo de 72 caracteres no título).
   - Mantenha o verbo no presente do indicativo ou infinitivo de forma consistente (ex.: `adiciona`, `corrige`, `implementa`).

2. **Escopo (Opcional):**
   - Deve representar o módulo ou componente afetado entre parênteses:
     - `feat(urna): ...`
     - `fix(candidato): ...`
     - `refactor(threads): ...`

3. **Breaking Changes (Modificações Incompatíveis):**
   - Indique com um ponto de exclamação `!` após o tipo/escopo ou declarando `BREAKING CHANGE:` no rodapé:
     ```text
     feat(api)!: altera formato de exportacao dos votos
     ```

---

### Exemplos Práticos

```text
feat(eleitores): implementa cadastro de novos eleitores
```

```text
fix(semaforo): resolve condicao de corrida no acesso a memoria compartilhada
```

```text
docs: adiciona especificacao de requisitos e diagrama de threads
```
