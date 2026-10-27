SELECT TO_DATE(Dia,'dd/mm/yyyy') DATA, CONVENIO, TP_CIRURGIAS, COUNT(*) QUANTIDADE FROM (
select DISTINCT AVISO_CIRURGIA.CD_AVISO_CIRURGIA as "ID",
       TO_CHAR(AVISO_CIRURGIA.DT_REALIZACAO, 'mm/yyyy') as Competencia,
       TO_CHAR(AVISO_CIRURGIA.DT_REALIZACAO, 'dd/mm/yyyy') as Dia,
       AVISO_CIRURGIA.CD_CEN_CIR as "Centro_Cirurgico",
       case             
         when convenio.cd_convenio in (1,2) then 'SUS'
         when convenio.cd_convenio in (43) then 'PARTICULAR'
                        when convenio.cd_convenio in (37) then 'SANSAUDE'
             when convenio.cd_convenio in (30) then 'IAMSPE'  
         else 'CONVENIO'
       end as convenio,
        AVISO_CIRURGIA.TP_CIRURGIAS
  FROM
       DBAMV.ATENDIME,
       DBAMV.AVISO_CIRURGIA,
       DBAMV.CIRURGIA_AVISO,
       DBAMV.CIRURGIA,
       DBAMV.CONVENIO,
       Dbamv.Empresa_Convenio,
       DBAMV.PACIENTE,
       DBAMV.ESPECIALID,
       DBAMV.CIDADE,
       DBAMV.TIP_ANEST
 Where 
   Empresa_Convenio.Cd_Convenio = Convenio.Cd_Convenio
   AND Empresa_Convenio.Cd_Multi_Empresa = 1
   AND atendime.Cd_Multi_Empresa =1
   AND PACIENTE.CD_CIDADE = CIDADE.CD_CIDADE(+)
   AND CIRURGIA_AVISO.CD_ESPECIALID = ESPECIALID.CD_ESPECIALID
   AND AVISO_CIRURGIA.CD_TIP_ANEST = TIP_ANEST.CD_TIP_ANEST(+)
   AND ATENDIME.CD_ATENDIMENTO = AVISO_CIRURGIA.CD_ATENDIMENTO
   AND ATENDIME.CD_PACIENTE = PACIENTE.CD_PACIENTE
   AND CIRURGIA_AVISO.CD_CONVENIO = CONVENIO.CD_CONVENIO
   AND AVISO_CIRURGIA.TP_SITUACAO = 'R'
   AND AVISO_CIRURGIA.CD_AVISO_CIRURGIA = CIRURGIA_AVISO.CD_AVISO_CIRURGIA
   AND CIRURGIA_AVISO.CD_CIRURGIA = CIRURGIA.CD_CIRURGIA
   AND trunc(aviso_cirurgia.dt_realizacao) between CAST(:inicio AS DATE) AND CAST(:fim_exclusivo AS DATE) - 1
   AND CIRURGIA_AVISO.CD_CONVENIO = CONVENIO.CD_CONVENIO
) WHERE "Centro_Cirurgico" = 1 GROUP BY TO_DATE(Dia,'dd/mm/yyyy'), CONVENIO, TP_CIRURGIAS
