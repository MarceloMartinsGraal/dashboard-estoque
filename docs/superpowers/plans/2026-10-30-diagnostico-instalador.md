# Correção do diagnóstico do instalador

Base24c8950 limpa. Evidência:GLPI11.0.5, plugin1.9 instalado, ativação manualfunciona, extensõespresentes, helperstatusfunciona; nova execuçãofalhaembash após preservarcredencial. Não inferircausa remota.

- [x] Reproduzir localmente descarte de stderr/etapa e probeausente com testesvermelhos.
- [x] MetadadoscontroladosPHP phase/status; probe GET antes de qualquerpersistência; wrapperPython whitelist e rótulodeetapa atravessando processochild.
- [x] Assistente --diagnosticar reutilizandoestado/token, semDockerup/provision/envwrite, stagingtemporárioGLPI com --root explícito.
- [x] 60testesPython e PHPcURLfixture, documentação, versão1.10, revisão e pacote.

Sem commit/push/deploy/servidor. A causa instalada permanece pendente do diagnóstico; não declarar integração corrigida. Não repetir suítesdeestoque sem mudança nas regras.
