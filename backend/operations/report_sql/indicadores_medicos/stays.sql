SELECT EXTRACT(YEAR FROM DT) ANO,EXTRACT(MONTH FROM DT) MES,TIPO_CONVENIO,DS_ESPECIALID,COUNT(*) QUANTIDADE,SUM(DIAS) DIAS,MAX(DT) ULTIMA_DATA,ROUND(SUM(DIAS)/COUNT(*),2) MEDIA FROM (SELECT TO_DATE("Data_Alta_Medica",'DD/MM/YYYY') DT,"Dias_Internado" DIAS,TIPO_CONVENIO,DS_ESPECIALID FROM (SELECT ATENDIME.CD_ATENDIMENTO as "Atendimento",
       PRESTADOR.NM_PRESTADOR as "Prestador",
       es.ds_especialid,
       (atendime.dt_alta - atendime.dt_atendimento) as "Dias_Internado",
       ATENDIME.HR_ALTA as "Hora_Alta",
       MOT_ALT.DS_MOT_ALT as "Motivo_Alta",
       TO_CHAR(ATENDIME.DT_ALTA_MEDICA, 'DD/MM/YYYY') as "Data_Alta_Medica",       
       ATENDIME.HR_ALTA_MEDICA as "Hora_Alta_Medica",
       TO_CHAR(ATENDIME.DT_ALTA, 'DD/MM/YYYY') as "Data_Alta_Hospitalar",
       ATENDIME.HR_ALTA as "Hora_Alta_Hospitalar",
       case             
         when convenio.cd_convenio in (1,2) then 'SUS'
         when convenio.cd_convenio in (43) then 'PARTICULAR'
         else 'CONVENIO'
       end as tipo_convenio,  
       usuarios.nm_usuario,
       usuarios.cd_prestador,
       TO_CHAR(ATENDIME.DT_ALTA_MEDICA, 'DD/MM/YYYY') as "Alta_Medica",       
        TO_CHAR(ATENDIME.HR_ALTA_MEDICA, 'HH24:MI')  as "H_Alta_Medica"
  FROM DBAMV.ATENDIME,
       DBAMV.PACIENTE,
       DBAMV.PRESTADOR,
       DBAMV.CONVENIO,
       DBAMV.TIPO_INTERNACAO,
       DBAMV.MOV_INT,
       DBAMV.LEITO,
       DBAMV.UNID_INT,
       DBAMV.SERVICO,             
       DBAMV.MOT_ALT,
       DBAMV.CID,
       DBAMV.CIDADE,
       dbamv.especialid es,
       dbamv.sgru_cid,
       dbamv.gru_cid,
       dbasgu.usuarios      
 WHERE ATENDIME.TP_ATENDIMENTO IN ('I', 'H')
   AND ATENDIME.CD_MOT_ALT = MOT_ALT.CD_MOT_ALT(+)
   AND ATENDIME.CD_CID = CID.CD_CID(+)
   and cid.cd_sgru_cid = sgru_cid.cd_sgru_cid (+)
   and sgru_cid.cd_gru_cid = gru_cid.cd_gru_cid (+)
   and atendime.cd_especialid=es.cd_especialid
   AND ATENDIME.CD_SERVICO = SERVICO.CD_SERVICO   
   AND PACIENTE.CD_CIDADE = CIDADE.CD_CIDADE
  AND TRUNC(ATENDIME.DT_ALTA_MEDICA) BETWEEN :inicio AND TRUNC(:fim_exclusivo)-1   
   AND ATENDIME.CD_PACIENTE = PACIENTE.CD_PACIENTE
   AND ATENDIME.CD_PRESTADOR = PRESTADOR.CD_PRESTADOR
   AND ATENDIME.CD_CONVENIO = CONVENIO.CD_CONVENIO
   AND TIPO_INTERNACAO.CD_TIPO_INTERNACAO(+) = ATENDIME.CD_TIPO_INTERNACAO
   AND ATENDIME.CD_ATENDIMENTO = MOV_INT.CD_ATENDIMENTO
   AND MOV_INT.TP_MOV = 'I'
   AND MOV_INT.CD_LEITO = LEITO.CD_LEITO
   AND LEITO.CD_UNID_INT = UNID_INT.CD_UNID_INT(+)
   AND ATENDIME.CD_MULTI_EMPRESA = '1'
   AND ATENDIME.CD_ATENDIMENTO_PAI IS NULL
   and usuarios.cd_usuario = atendime.nm_usuario_alta_medica)) GROUP BY EXTRACT(YEAR FROM DT),EXTRACT(MONTH FROM DT),TIPO_CONVENIO,DS_ESPECIALID