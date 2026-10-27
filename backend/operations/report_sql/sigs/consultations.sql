select UNIDADE_SOLICITANTE, vr.cbo, EQUI_NOME_REFERENCIA
AS EQUIPE, count(distinct vr.cd_agendamento)  AS QUANTIDADE 
from sigsaudej.vdic_mega_relatorios_001 vr

where vr.dt_atendimento >= :WPA_DATA_INICIAL AND vr.dt_atendimento < :WPA_DATA_FINAL + 1
GROUP BY UNIDADE_SOLICITANTE, CBO, EQUI_NOME_REFERENCIA 
ORDER BY UNIDADE_SOLICITANTE, 4 DESC
