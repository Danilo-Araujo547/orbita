select UNIDADE_SOLICITANTE, vr.procedimento,  count(distinct vr.cd_agendamento)  AS QUANTIDADE 
from sigsaudej.vdic_mega_relatorios_001 vr
where vr.dt_atendimento >= :WPA_DATA_INICIAL AND vr.dt_atendimento < :WPA_DATA_FINAL + 1 GROUP BY UNIDADE_SOLICITANTE, vr.procedimento ORDER BY UNIDADE_SOLICITANTE, 3 DESC
