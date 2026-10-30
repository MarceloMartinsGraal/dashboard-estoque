# Assistente de configuração do servidor

Objetivo: um comando reutilizável no Ubuntu para dashboard e GLPI no mesmo host. Reutilizar setup_graal.py; não executar contra servidor nesta tarefa.

Decisão: assistente interativo na primeira execução, escolhas privadas persistentes e retomada nas seguintes; sem inferir identidade de usuários. Reutilizar Python da ferramenta, não alterar backend Node. Proxy detectado entre Nginx/Apache ativos, virtualhost próprio com validação e rollback. TLS usa certificado existente ou Certbot webroot instalado; DNS/NSG continuam externos. Não instalar dependências, desativar CSRF, rotacionar segredos ou modificar virtualhost GLPI. Código/configuração externos não gerenciados são recusados, conflitos exigem revisão.

- [x] Testes primeiro: preservação do .env/projeto/segredos, transição validada e backup, estado reutilizado, seleção de identidade, templates e rollback do proxy.
- [x] Implementar assistente e entrada shell; configuração persistente sem token, validação antes da escrita, integração reutilizada e primeiro acesso retomável.
- [x] Implementar proxy Ubuntu padrão, certificado existente/Certbot com desafio webroot sem parar GLPI; renovação com reload e proteção de arquivos existentes.
- [x] Verificar testes direcionados/regressões, revisão e documentação do comando único e limites de homologação.

Sem commit/push/deploy. Execução inline; revisão final independente. Checkout inicial 494c674 limpo. Testes de host usam diretórios temporários e processos simulados, nunca /etc real.

Resultado: 25 testes do assistente +31 de regressão passaram (56 total). Revisão independente apontou renovação existente, domínio Nginx em uma linha e concorrência entre checkouts; corrigidos e cobertos com regressões. Renovação existente limitada a webroot verificável e exclusivo, sem reconfigurar lineage por suposição. Verificações reais Docker/Nginx/Apache/Certbot/GLPI continuam pendentes no Ubuntu; comandos simulados e primitiva de symlink/flock simuladas no Windows. Sem alterações no backend/plugin/migrações; não repetir suíte funcional de estoque sem motivo.
