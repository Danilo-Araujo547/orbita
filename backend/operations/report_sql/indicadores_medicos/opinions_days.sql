WITH P AS (select pm.cd_atendimento,
       pm.dt_solicitacao,
       e.ds_especialid,
       pm.dt_parecer,
       to_char(pm.dt_parecer, 'dd/mm/yyyy') as data
  from dbamv.par_med    pm,
       dbamv.prestador  ps,
       dbamv.prestador  pr,
       dbamv.especialid e
 where pm.cd_prestador = ps.cd_prestador
   and pm.cd_prestador_parecer = pr.cd_prestador(+)
   and pm.cd_especialid = e.cd_especialid
   and pm.dt_cancelamento is null
   AND pm.dt_solicitacao >= :inicio AND pm.dt_solicitacao < :fim_exclusivo), A AS (SELECT atendime. cd_atendimento as "CD_ATENDIMENTO",
       TO_CHAR(atendime . dt_atendimento, 'mm/yyyy') as "Competencia",
       DECODE(atendime.tp_atendimento,'A','Ambulatorio','U','Urgencia/Emergencia','I','Internacao','E','Externo') as "Tipo_Atendimento"
  FROM dbamv . atendime,
       dbamv . paciente,
       dbamv . ori_ate,
       dbamv . convenio,
       dbamv . con_pla,
       dbamv . especialid,
       dbamv . prestador,
       dbamv . cidade    
 WHERE atendime . cd_paciente = paciente . cd_paciente
   AND atendime . cd_ori_ate = ori_ate . cd_ori_ate
   AND atendime . cd_convenio = convenio . cd_convenio
   AND atendime . cd_con_pla = con_pla . cd_con_pla(+)
   AND atendime . cd_prestador = prestador . cd_prestador(+)
   AND atendime . cd_convenio = con_pla . cd_convenio(+)
   AND atendime.cd_especialid = especialid.cd_especialid
   AND paciente.cd_cidade = cidade.cd_cidade(+)
   and atendime . Cd_Multi_Empresa = 1
   and atendime.tp_atendimento = 'U'
   AND atendime.dt_atendimento >= :inicio AND atendime.dt_atendimento < :fim_exclusivo), F AS (SELECT TO_DATE(P.DATA,'DD/MM/YYYY') DT,P.DS_ESPECIALID,CAST(P.DT_PARECER AS DATE)-CAST(P.DT_SOLICITACAO AS DATE) DIAS FROM P LEFT JOIN A ON A.CD_ATENDIMENTO=P.CD_ATENDIMENTO WHERE A."Tipo_Atendimento"='Urgencia/Emergencia' AND A.CD_ATENDIMENTO IS NOT NULL AND TO_DATE(P.DATA,'DD/MM/YYYY')>=:inicio AND TO_DATE(P.DATA,'DD/MM/YYYY')<:fim_exclusivo) SELECT TO_CHAR(DT,'YYYY-MM-DD') DATA,DS_ESPECIALID,COUNT(*) QUANTIDADE,SUM(ROUND(DIAS,3)) DIAS,ROUND(SUM(ROUND(DIAS,3))/COUNT(*),5) MEDIA_DIAS FROM F GROUP BY DT,DS_ESPECIALID