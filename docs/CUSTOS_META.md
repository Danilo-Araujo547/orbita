# Custos Meta

A aba `/custos-meta` consulta somente leitura em `GET /{WABA}/pricing_analytics`, com filtro obrigatório do telefone configurado na unidade. O servidor busca a moeda na WABA e o número na configuração Meta protegida. Tokens nunca são devolvidos ao navegador.

A consulta informa custos aproximados e volumes, incluindo categorias gratuitas, por dia, categoria e tipo de cobrança. A moeda é a da WABA; não há conversão cambial nem tarifa fixa estimada. Os valores pertencem ao número inteiro, incluindo envios realizados fora do SCV Messenger, e não são uma fatura consolidada.

`GET /api/v1/meta-costs/?unit=ame&start=2026-10-01&end=2026-10-22`

`refresh=true` ignora cache. Limite de 93 dias por consulta dentro dos últimos 12 meses; datas no fuso da unidade. O cache tem cinco minutos, separado por unidade, versão da configuração, WABA, telefone e período. Falhas têm cache de 30 segundos. Dados indisponíveis retornam totais nulos; resultado vazio válido retorna zero. Paginação usa apenas cursores, nunca URLs recebidas da Meta. Respostas de outro telefone são recusadas por inteiro.

A seção `costs` aparece na configuração de permissões de usuários. Acesso inicial de administradores; outros usuários dependem de concessão explícita. O backend verifica acesso antes de consultar credenciais, cache ou provedor. Instâncias remotas usam o mesmo contrato e as permissões da instância.

CSV é gerado a partir das linhas autorizadas carregadas na tela, com neutralização de fórmulas em campos textuais. Nenhuma operação dessa aba cria mensagens, filas ou envios.

Fontes: SDK oficial Meta `facebook-python-business-sdk`, `WhatsAppBusinessAccount.get_pricing_analytics`, e consulta de leitura validada nas contas já configuradas.
