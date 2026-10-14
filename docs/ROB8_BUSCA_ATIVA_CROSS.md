# Busca ativa e Importa CROSS

Verificação em 12/10/2026. Leitura de evidências locais e de executáveis remotos em memória; nenhum envio ou rotina de importação executado. Nenhum arquivo de investigação salvo no servidor remoto.

## Pós-cirúrgico — evidência do servidor 172.19.0.123

A view Oracle `DBASISTEMAS.VDIC_BUSCA_ATIVA_ENVIO_MSG` lê `DBAMV.VDIC_IF_CIRURGIAS_REALIZADAS`, retorna paciente, telefone, cirurgia, data, prontuário e mensagem pronta. Exclui códigos 3, 14, 33 e 36 extraídos de CD_PRINCIPAL. A regra clínica anterior à view de cirurgias não foi examinada.

O relatório 76 seleciona DATA_REALIZADO igual a TRUNC(SYSDATE + INTERVAL '-7' DAY), com destino POS_CIRURGICO e procedimento SINCRONIZAR_ROB8. O agendador 717 está cadastrado habilitado às 17:30, segunda a sábado; há outros agendadores e variantes. Cadastro não comprova execução.

O gatilho ativo POS_CIRURGICO_BI0 faz UPDATE OR INSERT em TBAVISOS, TIPO='PÓS CIRÚRGICO', CELULAR=NEW.telefone e MENSAGEM=NEW.mensagem. MATCHING(PARAM10, SEUID, TIPO, PARAM3). Portanto, a origem seleciona o paciente e a data do procedimento; o gatilho produz o aviso. Não extrapolar essa configuração para 172.16.0.123.

Fontes locais: Origem_Agendador_Regras.txt, Views_Origem_Agendamentos.sql e Oracle_Views_Definicoes_Confirmadas.txt em Documents/ROB8_172.19.0.123.

## Importa CROSS — evidência do servidor 172.16.0.124

Lidos como dados binários, sem executar, os arquivos C:\WhatsReport\Servidor\ImportarPlanilhaCross.exe e C:\WhatsReport\servidor_API\ImportarPlanilhaCross.exe contêm:

- Importar Planilha Cross CDR Busca Ativa
- Caminho Arquivo Planilha Excel Cross CDR Busca Ativa
- Busca Ativa CDR
- SELECT * FROM AGENDA_CROSS_DIARIA WHERE 1=1
- SELECT * FROM AGENDA_CROSS_CDR WHERE 1=1
- SELECT * FROM AGENDA_CROSS_CDR_BCA WHERE 1=1
- SELECT * FROM AGENDA_CROSS_ATENDIDOS
- SELECT * FROM TBAVISOS

Isso liga diretamente a funcionalidade à importação de planilhas CROSS/CDR e à tabela de busca ativa CDR. Os fragmentos não comprovam o mapeamento das colunas, a instrução que gera os avisos, os critérios de seleção nem se importar dispara envio imediatamente. Não confundir com o campo CROSS de algumas views Oracle, que concatena nome e nascimento.

No painel de 172.16.0.123, BUSCA ATIVA CDR pergunta se o paciente deseja continuar aguardando vaga. Busca Ativa é outro cadastro, cujo FILTRO é PÓS CIRÚRGICO. São finalidades distintas.

## Pendente

Identificar, na instalação efetiva de 172.16.0.123, o mapeamento de importação e o produtor de TBAVISOS para BUSCA ATIVA CDR. A tentativa de listar C$ nessa verificação não retornou e foi interrompida. As evidências dos outros servidores não comprovam a configuração atual dessa instalação.
