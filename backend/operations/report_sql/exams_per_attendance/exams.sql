select * from
(
Select 
       
       to_char(itped_rx.dt_realizado, 'dd/mm/yyyy') as "Data",
       count (*) as "Quantidade",
    
       prestador.nm_Prestador
From dbamv.set_exa, dbamv.ped_rx, dbamv.itped_rx, dbamv.exa_rx, dbamv.atendime, dbamv.ori_ate, dbamv.convenio c, dbamv.paciente, dbamv.cidade, dbamv.prestador
Where ped_rx.cd_set_exa = set_exa.cd_set_exa
  and itped_rx.cd_ped_rx = ped_rx.cd_ped_rx
  and exa_rx.cd_exa_rx = itped_rx.cd_exa_rx
  and nvl(itped_rx.sn_realizado, 'N') = 'S'
  and ped_rx.cd_atendimento = atendime.cd_atendimento
  and atendime.cd_ori_ate = ori_ate.cd_ori_ate
  and atendime.cd_paciente = paciente.cd_paciente
  and prestador.cd_prestador (+) = ped_rx.cd_prestador 
  and paciente.Cd_Cidade = cidade.cd_cidade
  and trunc(itped_rx.dt_realizado) BETWEEN :WPA_DATA_INICIAL AND :WPA_DATA_FINAL
  and atendime.cd_convenio = c.cd_convenio
  and atendime.tp_atendimento = 'U'
  and atendime.cd_convenio = 2
  and atendime.cd_ori_ate <> 46
  
GROUP BY 
  
       to_char(itped_rx.dt_realizado, 'dd/mm/yyyy'),
      
       prestador.nm_prestador 
)

UNION ALL

(

SELECT 
      
        to_char(EXAME_ATEND.DT_LAUDO, 'dd/mm/yyyy') as "Data",
       COUNT(*) as "Quantidade",
    
       nm_prestador
  FROM
       (SELECT ATENDIME.CD_ATENDIMENTO,
               PED_LAB . DT_PEDIDO,
               PED_LAB . CD_CON_PLA,
               CON_PLA . DS_CON_PLA,
               ATENDIME . CD_ORI_ATE,
               ORI_ATE . DS_ORI_ATE,
               ATENDIME . CD_PACIENTE,
               PACIENTE . NM_PACIENTE,
               ATENDIME . CD_CONVENIO,
               CONVENIO . NM_CONVENIO,
               SETOR . NM_SETOR,
               ITPED_LAB.DT_LAUDO,
               PED_LAB . CD_PED_LAB CD_PED_RX,
               trunc(ITPED_LAB . CD_TECNICO_EXEC) CD_TECNICO,
               ITPED_LAB . CD_EXA_LAB CD_EXA_RX,
               EXA_LAB.CD_PROCEDIMENTO_SIA,
               (DECODE(ITPED_LAB . SN_REALIZADO, 'N', ' * ', '') || EXA_LAB .
                NM_EXA_LAB) DS_EXA_RX,
               DECODE(atendime.tp_atendimento,'A','Ambulatorio','U','Urgencia/Emergencia','I','Internacao','E','Externo') TP_ATENDIMENTO,
               ITPED_LAB . CD_MEDICO_EXEC CD_PRESTADOR,
                             paciente.cd_paciente cdp,
                             cidade.nm_cidade,
                             prestador.nm_Prestador
          FROM DBAMV . ATENDIME,
               DBAMV . ORI_ATE,
               DBAMV . PACIENTE,
               DBAMV . PED_LAB,
               DBAMV . CONVENIO,
               DBAMV . SETOR,
               DBAMV . ITPED_LAB,
               DBAMV . EXA_LAB,
               DBAMV . CON_PLA,
               Dbamv . Empresa_Con_Pla
               ,dbamv.cidade,
               dbamv.prestador
         Where Empresa_Con_Pla . Cd_Multi_Empresa = 1
           And Empresa_Con_Pla . Cd_Convenio = Con_Pla .
         Cd_Convenio
           And Empresa_Con_Pla . Cd_Con_Pla = Con_Pla . Cd_Con_Pla
           And ATENDIME . CD_ORI_ATE = ORI_ATE . CD_ORI_ATE
           AND ATENDIME . CD_PACIENTE = PACIENTE . CD_PACIENTE
           AND ATENDIME . CD_ATENDIMENTO = PED_LAB . CD_ATENDIMENTO
           AND PED_LAB . CD_CONVENIO = CONVENIO . CD_CONVENIO
           AND PED_LAB . CD_CONVENIO = CON_PLA . CD_CONVENIO(+)
           AND PED_LAB . CD_CON_PLA = CON_PLA . CD_CON_PLA
           AND PED_LAB . CD_SETOR = SETOR . CD_SETOR
           AND ATENDIME . CD_MULTI_EMPRESA = 1
           AND ITPED_LAB . SN_REALIZADO = 'S'
           and atendime.cd_paciente = paciente.cd_paciente
           and paciente.Cd_Cidade = cidade.cd_cidade
           and prestador.cd_prestador (+) = ped_lab.cd_prestador 
           AND PED_LAB . CD_PED_LAB = ITPED_LAB . CD_PED_LAB
           AND ITPED_LAB . CD_EXA_LAB = EXA_LAB .         CD_EXA_LAB
           and atendime.tp_atendimento = 'U'
           and atendime.cd_convenio = 2
           and atendime.cd_ori_ate <> 46
           AND Trunc(ITPED_LAB.DT_LAUDO) BETWEEN :WPA_DATA_INICIAL AND :WPA_DATA_FINAL) EXAME_ATEND
 
 GROUP BY
       
    
       to_CHAR(EXAME_ATEND.DT_LAUDO, 'dd/mm/yyyy'),
     
       nm_prestador
)