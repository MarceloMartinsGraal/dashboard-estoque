# Corrigir instance-mismatch na primeira configuração

Causa confirmada no servidor: instância existente diferente. Causa no código: formulário permite troca sem intenções, helper CLI bloqueia sempre. Reutilizar regra existente, sem alterar identidade de operações gravadas.

- [x] TDD: configuração antiga vazia de intenções permite probe sem persistência e apply após GET; qualquer intenção (pendente ou concluída) bloqueia; erro de consulta bloqueia; repetição idempotente.
- [x] Compartilhar regra entre formulário/helper com Settings::assertInstanceChangeAllowed; manter backup/export, validação da API antes da gravação, token existente e versão GLPI.
- [x] Versão0.1.12, documentação, revisão, testes direcionados, pacote ZIP e patch aplicável. Não servidor/commit/push/deploy. Sem backend ou migração nova.

Revisão independente não encontrou bloqueio no fix. Testes descritos passaram localmente. A troca continua bloqueada se houver qualquer intenção; não se trata de migrador de identidades com histórico.
