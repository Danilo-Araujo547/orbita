# Relatórios operacionais ROB8 → SCV

## Contrato

Os relatórios operacionais consomem casos, eventos, mensagens, respostas e interações do SCV. Não leem TBAVISOS, CADASTRO_PRESTADORES ou Firebird. O histórico antigo não é importado por esta adaptação.

Fonte de banco de dados continua separada. A nova opção Relatórios → Instâncias do app cadastra uma origem local ou remota. Cada conexão pertence à unidade do catálogo e aponta explicitamente à unidade de dados local ou a uma RemoteInstance já cadastrada. Somente administrador autorizado na unidade de origem pode configurar a conexão local. Uma permissão de relatório autoriza a leitura da origem explicitamente vinculada; o usuário não pode trocar a unidade na solicitação.

Remotas reutilizam URL e chave criptografada da federação. O botão Conectar instância por URL e chave abre a configuração existente. Instalações remotas precisam executar esta versão do SCV e possuir chave administrativa da unidade de origem. A consulta GET reports/app-data é somente leitura, limitada à unidade da chave e a indicadores/filtros permitidos; não executa SQL arbitrário. Redirecionamentos, tamanho, tempo e autenticação usam o cliente de federação existente. Uma conexão remota indisponível bloqueia a geração, sem tentar dados locais.

## Indicadores

- Confirmados: resultado operacional confirmado, uma linha por agendamento/evento; vários telefones não duplicam a linha.
- Não confirmados: envio registrado e resultado diferente de confirmado.
- Não enviados: sem aceite/envio/entrega/leitura; resultados incertos e em processamento ficam fora dessa afirmação.
- Estatísticas WhatsApp: resultado por agendamento com resposta WhatsApp e denominador explícito. Confirmação manual por telefone não vira resposta WhatsApp.
- Quantidade de respostas: eventos de resposta e agendamentos distintos, em colunas separadas.
- Ligações: registros humanos do tipo call, por autor real e data da ligação. Média = ligações / dias com ligações, sem inventar jornada ou usar o responsável do caso como autor.
- Contatados: agendamentos com envio registrado, com ligação atendida e união dos agendamentos. Aceite API não significa entrega ou leitura.
- Ausentes: detalhamento por resposta, especialidade e ranking. Percentual usa os agendamentos respondidos. O ranking de tipos distintos preserva essa medida, não a confunde com pacientes.
- Pós-cirúrgico: contagens diárias de importação, envio e resposta por finalidade; não faz interpretação clínica.
- Campanhas: filtros fixos de categoria/procedimento preservados. Categoria sem correspondência nos dados atuais retorna vazio, não outra campanha.

O layout é montado em Canvas, incluindo composições. Mantêm-se os códigos, nomes, permissões e evidências originais; a adaptação fica em legacy.app_migration. Texto manual de descrição não é sobrescrito. Os parâmetros públicos passam a start/end (datas opcionais, início do mês até hoje, máximo 366 dias). As referências temporais variam por relatório: agendamento/procedimento, criação/importação, resposta ou ligação; o mapeamento é versionado em legacy.app_report.

Esta é uma adaptação às regras e entidades do SCV, não uma alegação de reprodução dos números históricos do ROB8. As procedures originais possuem diferenças e fontes que não existem no novo app. Ausência de dados históricos não é preenchida com números inventados.

## Cadastros e ativação

Comando migrate_rob8_app_reports (prévia) e --apply (transação). Novas unidades começam pausadas. Fontes AME/Sansaúde existentes podem ser usadas localmente; origens novas ficam com conexão desativada até configurar dados locais ou instância remota. Relatórios com dependências conectadas podem ser habilitados; os demais ficam desativados com pendência. Programações permanecem desativadas. Danilo -- STI recebe autorização manual nos relatórios finais.

A geração não envia mensagens. Nenhuma notificação é criada por esta migração. Metadados e resultados são auditados sem registrar corpos identificáveis nos logs.

## Limites e segurança

10.000 agendamentos, 50.000 mensagens/respostas/ligações por consulta, 30.000 linhas no Canvas e limites de arquivo existentes. Referências de outra unidade na conexão são rejeitadas. Endpoints de configuração de conexão não são delegados a chaves de instância; apenas a consulta de dados é.

Migrations aditivas: 0029_report_application_connections. Backup antes da alteração em /opt/backups/orbita/rob8-app-20261026/before.dump. Evidências de testes, geração e publicação na mesma pasta. Atualizações da planilha compartilhada somente via API.

## Resultado aplicado — 26/10/2026

121 cadastros adaptados: 93 fontes/indicadores e 28 composições. Foram criadas 18 unidades e 20 conexões do app (AME/Sansaúde locais ativas; 18 origens pendentes). Das 26 definições disponíveis, 13 são relatórios finais e 13 componentes. As 95 restantes dependem de configuração das novas origens. PDF validado nas 26 definições conectadas sem consulta SQL externa e sem criar mensagens.

Planilha Acompanhamento atualizada exclusivamente pela API: 121 linhas conferidas, com status, origem, dependência Firebird, próxima etapa, evidência e ativação. Os relatórios/componentes com fonte pendente usam destaque roxo; os disponíveis, verde. Datas e estados foram relidos pela API.

Testes: 122 aprovados na suíte de integração de relatórios; 17 testes específicos após o ajuste final de largura e tradução dos resultados. OpenAPI validado com zero erros (avisos preexistentes de nomes de schemas/enums). Composições usam a mesma largura de 1.600 pontos das tabelas analíticas. Nenhuma programação foi habilitada.

## Consultórios consolidados no NAS — 26/10/2026

As 15 unidades cm-* foram consolidadas na unidade NAS (id 6), com a conexão única SCV · NAS (id 4). Permanecem seis unidades e cinco conexões do app no servidor. Os 46 relatórios/indicadores municipais mantêm seus códigos e permissões; cada um usa um filtro exato clinic recuperado dos parâmetros legados. Outros 14 consumidores da fonte NAS continuam sem filtro individual, conforme seu mapeamento anterior.

Somente cadastros iniciais duplicados e sem uso foram removidos. A operação compara configurações com o NAS, rejeita referências operacionais, fontes ativas/remotas ou consultório sem filtro comprovado e executa tudo em transação. Nenhum paciente, agendamento, mensagem ou resposta foi excluído. Backup de metadados, testes e resultado em /opt/backups/orbita/nas-consolidation-20261026/. Cinco testes aprovados, incluindo bloqueio quando há dados e separação dos consultórios após consolidar. Planilha atualizada em 60 linhas exclusivamente pela API. A conexão NAS permanece com a mesma ativação anterior.

## Preparação das fontes locais — 27/10/2026

A pedido do usuário, habilitadas as conexões locais SCV · NAS, SCV · AME Jales e SCV · AME Santa Fé e 95 definições anteriormente desabilitadas: 38 relatórios e 57 componentes. O conjunto adaptado tem 121 definições habilitadas. As unidades de origem continuam pausadas e sem dados operacionais na verificação; os relatórios consultarão dados futuros das respectivas unidades. Não há instâncias remotas conectadas, nem importação do histórico do ROB8.

Conexões e relatórios auditados; programações e automações verificadas: zero habilitadas. Testadas consultas locais representativas das três unidades vazias e readiness das 121 definições, sem envios. Backup de metadados: `/opt/backups/orbita/rob8-prepare-local-20261027/before.json`. A planilha de acompanhamento ainda precisa ter os estados atualizados.
