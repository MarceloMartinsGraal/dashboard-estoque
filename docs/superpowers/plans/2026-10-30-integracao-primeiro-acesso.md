# Integração por padrão e primeiro acesso — plano

Base6f1696e, branch atual mantida. Proposta local existente em docs/superpowers/specs/2026-10-30-integracao-primeiro-acesso-design.md preservada; requisitos autorizados pelo pedido anexado de30/10. Sem branch nova/commit/push/deploy/servidor ou .env real.

Exceção explícita à proibição de senha padrão do AGENTS: apenas banco sem qualquer funcionário recebe admin/admin, hashArgon2id, Administrador inicial, gestor e pendente. Contas existentes/inativas nunca são redefinidas.

- [x] Testes em PostgreSQL descartável: configuração ausente/true/false/inválida, startup concorrente/vazio/legado, restrição de sessão, troca/CSRF/revogação/relogin, provisionamento pendente e preservação de dados. Ver vermelho antes de implementar.
- [x] Configuração central estrita: undefined/true habilitam, false desabilita, demais valores falham startup com mensagem sem revelar valor. Compose usa ${INTEGRATION_ENABLED-true}, incluindo produção e override legado (não substituir vazio inválido). Scripts preservam false explícito e não tentam provisionar GLPI quando desabilitado.
- [x] Migração007 com must_change_password defaultfalse. Inicialização verifica migração aplicada, usa lock742106 compartilhado com bootstrap/admin e cria/audita uma única vez. Não aplicar migração automaticamente em servidores; falhar com indicação se ausente.
- [x] SessionGuard permite ao pendente só identificação/troca/logout (CSRF/login e health públicos mantidos). Troca exige nova senha12..128, confirmação e apenas pendência atual; atualiza hash/flag/session_version, remove sessões e audita na mesma transação, destrói cookie e exige novo login. Gestão de contas não recebe parâmetro para remover a flag. Provisionamento/autor externo recusam pendentes.
- [x] Tela específica com logout, tratamento de sessão pendente em login/me/erro403, sem navegação operacional. Reaproveitar controles/marca. Verificar navegador real.
- [x] Documentação atual, instruções de migração/atualização e false explícito, risco do primeiro acesso conhecido, HTTPS/firewall. Revisão independente, tipos/lint/build/suíte, evidência e commit sugerido sem executar.

Alternativas: senha aleatória difere do pedido; criação por migração SQL colocaria hash/política no schema e não executaria corretamente em banco antes preenchido. Escolhida rotina idempotente na inicialização normal após schema pronto, mantendo CLI manual opcional antes do primeiro startup. Não criar bypass ou recuperação por senha conhecida.

Foco de revisão: flag no container inclusive vazia/inválida; sessões antigas salvas tardiamente; revogação e lock de troca; ausência total de funcionários inclui inativos; CLI não pode provisionar por admin pendente; retornos tardios de frontend não podem montar navegação após expiração/logout.


Execução concluída localmente:95 testes Node/PostgreSQL (incluindo navegador) e23 Python, tipos/lint/build. Testes novos em vermelho antes da implementação; revisão independente sem achados. Proposta local de design preservada. Limites e atualização: docs/primeiro-acesso.md e docs/primeiro-acesso-verificacao.md. Sem servidor, migração de produção, credencial real, branch nova ou commit.
