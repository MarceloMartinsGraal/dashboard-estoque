# Verificação — primeiro acesso e integração

Data30/10/2026, base6f1696e. A proposta local preexistente de design foi preservada; alterações funcionais seguem o pedido explícito com troca obrigatória. Branch/índice/HEAD não foram modificados pelo agente.

## Evidências de comportamento

- Linha de base e vermelho:86 testes anteriores passaram,6 novos falharam por ausência da conta, flag/troca/provisionamento/configuração/encaminhamento. Log local work/initial-access-red.log. Não foi alterado teste para ocultar regressão: o teste que antes esperava integração desabilitada foi atualizado para a mudança **intencional** de contrato de configuração solicitada, acrescentando a verificação de false explícito.
- PostgreSQL real descartável loopback _test: bancos separados para vazio, legado ativo/inativo e fluxo de troca. Inicializações concorrentes de aplicações reais criam uma conta/uma auditoria, sem reset em reinício. Argon2id verificado com a credencial inicial apenas no teste; hash não é impresso.
- Migração de schema006 com funcionários anteriores preserva IDs/hash/estado e adiciona false; startup sem007 falha antes da criação. Nenhuma migração001..006 foi editada. Nenhuma migração de servidor foi executada.
- Login/me retornam a pendência; acesso operacional e arquivo de notas ficam bloqueados com403 PASSWORD_CHANGE_REQUIRED. Token CSRF/login/health mantêm política própria; logout pendente é permitido. Troca anônima/sem CSRF é bloqueada, senha curta/default/confirmação divergente/campoextra rejeitados.
- Troca com falha de auditoria por trigger real reverte hash/flag/versão/sessões. Troca válida salva novo hash e remove flag/sessões atomicamente. Sessão antiga inclusive regravada tardiamente é inválida; senha anterior é rejeitada e nova autentica normalmente. Campo de pendência não é editável pelo CRUD.
- Provisionamento com administrador inicial pendente é recusado no banco real sem criar cliente. Escrita de integração por funcionário pendente retorna403 sem movimento/resultado; credencial técnica continua autenticada/isolada.
- INTEGRATION_ENABLED ausente/true exige autenticação; false503; inválido/maiúsculo/vazio0/yes não habilita. Startup inválido falha com mensagem fixa antes de conexão/banco. Não imprime valor de configuração.
- Teste dos manifestos confere ambiente do serviço API e herança de âncora, interpolando os casos ausente/true/false/vazio/inválido. É verificação limitada dos arquivos, **não** execução/interpolação no Docker Compose real.
- Setup Python: geração/reuso, false explícito preservado e sem provisionamento/GLPI, inválido sem alterar arquivo, responsável pendente sem prompt/credencial. Docker/SSH são mocks; mensagens de backup/configuração dos testes são fixtures, não operações de servidor.
- Navegador Edge real com frontend compilado e backend/PostgreSQL locais: login inicial, recarga de rota de produtos sem navegação/catalogo, confirmação divergente, troca, novo login e acesso normal. Screenshot privado em work/first-access-screen.png; não incluído em Git.

## Revisão e limites

Revisão independente estática sem achados concretos nos caminhos alterados. Conferiu lock compartilhado, preservação de funcionários, defaultfalse da migração, bloqueio da sessão, transação de troca/auditoria, provisionamento e Compose. Não executou testes e não julgou vulnerabilidades preexistentes fora do escopo.

Não executados: Docker/Compose/Ubuntu/Nginx/HTTPS ou instalação/GLPI real. Nenhuma conta, credencial, estoque ou banco real alterado. .env reais e plugin/pacotes GLPI foram preservados. Sem dependências/skills instaladas, reset, exclusão de dados, branch nova, commit, push ou deploy.

Risco de implantação exigido pelo pedido: credencial temporária conhecida pode ser usada por terceiro antes do responsável. Concluir primeiro acesso em rede controlada antes da exposição pública; a restrição de troca não substitui HTTPS/firewall. Instruções: [primeiro-acesso.md](primeiro-acesso.md).

## Resultados finais

- `npm run typecheck`, `npm run lint` e `npm run build`: aprovados.
- Suíte completa em PostgreSQL descartável real: **95/95 aprovados**, zero falhas e zero ignorados. Inclui os86 cenários anteriores, novo fluxo completo e navegador de primeiro acesso/notas fiscais. Log local: work/initial-access-final.log.
- Rodada focal:8/8 aprovados, incluindo navegador e comparação dos manifestos. Log: work/initial-access-target.log.
- Python setup:23/23 aprovados, sem Docker/SSH real.
- Revisão independente estática sem achados concretos. Links relativos e referências OpenAPI válidos; diff sem erros de whitespace; migrações001..006, plugin GLPI e dependências sem diferenças.
- Proposta local pré-existente preservada e sem staging. Configuração de exemplo alterada; .env reais não modificados. Nenhuma conta/banco/credencial operacional foi utilizado ou modificado.
- Implantação autorizada futura requer007, atualização API/web com mesmo projeto/volumes e revisão do false explícito, seguida de homologação Docker/Ubuntu. Não foi feita nesta entrega.
