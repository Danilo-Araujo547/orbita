const guides = {
  overview: {
    title: "Visão geral",
    path: "/visao-geral",
    sections: [
      [
        "Indicadores",
        "Os indicadores usam a unidade e os filtros selecionados. Clique em um indicador para abrir os registros correspondentes. Agendamentos e mensagens têm contagens diferentes.",
      ],
      [
        "Entregas e respostas",
        "Enviada, entregue e lida são estados de transporte. Confirmação e recusa são resultados das respostas. O prazo de ausência de resposta começa após a entrega confirmada.",
      ],
      [
        "Gráfico",
        "A distribuição considera a data de criação das mensagens dentro dos filtros de agendamento; não corresponde à data da consulta.",
      ],
    ],
  },
  appointments: {
    title: "Agendamentos",
    path: "/agendamentos",
    sections: [
      [
        "Filtros",
        "Escolha unidade, período e tipo de atendimento. Confira a referência do período: agendamento, envio ou resposta. Sem observação seleciona registros sem anotações da equipe.",
      ],
      [
        "Paciente e contatos",
        "Cada agendamento permanece único mesmo com vários números. Cada contato tem envio e resposta próprios. Uma confirmação válida confirma o agendamento; o silêncio ou a recusa em outro número não desfaz essa confirmação.",
      ],
      [
        "Ver mensagem",
        "O modal mostra conteúdo e respostas recebidas. Copiar resposta inclui texto, data, nome informado, contato e número de envio.",
      ],
      [
        "Registrar ações",
        "Confirmação, recusa e observações abrem modais na própria tela. Registre canal, interlocutor e descrição quando solicitado. As ações preservam autoria e horário; não atribuem o paciente a um operador.",
      ],
      [
        "Correções",
        "Contato inválido, destinatário incorreto, falha e resposta ambígua têm motivos distintos. Solicitar uma movimentação não altera automaticamente a agenda hospitalar.",
      ],
    ],
  },
  groups: {
    title: "Grupos de agendamentos",
    path: "/grupos",
    sections: [
      [
        "Agrupamento",
        "Os grupos reúnem agendamentos da mesma regra, tipo e data de atendimento. Os totais de agendamentos únicos e mensagens são separados: vários contatos podem gerar várias mensagens para um agendamento.",
      ],
      [
        "Abrir grupo",
        "Clique no grupo para consultar seus agendamentos em uma rota específica.",
      ],
      [
        "Programação",
        "Editar programação altera data e hora de envio e intervalo entre mensagens pendentes. Mensagens já enviadas preservam o histórico. Salvar não libera envios pausados nem habilita o transporte real.",
      ],
    ],
  },
  groupDetail: {
    title: "Detalhe do grupo",
    path: "/grupos",
    sections: [
      [
        "Agendamentos",
        "A lista contém apenas os agendamentos do grupo aberto, sem duplicá-los pela quantidade de contatos. Os filtros restringem essa lista.",
      ],
      [
        "Mensagens e respostas",
        "Ver mensagem abre conteúdo e respostas no modal. Confirmação, recusa e observações seguem as regras da tela de Agendamentos.",
      ],
      [
        "Editar programação",
        "Data, hora e intervalo se aplicam às mensagens pendentes. O intervalo vale por mensagem de destino, inclusive para contatos diferentes do mesmo paciente. Envios anteriores não são reprogramados.",
      ],
    ],
  },
  messages: {
    title: "Mensagens",
    path: "/mensagens",
    sections: [
      [
        "Estados",
        "Fila, envio, entrega, leitura, falha e resultado incerto descrevem o transporte. Aceitação pela API não comprova entrega. Resultado incerto exige conferência antes de reenvio.",
      ],
      [
        "Detalhe",
        "Abra a mensagem para consultar conteúdo, destinatário, parâmetros, origem, tentativas e respostas. O registro preserva a fotografia usada no envio.",
      ],
      [
        "Respostas",
        "Contexto do provedor e finalidade determinam vínculo e interpretação. Respostas sem contexto suficiente exigem revisão. O prazo começa após entrega confirmada.",
      ],
      [
        "Testes",
        "O processamento simulado registra eventos sem enviar WhatsApp. O transporte real continua bloqueado mesmo com credenciais Meta cadastradas.",
      ],
    ],
  },
  issues: {
    title: "Pendências",
    path: "/pendencias",
    sections: [
      [
        "Seleção",
        "A lista reúne correções acionáveis. Registros apenas aguardando resposta dentro do prazo não são pendências. Uma confirmação válida por qualquer contato mantém o agendamento confirmado.",
      ],
      [
        "Revisão",
        "Confira motivo, contatos, mensagens e histórico. Número inválido, pessoa desconhecida, falha, resposta livre e vínculo ambíguo exigem tratamentos distintos.",
      ],
      [
        "Registro",
        "Use as ações disponíveis para corrigir vínculos, classificar respostas e registrar observações. Correções preservam o original e a autoria. Ausência de resposta não comprova falta ao atendimento.",
      ],
    ],
  },
  campaigns: {
    title: "Importa CROSS",
    path: "/importa-cross",
    sections: [
      [
        "Importar planilha",
        "Adicionar importação abre layout e arquivo CSV/XLSX. O layout precisa estar validado para a unidade. Revise erros, totais e duplicidades antes de confirmar.",
      ],
      [
        "Importa CROSS",
        "Adicionar importação CROSS define finalidade, template e programação. Importar dados, criar importação CROSS e liberar notificações são etapas distintas.",
      ],
      [
        "CROSS e busca ativa",
        "Permanência na fila e convocação são finalidades diferentes. Reimportar o mesmo arquivo não deve duplicar avisos; ausência em outra planilha não determina saída da fila.",
      ],
      [
        "Pós-cirúrgico",
        "A referência temporal é a data do procedimento. Respostas indicando problemas vão à equipe. A conclusão exige registro humano, sem diagnóstico automático.",
      ],
    ],
  },
  reports: {
    title: "Relatórios",
    path: "/relatorios",
    sections: [
      [
        "Catálogo",
        "O catálogo lista definições e disponibilidade por unidade. Relatórios sem fonte validada ou definição recuperável permanecem indisponíveis.",
      ],
      [
        "Solicitar",
        "Adicionar solicitação abre os parâmetros. Geração e entrega têm estados separados. Consulte o resultado e o arquivo quando disponíveis.",
      ],
      [
        "Entrega",
        "Solicitação, geração e entrega verificam permissões. WhatsApp exige destinatário autorizado e canal homologado; gerar um arquivo não comprova envio ou leitura.",
      ],
      [
        "Fontes",
        "O painel não executa SQL arbitrário. Definições revisadas usam fontes permitidas e limites de duração, linhas e tamanho.",
      ],
    ],
  },
  operationsAdmin: {
    title: "Administração",
    path: "/administracao",
    sections: [
      [
        "Cadastros",
        "Escolha a categoria e use Adicionar ou Editar. As configurações pertencem à unidade selecionada e não são copiadas automaticamente entre unidades.",
      ],
      [
        "Origens e regras",
        "Cadastre view Oracle, tipo e evidência de validação. Origens precisam estar verificadas. Regras definem referência temporal, template, dias e horário. Fluxos sem evidência permanecem desabilitados.",
      ],
      [
        "Unidades",
        "Informe nome, identificador e fuso horário. Novas unidades começam pausadas, sem copiar conexões ou regras hospitalares.",
      ],
      [
        "Relatórios",
        "Associe usuário, número verificado e relatórios permitidos. Agendamentos de geração começam desabilitados; configurar horário não homologa entrega pelo WhatsApp.",
      ],
      [
        "Preparos",
        "Cadastre código, conteúdo e versão. Associação automática depende do código do procedimento; correspondência apenas pelo nome exige revisão.",
      ],
      [
        "Layouts CROSS",
        "Mapeie identificador, paciente, telefone e data. Layouts são específicos da unidade e versionados. Valide amostras antes de habilitar importações.",
      ],
    ],
  },
  settings: {
    title: "Configurações",
    path: "/configuracoes",
    sections: [
      [
        "Unidades e categorias",
        "Configurações reúne Instância, Integrações, Operação, Cadastros e Monitoramento em uma lista. Abrir exibe os registros da seção em modal; Adicionar ou Editar abre o formulário correspondente. Usuários e acessos também fica nesta lista. A unidade é selecionada somente no topo da barra lateral.",
      ],
      [
        "Tema",
        "O botão no cabeçalho mostra o modo atual. Cada clique alterna entre Claro, Escuro e Sistema. A preferência é preservada; Sistema acompanha o tema do sistema operacional.",
      ],
      [
        "Controle de envios",
        "Pausar interrompe novos envios. Habilitar testes não remove o bloqueio do transporte real. O prazo de resposta é contado em horas após entrega confirmada.",
      ],
      [
        "Oracle",
        "Informe host, porta, Service Name/SID, usuário, senha e timeout no modal. Todos os dados são criptografados no PostgreSQL com uma chave derivada da senha do administrador que salva. A senha do administrador é validada e não fica armazenada.",
      ],
      [
        "Desbloqueio Oracle",
        "Salvar desbloqueia por 12 horas. No ambiente local, reiniciar o backend elimina o desbloqueio. Com Redis, API e workers compartilham uma concessão criptografada com TTL. Bloquear impede novas consultas; consultas em andamento podem terminar.",
      ],
      [
        "Senha do administrador",
        "Somente o autor desbloqueia. Se sua senha mudar, recadastre as credenciais Oracle. Outro administrador autorizado pode substituir o cadastro completo com sua própria senha. Cadastro bloqueado não usa credenciais antigas do ambiente.",
      ],
      [
        "Teste Oracle",
        "Executa SET TRANSACTION READ ONLY, SELECT 1 FROM DUAL e rollback. Não consulta pacientes nem importa agendamentos. Thin/Thick é uma configuração do processo do servidor, não de cada conexão.",
      ],
      [
        "Meta",
        "Cadastre WABA ID, ID do número, versão Graph API e token com permissão whatsapp_business_management. Segredos são somente de escrita: campos vazios preservam o valor; Remover credencial salva elimina o segredo indicado. App Secret e token de verificação são reservados para o webhook.",
      ],
      [
        "Templates Meta",
        "Validar e consultar templates verifica acesso, vínculo do número, aprovação, texto e quantidade de variáveis. Não importa regras nem envia mensagens. O significado dos parâmetros exige revisão. Após falha, o catálogo anterior pode continuar visível com sua data de consulta.",
      ],
      [
        "Instâncias remotas",
        "Gere a chave na origem e informe URL base e chave na outra instalação. A URL não inclui /api/v1. HTTPS é obrigatório em endereços públicos; HTTP é aceito em rede privada. A conexão é validada antes de salvar.",
      ],
      [
        "Chaves e registros remotos",
        "A chave aparece uma única vez e autoriza uma unidade conforme perfil e validade. Revogar ou desativar seu emissor interrompe acesso. Registros operacionais ficam na origem; localmente são guardados metadados e a chave protegida. Configure o Oracle diretamente na origem.",
      ],
      [
        "Regras e templates locais",
        "Alterar regra cria nova versão e invalida lembretes pendentes incompatíveis. Cadastro local não comprova aprovação Meta. Confira nome, idioma, texto, variáveis e finalidade.",
      ],
      [
        "Importações e atividades",
        "Adicionar importação seleciona regra e data. O histórico registra execuções, autor e horário. Salvar credenciais não executa importação automaticamente.",
      ],
    ],
  },
  users: {
    title: "Usuários",
    path: "/usuarios",
    sections: [
      [
        "Acessos",
        "Os acessos são definidos por unidade, perfil e seção. Leitura permite consulta; edição libera ações correspondentes. A autorização é verificada no backend, independentemente da visibilidade do menu.",
      ],
      [
        "Administração",
        "A gestão de usuários exige acesso administrativo. Permissões não podem superar o escopo do administrador ou da autorização da instância de origem.",
      ],
    ],
  },
};
const params = new URLSearchParams(location.search);
const screen = params.get("tela") || "overview";
const guide = Object.hasOwn(guides, screen) ? guides[screen] : null;
const title = document.getElementById("title");
const content = document.getElementById("content");
if (guide) {
  title.textContent = guide.title;
  document.title = `${guide.title} · Ajuda Órbita`;
  const unit = params.get("unit");
  document.getElementById("back").href =
    guide.path + (unit ? `?unit=${encodeURIComponent(unit)}` : "");
  for (const [heading, text] of guide.sections) {
    const section = document.createElement("section");
    const h2 = document.createElement("h2");
    h2.textContent = heading;
    const p = document.createElement("p");
    p.textContent = text;
    section.append(h2, p);
    content.append(section);
  }
} else {
  title.textContent = "Documentação indisponível";
  const p = document.createElement("p");
  p.textContent = "Não há documentação para a tela informada.";
  content.append(p);
}
