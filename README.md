# Estoque Graal

Sistema de estoque único, com localização por armários e contas individuais. Sem módulo financeiro. Backend Node.js/TypeScript/NestJS; PostgreSQL; frontend TypeScript/HTML/CSS com Vite.

## Situação desta entrega

Implementação inicial: autenticação, catálogo, abertura por contagem física, entradas/saídas/ajustes, realocação, estorno, histórico operacional/legado e prévia/confirmação idempotente da importação. Nenhum dado legado é disponibilidade operacional. Nenhuma abertura é aprovada automaticamente.

Sem commit, push, deploy, certificado real ou importação em produção realizados pelo agente. Arquivos reais da auditoria permanecem fora do repositório. Não há conta ou senha operacional padrão.

## Requisitos e versões fixadas

- Node.js **24.22.0**, linha LTS; npm incluído no Node.
- NestJS **12.2.0**, TypeScript **5.9.3**, Express **5.3.0**, Vite **8.3.5**.
- PostgreSQL **18.4**; Nginx **1.30.6** estável.
- Ubuntu Server **24.04**, Docker Engine e Docker Compose v2 para implantação futura.
- Dependências diretas sem `^`/`~`; árvore exata em `package-lock.json`. Imagens fixadas por versão; antes da publicação valide também os digests e as atualizações de segurança.

