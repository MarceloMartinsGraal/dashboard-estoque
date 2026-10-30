# Integração automática e primeiro acesso

Data: 30/10/2026. Base examinada: main em 6f1696e772c6056282b754e691d25f2366ad60fd.
Estado: proposta para aprovação, sem alteração funcional aplicada.

## Pedido
Habilitar integração automaticamente e criar primeiro usuário admin com senha admin, posteriormente alterável.

## Abordagem
O responsável já escolheu integração ligada e credencial inicial conhecida. Para evitar conta padrão permanentemente utilizável, a proposta é criar admin/admin somente em banco sem funcionários e exigir troca da senha no primeiro login, antes do acesso às funções da aplicação.
Alternativa considerada: senha inicial aleatória, que reduz o risco de adivinhação mas difere do acesso simples pedido. Não criar conta padrão em bases com funcionários.

## Integração
Usar true como padrão de execução e exemplos; encaminhar a configuração nos serviços Compose, inclusive produção, sem exigir preenchimento manual para uma instalação nova. Preservar opção explícita de desativação para manutenção. Habilitar a API não remove autenticação, validade, escopos ou vínculos. Isso não liga automaticamente o checkbox de uma instalação GLPI nem cria/ativa credenciais remotas.
Arquivos .env já existentes com false explícito continuam sendo decisões locais e precisam de tratamento documentado; nenhum servidor será alterado nesta tarefa.

## Primeiro acesso
Adicionar migração nova com flag obrigatória de troca de senha, default false para contas existentes. Criar admin/admin uma única vez na inicialização normal, depois das migrações, com hash Argon2 e auditoria, protegido pelo lock de administração de funcionários.
Não recriar, resetar ou substituir contas existentes, mesmo inativas. Login inicial abre somente a tela de troca de senha; backend bloqueia funções enquanto a flag estiver ativa. Exigir senha nova com ao menos 12 caracteres, confirmação no formulário, invalidar sessões e liberar acesso após troca bem-sucedida.
Conta e nome poderão ser editados depois pela administração existente. Provisionamento administrativo não poderá tratar uma conta de primeiro acesso pendente como autorização para integração.
Senha conhecida ainda pode ser usada por terceiro que alcance a tela antes do responsável. O primeiro acesso deverá ser feito antes da exposição pública.

## Entrega e verificação
Testar integração ausente/true/false, bootstrap vazio/concorrente/existente, restrição de endpoints antes da troca, rejeição de senha fraca, troca, revogação de sessões e preservação de contas. Rodar verificações de tipos/build/testes pertinentes em banco descartável.
Trabalhar na main conforme preferência existente, sem criar branch, commit, push, deploy ou alterar servidores.
