## O que muda

<!-- Uma ou duas frases. Se resolve uma issue: "Fecha #123". Se vem do roadmap: "roadmap #I1". -->

## Tipo

- [ ] Correção de bug
- [ ] Operador / Studio / preset novo
- [ ] Desempenho
- [ ] Documentação ou tradução
- [ ] Serviço (`servicos/`)
- [ ] Outro:

## Como testar

<!-- Passo a passo: fonte (câmera, arquivo, vídeo de exemplo), cadeia do Pipeline, o que deve aparecer. -->

## Onde foi testado

- [ ] Chrome/Edge com WebGPU
- [ ] Chrome/Edge só WASM (`localStorage['iav.ort.ep'] = 'wasm'`)
- [ ] Safari (macOS ou iOS)
- [ ] Firefox
- [ ] Celular (qual?):

## Prints ou vídeo

<!-- Obrigatório se mudar algo visível. Borre rostos e dados sensíveis. -->

## Checklist

- [ ] `node --input-type=module --check` passou em todo JS alterado
- [ ] Sem erros novos no console
- [ ] Sem dependência nova (ou discutida na issue e vendorizada com licença em `docs/licencas.md`)
- [ ] Sem pesos, `.wasm`, `.env`, chaves ou arquivos acima de 5 MB
- [ ] Docs e `CHANGELOG.md` atualizados quando cabível
- [ ] Li o [CONTRIBUTING](../CONTRIBUTING.md) e concordo em licenciar esta contribuição sob a **AGPL-3.0**
