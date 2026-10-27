# Investigação do acesso ao WhatsReport

Consulta realizada em 2026-10-25T02:36:04.991652+00:00. Escopo somente leitura.

## Constatações

- O acesso Firebird `SCV_TECNICO` é independente da senha da interface do WhatsReport.
- Consulta ao `BASE.FDB`, em transação READ ONLY/SNAPSHOT: `TBUSUARIO` possui **zero registros**. Nenhum valor de senha foi selecionado. Não foram encontradas procedures de usuário/senha pelos respectivos nomes.
- A tabela `TBADMINISTRADOR` contém cadastro de administradores/destinatários e não apresenta campo SENHA na estrutura recuperada.
- No `WhatsReport.exe` preservado, o formulário `TfrmSenha` oferece Administrador, Usuário e Mega. O botão Confirmar apenas verifica preenchimento e fecha a janela; a validação ocorre no chamador.
- No ramo Administrador do chamador, o executável obtém texto de um recurso HTTP do fornecedor Mega Online, remove espaços e compara com a senha informada. O helper usa funções WinINet para abrir e ler a URL. Portanto, esse ramo não consiste em consultar/alterar a senha em `TBUSUARIO`.
- Não foi encontrada opção de recuperação no formulário de senha preservado. Ausência nesse formulário não prova inexistência em outras versões ou ferramentas do fornecedor.

## Limite da conclusão

A análise estática foi realizada na cópia preservada de `WhatsReport.exe`. Ainda não foi obtida e comparada a versão exata de `WhatsReport_Configuracao.exe` instalada. O mecanismo encontrado é evidência da versão analisada; não equivale a um teste de autenticação da configuração em produção.

## Encaminhamento

Não há procedimento local de reset validado. Não executar UPDATE/INSERT em TBUSUARIO para tentar abrir essa tela. Solicitar ao fornecedor/responsável uma credencial ou recuperação oficial do acesso de configuração. Para aprofundar a confirmação, comparar a rotina no executável exato da configuração, somente em cópia e sem executá-lo.

Não foram acessados os conteúdos dos recursos de autenticação do fornecedor; não houve tentativa de adivinhar senha, alteração no banco, alteração do executável, reinício, geração ou envio de relatório.

## Evidências

`/opt/backups/orbita/whatsreport-auth-investigation-20261025/findings.json`

`/opt/backups/orbita/whatsreport-auth-investigation-20261025/administrator_validation_disassembly.txt`

As evidências não incluem senhas nem o conteúdo dos recursos de autenticação do fornecedor.
