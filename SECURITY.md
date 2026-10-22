# Política de segurança

## Como reportar uma vulnerabilidade

**Não abra issue pública** para falhas de segurança. Mande um e-mail para **contato@gplansis.com** com o assunto `[iaVision][segurança]` contendo:

- o que é a falha e qual o impacto (ex.: acesso a dados de outra conta, execução de script, vazamento de chave);
- os passos para reproduzir (URL, requisição, navegador e versão);
- se possível, uma sugestão de correção.

Vamos confirmar o recebimento assim que possível, investigar, manter você informado e combinar a divulgação depois que a correção estiver no ar. Se quiser, damos crédito no `CHANGELOG.md`.

## Escopo

| Dentro | Fora |
|---|---|
| O código deste repositório (`site/`, `servicos/`) | Ataques de negação de serviço e testes de carga |
| O sistema no ar em https://aivision.gplansis.com | Engenharia social, phishing e acesso físico |
| Os serviços `aivision-treino`, `aivision-yt` e `aivision-via` | Falhas em bibliotecas de terceiros já públicas (avise o projeto de origem; uma nota para nós é bem-vinda) |
| Vazamento de chave, sessão, CSRF, XSS, controle de acesso | Relatórios automáticos sem prova de impacto |

Ao testar o sistema no ar, use **apenas a sua própria conta**, não acesse nem altere dados de outras pessoas e não envie quadros, imagens ou textos de terceiros.

## Boas práticas que o projeto segue

- A sessão vive em cookie `httpOnly`; a autorização é conferida no servidor a cada requisição.
- A chave da Anthropic usada pela Via fica **só no navegador do usuário**; os serviços recusam qualquer texto com cara de chave (`sk-ant-…`).
- Segredos dos serviços vêm de variáveis de ambiente / `.env`, que nunca entram no git.
- O processamento de vídeo acontece no dispositivo: nenhum quadro vai para o servidor durante a análise.

## Versões com suporte

Só a versão em produção (a mais recente do `CHANGELOG.md`) recebe correções de segurança.