Fontes consultadas em 21/10/2026: [Node LTS](https://nodejs.org/en/about/previous-releases), [NestJS](https://docs.nestjs.com/), [PostgreSQL](https://www.postgresql.org/support/versioning/), [Vite](https://vite.dev/guide/), [Nginx estável](https://nginx.org/en/download.html). Versões dos pacotes conferidas no registro oficial npm.

## Testar localmente só com Docker

`compose.dev.yaml` sobe banco, migração, API e frontend (Nginx em HTTP) sem precisar de Node no host. Não é configuração de produção: usa `NODE_ENV=development`, sem HTTPS, e publica apenas `127.0.0.1:8080`.

Com `.env` preenchido (seção abaixo; o compose usa só `SESSION_SECRET`, `POSTGRES_PASSWORD` e `DB_APP_PASSWORD`):

```powershell
docker compose -f compose.dev.yaml up -d --build --wait
docker compose -f compose.dev.yaml run --rm --no-deps api node dist/backend/bootstrap.js
```

O segundo comando cria o primeiro responsável (interativo; só funciona com o banco sem funcionários). Abra exatamente `http://localhost:8080`; `127.0.0.1` falha na verificação CSRF de origem. Após mudar código, repita o primeiro comando. Para parar: `docker compose -f compose.dev.yaml down`; acrescentar `-v` apaga o banco local de teste.

Os scripts `.sh` e as configurações Nginx precisam de quebras de linha LF; `.gitattributes` garante isso no checkout. Com CRLF, o `init-db.sh` falha e o banco fica sem o usuário `graal_app`. Nesse caso, recrie o volume local.

## Executar localmente

Na raiz do repositório:

```powershell
Copy-Item .env.example .env
```

Preencha `.env` localmente. Gere separadamente `SESSION_SECRET`, `POSTGRES_PASSWORD` e `DB_APP_PASSWORD` com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Não envie os valores ao chat, não registre em log e não inclua `.env` no Git. Use o valor de `DB_APP_PASSWORD` também na URL `DATABASE_URL`; gere em hexadecimal para evitar problemas de codificação na URL.

Mantenha `NODE_ENV=development`, `PUBLIC_ORIGIN=http://localhost:5173`. Use exatamente esse endereço no navegador, pois a verificação CSRF confere a origem. O PostgreSQL local é publicado somente em `127.0.0.1`.

```powershell
docker compose -f compose.local.yaml up -d --wait
npm ci
npm run build
npm run migrate
npm run bootstrap
npm run dev:api
```

Em outro terminal:

```powershell
npm run dev:web
```

Abra `http://localhost:5173`. Após mudar código backend, execute `npm run build:backend`; o processo `dev:api` reinicia ao detectar o compilado atualizado.

`bootstrap` pede login, nome e senha sem eco no terminal; só funciona quando ainda não há funcionários. O primeiro responsável administra contas pela tela Funcionários. Funcionários ativos possuem operação completa. Responsáveis também administram contas; o último responsável ativo não pode ser removido dessa função. Alterações de conta revogam sessões. Senhas devem ter 12–128 caracteres; nenhuma é gerada como padrão.

Sem Docker, use PostgreSQL 18.4 local, crie um banco exclusivo e um usuário sem superusuário com permissão de criar tabelas no schema e ajuste `DATABASE_URL`. Não use o banco de produção para desenvolvimento ou testes.

## Verificações

```powershell
npm run typecheck
npm run build
```

Testes sintéticos de integração, em PostgreSQL temporário separado:

```powershell
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f compose.test.yaml down
```

O compose de testes não publica portas, usa dados temporários e credenciais exclusivamente sintéticas; não é configuração de produção. Use um projeto de testes exclusivo e limpo em cada execução. Alternativa: defina `TEST_DATABASE_URL` apontando para um banco novo e descartável cujo nome termine em `_test`; execute `npm test`. A suíte cria apenas dados sintéticos, não limpa nem substitui uma base existente. Reutilizar a mesma base de teste não é suportado; crie outra base para cada execução.

**Resultado desta execução:** `npm run typecheck` e `npm run build` aprovados; 31 testes automatizados passaram em PostgreSQL real 18.4 isolado. No Edge headless, login, consulta, saída pelo formulário com conferência do saldo no banco, histórico, viewport móvel de 390 px e logout passaram sem erros JavaScript. A revisão independente direcionada teve os achados importantes corrigidos com testes. Docker/Compose, Nginx/HTTPS e restauração no Ubuntu ainda não foram executados, pois Docker não está disponível nesta máquina.

Os testes verificam precisão, abertura pendente, saldo no armário, disputa concorrente, realocação, estorno, retroatividade, autenticação, CSRF, sessão, inativação, campos extras e idempotência. Consulte `tests/` para os cenários completos.

Neste Windows foi usado PostgreSQL real **18.4** temporário em `work/`, com binários de teste obtidos por `embedded-postgres@18.4.0-beta.17`. O wrapper é apenas um auxiliar externo de testes, não é dependência da aplicação nem da implantação. O encerramento foi feito com `pg_ctl`. O caminho reproduzível oficial do projeto é `compose.test.yaml` ou `TEST_DATABASE_URL`.

## Regras importantes

- Valores da API de quantidade são texto decimal com ponto. Internamente, inteiros `bigint` representam milésimos: 1 unidade = 1000; 0,001 metro = 1. Unidades exigem múltiplos inteiros; metros aceitam até três casas. Não há arredondamento automático.
- Saldos são derivados do livro de lançamentos por localização; não há campo de saldo editável. A soma das localizações é o global.
- Toda operação bloqueia o produto com `SELECT ... FOR UPDATE` e grava os lançamentos numa única transação. Saídas concorrentes do mesmo produto são serializadas. Validações de fechamento por dia impedem retroatividade que torne qualquer localização negativa.
- Data do evento é `DATE`; instante de registro é `timestamptz`. Legado sem horário não recebe um horário inventado.
- Uma única abertura aprovada por produto estabelece o corte. É possível contar zero explicitamente; isso não cria uma movimentação artificial de quantidade zero. Depois da abertura, divergências exigem ajustes justificados. Abertura e estorno não são estornáveis novamente.
- Estorno tem vínculo único com o original, autoria e justificativa. Faz lançamentos inversos; se faltar saldo, é bloqueado. A correção completa é estorno mais novo lançamento.
- Produtos e funcionários podem ser inativados sem apagar histórico. Armário com saldo não pode ser inativado. “Não informada” é uma localização explícita e preservada.
- Unidades e metros são apresentados separadamente. Mínimo é opcional; nenhum mínimo é inferido.
- O backend exige motivo, chamado textual quando necessário e justificativa para ajustes, correção de estoque ou outro motivo.
- A trilha registra alterações de cadastros, aberturas, movimentos, estornos e lotes. Registros de movimento, livro, legado e auditoria são imutáveis no banco pelas rotas usuais; acesso administrativo direto ao banco continua sendo responsabilidade da infraestrutura.

## Revisar a importação

1. Preserve `graal_estoque.original.json` em armazenamento protegido, com cópia e checksum. Não o inclua no Git nem o disponibilize pelo Nginx.
2. Na tela Importação, escolha o original ou a cópia organizada para **validar e gerar prévia**. Essa etapa grava só o lote saneado de revisão e a auditoria, sem cadastrar produtos nem movimentos.
3. Confira contagens, saldos históricos por produto/unidade, evidências zeradas e pendências. A cópia organizada altera somente ordem; não é homologação.
4. A confirmação exige ciência explícita de que as pendências permanecem segregadas. Ela disponibiliza **somente histórico legado**, sem abrir saldo e sem incorporar dados financeiros.
5. Mesmo checksum retorna o lote existente. Outro checksum com os mesmos IDs e conteúdo não duplica registros. O mesmo ID com conteúdo divergente bloqueia toda a confirmação, em vez de sobrescrever.
6. Produtos importados ficam com abertura pendente. Realize contagem física por produto e armário, revise identidades/unidades e só então aprove a abertura na tela Produtos. O histórico anterior nunca é somado novamente à abertura.

JSON inválido, chaves repetidas, IDs repetidos, referências órfãs, unidades inválidas e datas inválidas são rejeitados. Apenas campos explicitamente mapeados são persistidos. `valor_unitario` e outros dados financeiros ficam exclusivamente no arquivo de origem protegido. As 25 quantidades zero permanecem como evidência no histórico legado, sem eventos operacionais. Motivos ausentes recebem `legado_nao_informado`. Chamados são texto; zeros são preservados.

Datas originais e notas de conversão disponíveis em `revisar.itens` são associadas por produto/origem. Todos os registros legados permanecem pendentes de validação; `data_estimada=false` não comprova uma data. Não são inferidos horários ou autores. Ausência de metadados originais permanece ausência explícita.

## Auditoria conferida

Origem lida fora do repositório: `Documents/ChatGPT/DASHBOARD GRAAL EMPRESA/auditoria_estoque_2026-10-21`. Foram consultados relatório, resumo, pendências, log e JSON organizado. SHA-256 do original: `1d23e55886992fdd96e7765d6d6040bda457d493a324ab3aa3d30c2cf3397b01`.

Referências conferidas: 608 produtos; 27 categorias; 3.058 movimentos (1.233 entradas e 1.825 saídas); 25 zerados; 1.296 sem motivo; 47 datas ajustadas, 32 estimadas e 3 suspeitas. Três saldos finais de −1 (341, 387, 567), 30 produtos com fechamento negativo, seis descrições a validar (44, 101, 254, 415, 640, 645). Candidatos, sem fusão/exclusão: produtos 44/101 e 215/518; movimentos 959/961 e 2625/2626.

## Antes de publicar

Leia `docs/operations.md`. Defina domínio/DNS, responsáveis por contas/backups, política de acesso e contagem física. Prepare HTTPS, valide a restauração, execute os testes no Ubuntu e revise os certificados/segredos e os arquivos de implantação. A existência dos arquivos Docker não significa que o servidor foi configurado ou que a publicação foi validada.
