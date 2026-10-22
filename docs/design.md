# Estoque Graal — projeto aprovado pelo pedido de 21/10/2026

> Registro histórico da etapa correspondente. Regras e procedimentos atuais: [AGENTS.md](../AGENTS.md), [desenvolvimento](development.md) e [operação](operations.md). Menções a metro/contagem obrigatória para todo legado podem ter sido superadas pelas decisões de 21/10/2026.

## Objetivo e limites
Estoque único, armários, funcionários individuais, sem financeiro. Node.js/TypeScript/NestJS + PostgreSQL; Ubuntu 24.04; Nginx/HTTPS; Docker Compose. Sem commit, push, deploy ou carga em produção pelo agente.

## Organização
backend/src: módulos de autenticação, catálogo/localizações, movimentações, importação, auditoria e banco. frontend/src: TypeScript/Vite sem framework adicional, interface portuguesa. Dependências fixadas em package-lock.json. SQL explícito parametrizado, migrações versionadas; nenhuma sincronização automática.

## Integridade
Produto bloqueado com SELECT FOR UPDATE antes de saldo/localizações; todas as operações concorrentes do mesmo produto seguem essa ordem. Saldos derivam de lançamentos por localização, nunca de campo editável. Quantidades bigint em milésimos: unidade múltiplo de 1000, metro até 3 decimais. Inteiros transitam em JSON como texto. Transferência gera dois lançamentos na mesma transação. Estorno aplica os lançamentos inversos, uma única vez, sujeito à disponibilidade e ao fechamento cronológico; não reescreve o original. Registros confirmados são imutáveis. Sem alteração retroativa que gere fechamento negativo.

## Abertura e legado
Abertura por produto, com data de corte e contagem física explícita por localização, aprovada com autoria/justificativa. Sem abertura, novas operações são bloqueadas. Legado nunca participa do saldo operacional. Prévia guarda checksum e payload operacional saneado no banco; original com financeiro permanece exclusivamente no arquivo protegido de origem. Confirmação idempotente, sem fusões/conversões/correções. Eventos zerados permanecem como evidência segregada no legado. Pendências explícitas; importação não homologa contagem ou identidade.

## Autenticação
Argon2id, sessões PostgreSQL revogáveis, rotação no login, CSRF por token associado à sessão e validação de origem. Cookies HttpOnly/SameSite e Secure em produção. Limitação de tentativas persistida no banco. Funcionário ativo verificado em toda requisição. Administração de contas apenas para responsável explicitamente designado; todos ativos têm operação completa. Primeiro responsável criado por CLI interativa, sem senha padrão.

## Implantação
Banco sem porta pública em produção; apenas Nginx exposto. HTTPS e renovação documentados, sem emissão real nesta tarefa. Migração explícita antes de iniciar. Backup externo com retenção e teste de restauração isolado. Testes sintéticos; nenhuma base de produção acessada.
