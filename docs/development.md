# Desenvolvimento e verificações locais

Referências atuais: [README](../README.md), [operação Ubuntu](operations.md), [API de integração](integracoes/integration-v1.md). Planos antigos são registros históricos, não prova de execução do checkout atual.

## Ambiente vazio

Node24.22.0, npm e PostgreSQL18.4; versões da aplicação travadas em package-lock.json, .nvmrc e Dockerfile. Não executar npm update para instalar. Usar `npm ci`. Não há dependência nova nesta manutenção.

Para API/frontend sem contêiner, seguir Executar localmente no README: preencher .env a partir de .env.example, iniciar somente o banco local, compilar, migrar e executar bootstrap no banco vazio. `bootstrap` é interativo e só cria a primeira conta quando não há funcionários. Não repetir em banco povoado. Nunca usar exemplos como segredo.

## Variáveis de ambiente

| Nome | Uso / requisito |
|---|---|
| NODE_ENV | development local; production exige origem HTTPS/cookie Secure |
| PORT | Porta da API, padrão 3000; Compose define 3000 |
| PUBLIC_ORIGIN | Origem exata sem barra final, como http://localhost:5173 ou https://DOMINIO_REAL; obrigatória |
| SESSION_SECRET | Segredo local protegido, mínimo32 caracteres; obrigatório, separado das senhas PostgreSQL |
| DATABASE_URL | Conexão da API e CLI de migração/bootstrap; obrigatória na API; Compose monta a URL com DB_APP_PASSWORD |
| POSTGRES_USER / POSTGRES_DB | Dono/banco do Compose; padrões graal_owner/graal |
| POSTGRES_PASSWORD | Segredo do dono do banco; exigido pelo Compose; nunca usar na URL da API |
| DB_APP_PASSWORD | Segredo hexadecimal do papel graal_app; exigido pelo Compose e usado na URL da API |
| INTEGRATION_ENABLED | false/ausente desabilita; somente true habilita. Compose normal não repassa a variável; override de integração local é explicitamente opcional |
| TEST_DATABASE_URL | Banco novo descartável _test em loopback para suítes/simulador; não é lido pela API normal |
| BACKUP_DIR | Diretório protegido externo ao Git/volume PostgreSQL para scripts/backup.sh |

O init-db.sh só é executado em volume vazio. Trocar .env não troca senha de um banco existente. Não recriar ou apagar o volume para resolver senha/configuração: planejar correção autorizada. Integração segue desabilitada sem override e sem credenciais reais.

## Comandos de verificação

| Comando | O que executa |
|---|---|
| npm run typecheck | Tipos backend/frontend sem emissão |
| npm run lint | Tipos mais noUnusedLocals/noUnusedParameters, usando TypeScript já instalado. Não é ESLint e não verifica estilo de formatação |
| npm run build | Compila backend e gera frontend Vite |
| npm test | Compila backend e roda testes Node com concorrência de arquivos1 |
| npm run test:compiled | Roda a mesma suíte sem recompilar; exige dist/backend atualizado |
| npm run verify | Lint (inclui tipos), build e testes compilados, sem recompilar backend novamente |

A suíte escreve fixtures e aplica migrações. Requer banco vazio exclusivo por execução; não limpa/substitui uma base existente. Alguns IDs de fixture são fixos. Nada deve apontar para banco habitual ou produção.

PowerShell, na raiz, usando um PostgreSQL local descartável preparado pelo responsável:

```powershell
$env:TEST_DATABASE_URL = Read-Host 'URL do PostgreSQL local descartável com banco terminado em _test'
npm ci
npm run verify
```

Não registrar URL com senha no chat/Git. As suítes HTTP sobem suas próprias APIs; não é necessário iniciar npm start/dev:web, configurar a .env operacional ou ativar integração real. `node scripts/simulate-integration.cjs` usa o mesmo tipo de banco e cria somente credencial efêmera sintética, revogada ao terminar; instruções na documentação de integração.

## Automação existente: Docker Compose de testes

Não há workflow de CI ou agendamento versionado neste checkout. O caminho automatizado existente é compose.test.yaml. Compartilha rede entre tests e db_test para satisfazer loopback; PostgreSQL em tmpfs, sem portas/volume persistente. A imagem test já compila no build; o comando do contêiner roda lint + test:compiled.

Em Linux/Ubuntu com Docker disponível, usar projeto único para não afetar outro ensaio:

```sh
TEST_PROJECT="graal-tests-$(date +%s)"
docker compose -p "$TEST_PROJECT" -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from tests
# Registrar o código de saída antes do próximo comando.
docker compose -p "$TEST_PROJECT" -f compose.test.yaml down
```

O down acima aponta apenas para o projeto de teste exclusivo, sem -v. Ele encerra o PostgreSQL temporário; nunca usar nomes de projetos existentes de operação. O script não é executado automaticamente no servidor e não dispara serviços externos. Builds podem precisar obter imagens/pacotes oficiais; nesta revisão não foram feitos downloads nem testes de contêiner por ausência de Docker.

## Migrações

Não há migração nova nesta manutenção. As cinco migrações existentes são aplicadas em ordem, com lock e checksum. API normal não migra automaticamente; compose.dev tem serviço migrate antes da API, enquanto compose.yaml depende do procedimento manual documentado. Em base vazia: compilar e executar npm run migrate no destino local conferido, seguido de bootstrap. Nunca editar migração aplicada ou assumir que voltar imagem desfaz schema.

004 descontinua metros: rejeita base com frações em metro para exigir conciliação explícita. 005 prepara tabelas vazias de integração, sem credenciais. 001 cria o esquema, 002 registra fingerprints da importação, 003 versiona sessões. Toda necessidade futura de schema fica fora desta manutenção.

## Documentação e dados de referência

Contrato oficial da API em docs/integracoes, sem cópia de referência em outputs. OpenAPI estático; Swagger não está instalado. A instalação/homologação no GLPI segue pendente.

O JSON tests/graal_estoque.json veio do commit ccd9e99; nenhuma suíte/script o referencia. Foi preservado sem leitura/carga/modificação e excluído apenas do contexto Docker para evitar copiá-lo para imagens de teste. A decisão de removê-lo do histórico Git ou substituir por fixture sintética pertence a outra tarefa.
