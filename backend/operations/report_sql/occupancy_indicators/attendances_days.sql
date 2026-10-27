SELECT TO_DATE(DataC,'dd/mm/yyyy') DATA, DS_ORI_ATE, SUM(CONTOU) QUANTIDADE FROM (
Select Competencia,
       DataC,
      
       Tipo_Atendimento,
       ds_ori_ate,
       nm_cidade,
       count(*) CONTOU,
        Convenio
  from (SELECT --atendime. cd_atendimento as "Código Atendimento",
        TO_CHAR(atendime . dt_atendimento, 'dd/mm/yyyy') as DataC,
         TO_CHAR(atendime . dt_atendimento, 'mm/yyyy') as Competencia,
         --paciente . cd_paciente as "Código Paciente",
         --paciente . nm_paciente as "Nome Paciente",
         convenio . nm_convenio as "Convênio",
         case
           when convenio.cd_convenio in (1, 2) then
            'SUS'
           when convenio.cd_convenio in (43) then
            'PARTICULAR'
           when convenio.cd_convenio in (37) then
            'SANSAUDE'
           when convenio.cd_convenio in (30) then
            'IAMSPE'
           else
            'CONVENIO'
         end as convenio,
         ori_ate . ds_ori_ate,
         --DECODE(paciente.tp_sexo,'F','FEMININO','M','MASCULINO') as "Sexo",
         --trunc(((atendime.dt_atendimento - paciente.dt_nascimento)/365),0) as "Idade",
         DECODE(atendime.tp_atendimento,
                'A',
                'AMBULATORIO',
                'U',
                'URGENCIA/EMERGENCIA',
                'I',
                'INTERNACAO',
                'E',
                'EXTERNO') as Tipo_Atendimento,
        --prestador . nm_prestador as "Prestador",
        --especialid . ds_especialid as "Especialidade",
        cidade.nm_cidade 
        
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
           AND atendime . cd_convenio = con_pla .
         cd_convenio(+)
           AND atendime.cd_especialid = especialid.cd_especialid
           AND paciente.cd_cidade = cidade.cd_cidade(+)
           AND trunc(atendime.dt_atendimento) between
                CAST(:inicio AS DATE) AND CAST(:fim_exclusivo AS DATE) - 1
 
           and atendime . Cd_Multi_Empresa = 1
           AND (atendime.tp_atendimento like '%' and
               atendime.cd_atendimento_pai is null)
           AND Atendime.CD_MULTI_EMPRESA = '1'
        
        )
 group by  Competencia,
       DataC,
       Tipo_Atendimento,
       ds_ori_ate, 
       nm_cidade,
       Convenio
) GROUP BY TO_DATE(DataC,'dd/mm/yyyy'), DS_ORI_ATE
