# Primeiro acesso e integração habilitada por padrão

Atualização preparada em30/10/2026, base6f1696e. Somente código e ensaios locais; nenhum servidor/GLPI/.env real foi alterado.

## Instalação nova

Aplicar as migrações versionadas antes de iniciar a API. A migração nova **007_initial_access.sql** acrescenta must_change_password com padrão false para funcionários existentes; não altera seus logins, senhas ou estado ativo. A API verifica007 antes de criar qualquer conta. Ela não aplica migração automaticamente e não usa sincronização de schema.

Ao iniciar normalmente (`main`/`createApp`) com **nenhum funcionário**, o sistema cria uma única conta: login **admin**, senha temporária **admin**, nome Administrador inicial, administração de contas e troca obrigatória. Hash Argon2id, verificação de qualquer funcionário (inclusive inativo), lock transacional742106 e auditoria impedem duplicação em inicializações concorrentes. Senha/hash não aparecem em logs ou auditoria. Reinício/atualização não redefine contas nem restaura a senha inicial.

Esta é uma exceção explícita de bootstrap, não uma conta oculta nem recuperação de acesso. Se existir qualquer funcionário, inclusive somente inativos ou usuário com outro login, não será criado admin. Não apagar funcionários para disparar bootstrap.

1. Manter instalação acessível somente ao responsável em rede controlada.
2. Abrir o endereço configurado em PUBLIC_ORIGIN e entrar com admin/admin.
3. A tela **Primeiro acesso** exige nova senha12..128 caracteres e confirmação. Não há navegação operacional. Logout está disponível.
4. Após a troca, as sessões anteriores são revogadas. Fazer **novo login** com a nova senha.
5. Depois é possível alterar login/nome pela administração de funcionários existente.

**admin/admin é temporário e deve ser trocado antes da exposição pública.** A troca obrigatória não impede que terceiros usem a credencial conhecida e troquem a senha antes do responsável. Não substitui HTTPS, firewall ou controle de acesso durante a instalação. Nada nesta entrega publica serviços automaticamente.

O bootstrap manual continua disponível para criar um primeiro responsável com senha forte **antes do primeiro startup**, após migrar um banco vazio. Usa o mesmo lock e recusa qualquer base já com funcionário; não serve para resetar admin automático ou substituir contas. Não é mais um passo obrigatório da instalação normal.

## Restrição no backend

Login retorna employee.must_change_password; GET /api/auth/me também retorna a flag. O SessionGuard lê o estado no banco em cada requisição. Pendente recebe403 PASSWORD_CHANGE_REQUIRED ao tentar catálogo/estoque/produtos/funcionários/notas/importação/auditoria ou outras funções pessoais.

Endpoints autenticados permitidos: GET /api/auth/me, POST /api/auth/change-password e POST /api/auth/logout. Login, token CSRF e health conservam suas regras públicas atuais; health não retorna dados operacionais. Proteção Origin/CSRF e limitação persistida de login não mudaram. Cookie pessoal não autentica integração.

POST /api/auth/change-password recebe JSON `{password,confirmPassword}`, ambos obrigatórios; nova senha12..128 e confirmação idêntica. A rota aceita somente pendência existente, não uma redefinição arbitrária de senha. Em transação, revalida active/session_version/pendência após o lock, atualiza hash/flag/version, remove sessões e registra auditoria sem segredo. O controller destrói a sessão atual, limpa cookie e responde `{ok:true,loginRequired:true}`. Sessão antiga regravada tardiamente continua inválida pela versão. Em resultado desconhecido por rede, usar a tela de login e tentar a nova senha antes de repetir; não existe recuperação pela senha padrão.

A administração de funcionários não aceita must_change_password no corpo e nunca remove a flag por edição/reset. Novos cadastros comuns continuam exigindo senha forte. Provisionamento CLI, vínculos de operador e escrita da integração não aceitam funcionário com pendência. O script de setup para com instrução de concluir o primeiro acesso; após fazê-lo, reexecutar com o mesmo projeto/.env para provisionar. Nenhum vínculo por nome ou credencial remota é criado nesta tarefa.

## Integração: valor e encaminhamento

| INTEGRATION_ENABLED | Comportamento |
|---|---|
| Ausente | Habilitada |
| true | Habilitada |
| false | Desabilitada explicitamente (503) |
| Vazio, TRUE,0,yes ou outro | Startup falha com erro claro de configuração |

Valores são exatos; não há normalização silenciosa. O backend centraliza a regra em config.ts, valida na inicialização e a reutiliza no guard/execução. Compose produção, desenvolvimento, homologação e override legado encaminham `${INTEGRATION_ENABLED-true}`. O hífen sem dois-pontos aplica o padrão só se ausente; vazio permanece inválido. `.env.example` usa true.

Habilitar não permite anonimato: credenciais revogáveis/expiráveis, escopos, instância e vínculo humano continuam obrigatórios. Não cria credenciais automaticamente. O checkbox “Habilitar integração” do plugin GLPI é independente e não foi alterado.

## Atualizar instalação existente — somente em execução futura autorizada

1. Fazer backup e conferir banco, projeto Compose e versão atuais; manter pgdata/invoices e segredos.
2. Revisar/aplicar007 pelo migrador existente, sem editar001..006 nem mudar senhas. Em dev/homologação o serviço migrate já precede API; produção mantém a etapa administrativa de migração antes do startup da imagem nova.
3. Revisar **somente** INTEGRATION_ENABLED no .env e em overrides/variáveis do terminal. Arquivos reais não foram alterados nesta tarefa. Se estiver false, continuará desabilitado; para habilitar, o responsável deve alterar explicitamente para true (ou remover a variável) e recriar a API com o mesmo projeto/Compose. Um override posterior ou variável exportada pode prevalecer sobre o .env.
4. Reconstruir/recriar API e web para a interface nova, mantendo os mesmos arquivos -f, projeto -p e env. Não usar down -v, trocar projeto ou recriar banco para resolver configuração.
5. Conferir estado efetivo no processo, sem imprimir outros segredos. Exemplo para homologação, depois da atualização autorizada:

```bash
sudo docker compose --env-file .env -f compose.homologacao.yaml exec api node -e "console.log(require('./dist/backend/config').integrationEnabled() ? 'habilitada' : 'desabilitada')"
```

Com false explícito, setup preserva o arquivo e não provisiona nem acessa GLPI. Valores inválidos param antes da gravação do arquivo. Mesmo habilitada, a integração sem Bearer válido responde401; o primeiro administrador pendente não pode emitir credencial externa.

Voltar a imagem não desfaz007. Não apagar coluna, contas ou auditoria. Evitar recuar para versão que ignore a pendência enquanto existir conta temporária: a versão antiga não oferece o bloqueio novo. Concluir primeiro acesso ou manter ambiente isolado enquanto revisa recuperação. Não há endpoint de recuperação por senha conhecida.

## Verificação e limites

Testes sintéticos em PostgreSQL descartável e navegador local estão em [primeiro-acesso-verificacao.md](primeiro-acesso-verificacao.md). Docker/Compose/Nginx/Ubuntu e servidores não foram executados nesta máquina. Encaminhamento Compose foi conferido por leitura/testes dos manifestos, sem alegação de ensaio em contêiner. O plugin GLPI e seus pacotes não precisam mudar para esta entrega.
