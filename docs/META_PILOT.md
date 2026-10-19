# Envio real de teste

Habilitação explícita de 14/10/2026: transporte `meta_test`, unidade AME, destinatário único definido pelo administrador e limite diário de 30 tentativas. Somente agendamentos sintéticos podem utilizar este piloto. Nenhum envio é iniciado pela ativação ou pela reimportação.

Em **Grupos → Editar envio → Disparar agora**, a liberação é manual, versionada, idempotente e auditada. O intervalo é aplicado à fila. O dispatcher local inicia junto com `Start-Local.ps1`. A pausa da unidade também interrompe o piloto.

O template configurado em `META_PILOT_TEMPLATE` precisa constar no catálogo aprovado e validado há menos de 24 horas. Nesta instalação é `confirmacao_consulta_sqlite_v1`, idioma `pt_BR`, texto fixo sem variáveis. O botão Flow recebe o identificador da mensagem em `flow_token`. A tela CONFIRMACAO do Flow 1113114081215929 recebe `medico`, `exame` e `error_message` em `flow_action_data`, preservados no snapshot a partir do agendamento. Isso não altera o texto fixo do corpo do template. Mídia, variáveis do corpo e outros botões exigem implementação específica e ficam bloqueados.

Credenciais criptografadas são lidas da configuração da unidade. Versão da configuração, número remetente, conteúdo e componentes são preservados na mensagem e conferidos antes do envio. Alterações posteriores bloqueiam o envio até nova liberação. O transporte utiliza somente o endpoint HTTPS Graph e não segue redirecionamentos.

Aceitação retorna um `wamid.*`; entrega e leitura dependem do webhook. A ativação do envio não muda o callback externo existente nem configura seu encaminhamento para esta instância.

Timeout, redirecionamento, erro 5xx ou sucesso sem identificador são resultados incertos e não provocam reenvio automático. Rejeições explícitas da API ficam como falhas. O limite diário considera tentativas e é protegido pelo mesmo bloqueio PostgreSQL da unidade usado na reserva de envio.

Para desabilitar: pausar a unidade imediatamente; definir `META_REAL_ENABLED=0` no ambiente e reiniciar os processos. Dados e histórico são preservados. Antes de voltar a simulação, revisar filas já liberadas.

Este piloto não habilita envio a pacientes reais ou relatórios. A implantação completa continua sujeita à validação e à divisão de responsabilidade com o legado.
