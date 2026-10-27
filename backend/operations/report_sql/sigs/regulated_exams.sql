select vr11.unidade,
       vr11.data,
       vr11.profissional,       
       vr11.procedimento,
       vr11.obs,
       vr11.cd_paciente || '-' ||  vr11.paciente as paciente
from sigsaudej.vdic_mega_relatorios_011 vr11
where vr11.unsa_cod in ('107-1','105-1')
and vr11.data >= :WPA_DATA_INICIAL AND vr11.data < :WPA_DATA_FINAL + 1
and vr11.obs is not null
order by 1, 2, 3
