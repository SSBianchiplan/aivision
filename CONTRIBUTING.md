# Como contribuir com o GPlanSiS|iaVision

Obrigado por querer ajudar! O iaVision é visão computacional que roda **no navegador**, e cada operador novo, teste em outro aparelho, tradução ou correção de documentação faz diferença. Este guia mostra como montar o ambiente, o estilo do código, como criar um operador e como mandar o PR.

Leia também o [Código de Conduta](CODE_OF_CONDUCT.md). Falhas de segurança **não** vão para issues públicas: veja [SECURITY.md](SECURITY.md).

## Sumário

- [Por onde começar](#por-onde-começar)
- [Montar o ambiente](#montar-o-ambiente)
- [Estilo de código](#estilo-de-código)
- [Como criar um operador novo](#como-criar-um-operador-novo)
- [Testes](#testes)
- [Fluxo de PR](#fluxo-de-pr)
- [Licença das contribuições](#licença-das-contribuições)

## Por onde começar

- **Ideias prontas:** o [roadmap](docs/roadmap.md) tem cerca de 100 ideias com esforço estimado; as marcadas com ✓ são boas para começar.
- **Issues** com o rótulo `boa primeira issue`.
- **Testar em aparelhos diferentes:** GPUs Intel, AMD e NVIDIA, Android, iPhone, Safari e Firefox. Um relato bem feito ("modelo X em WebGPU dá caixas erradas na GPU Y") vale muito. Use o modelo de issue **Bug**.
- **Documentação:** guias de uso dos Studios, exemplos de preset, correções nas [docs](docs/README.md).
- **Traduções:** a interface e as docs estão em português; inglês e espanhol são bem-vindos (abra uma issue antes, para combinarmos o formato).

Antes de um trabalho grande, abra uma issue (modelo **Ideia de módulo/operador**) para alinharmos o desenho. Evita retrabalho dos dois lados.

## Montar o ambiente

Você precisa de **Python 3.8+** (só para o servidor local), **curl** e um navegador recente (Chrome ou Edge para WebGPU; Safari e Firefox também rodam, ver [compatibilidade](docs/compatibilidade.md)). Não há `npm install` nem build.

```bash
git clone https://github.com/SSBianchiplan/aivision.git
cd aivision
ferramentas/baixar-wasm.sh        # .wasm do ONNX Runtime Web (fora do git por tamanho)
python3 ferramentas/servir.py     # http://localhost:8800
```

- `ferramentas/servir.py` serve `site/` com os cabeçalhos de isolamento (COOP `same-origin`, COEP `require-corp`, CORP `same-origin`). Sem eles o ONNX Runtime não usa threads. Um servidor estático comum **não** serve.
- `ferramentas/baixar-wasm.sh` baixa do jsDelivr as versões exatas usadas pelo código: `onnxruntime-web@1.20.1` (`ort-wasm-simd-threaded.wasm` e `ort-wasm-simd-threaded.jsep.wasm`) em `site/vendor/ort/` e `onnxruntime-web@1.29.0` (`ort-wasm-simd-threaded.jsep.wasm`) em `site/relacoes/vendor/ort/`.

### Login local

O sistema (`/app.html`) pergunta ao servidor quem é o usuário em `api/me`. Para desenvolver sem a API, crie o arquivo `site/api/me` (a pasta `site/api/` é ignorada pelo git):

```json
{"authenticated": true, "challenge_required": false, "csrf": "x",
 "user": {"id": 1, "name": "Dev", "email": "dev@exemplo.local", "scopes": []}}
```

A página principal (`/`) e o Treinar (`/treino/`) abrem sem isso. Recursos que dependem de serviço (Treinar no servidor, busca do YouTube, memória da Via) não funcionam só com o servidor estático; cada serviço tem `Dockerfile` e `LEIA-ME.md` em [`servicos/`](servicos/).

### Pesos dos modelos

Os pesos (`.onnx`, cerca de 1,4 GB no total) **não estão no git**. O app baixa cada modelo de `models/...` ou `relacoes/models/...` quando o operador é usado; o caminho está no campo `file`/`files` de cada spec em `site/js/cv/runtime/onnx.js` e `site/js/cv/runtime/models-livres-*.js`. Baixe só os que for testar, do sistema no ar:

```bash
curl --create-dirs -o site/models/yolox.onnx https://aivision.gplansis.com/models/yolox.onnx
```

Os operadores clássicos (CV-01, CV-04, CounterVision por cor, Inspect sem modelo…) rodam sem peso nenhum. Há um vídeo de exemplo em `site/amostras/contador/esteira-cores.mp4` (Industrial › CounterVision › Abrir exemplo). Respeite a licença de cada modelo ([licencas.md](docs/licencas.md)); os da Ultralytics (YOLO26, YOLOE) são AGPL-3.0 e só carregam depois do aceite no app.

## Estilo de código

- **ES modules sem build.** Os arquivos em `site/js/` são servidos como estão. Nada de TypeScript, JSX, bundler ou transpilação.
- **React UMD + htm.** React e ReactDOM vêm vendorizados (`site/vendor/`) como globais; os componentes usam `html\`...\`` do htm em vez de JSX. Siga o padrão dos componentes vizinhos.
- **Nomes em português** para variáveis, funções, arquivos, comentários e textos da interface (`contagem`, `marcacoes`, `quadro`). Nomes de operador seguem o padrão `grupo.acao` (`inspect.blobs`, `contagem.cor`); os clássicos usam o nome do OpenCV (`imgproc.canny`).
- **Sem dependências novas sem discussão.** Biblioteca nova (mesmo pequena) precisa de issue antes: tamanho, licença compatível com AGPL-3.0 e se roda sob COEP. Quando aprovada, entra **vendorizada** em `site/vendor/` com versão no nome e registrada em [licencas.md](docs/licencas.md).
- **Desempenho importa:** nada de alocar buffer por quadro sem necessidade (use o pool de `core.js`), nada de inferência que bloqueie o render (ver as regras em [arquitetura.md](docs/arquitetura.md#regras-que-o-runtime-impõe-e-por-quê)).
- **Comentários que explicam o porquê**, não o quê. O código existente é bem comentado; mantenha o nível.
- **Textos:** frases curtas, português do Brasil, sem jargão desnecessário; números no formato brasileiro na interface (`numfmt.js`).
- **Python dos serviços:** FastAPI, biblioteca padrão quando der, segredos só por variável de ambiente.

## Como criar um operador novo

O pipeline referencia operadores **por nome**; um nome fora do registro não executa. O contrato está em `site/js/cv/operators/classical.js` e `site/js/cv/executor.js`.

### 1. O objeto do operador

```js
// site/js/cv/operators/livres-x.js  (ou num arquivo do grupo certo)
import { allocLike } from '../core.js';

export const meuOperador = {
  op: 'grupo.meu_operador',          // nome único, é o que fica salvo no pipeline
  label: 'Meu operador',             // rótulo curto na interface
  group: 'CV-41',                    // id do módulo a que pertence
  desc: 'Uma frase dizendo o que faz e quando usar.',
  params: {                          // viram controles no painel Pipeline
    limiar: { type: 'int', min: 0, max: 255, default: 128, label: 'Limiar' },
    modo:   { type: 'enum', options: ['claro', 'escuro'], default: 'claro', label: 'Modo' },
    mostrar:{ type: 'bool', default: true, label: 'Desenhar' },
  },
  apply(src, p, state, ctx) {
    // src   ImageData de entrada — NÃO mutar
    // p     parâmetros já validados e com default
    // state objeto persistente entre quadros deste nó (contadores, histórico…)
    // ctx   { w, h, overlay[], metrics{}, frameIndex, mirrored, grabFull? }
    const out = allocLike(src);        // buffer do pool
    out.data.set(src.data);
    // … processamento …
    ctx.overlay.push({ type: 'point', x: 10, y: 10, r: 3, color: '#FFD84D' });
    ctx.metrics['meu valor'] = 42;     // aparece na Telemetria
    return out;                        // ImageData (pode ser `src` se não mudar a imagem)
  },
};

export default [meuOperador];
```

Tipos de parâmetro usados hoje: `int`, `float`, `bool`, `enum`, `text`, `point`, `line`, `rect` e `banner` (aviso). Para desenhar, veja os tipos de overlay já usados nos operadores vizinhos (`point`, `rect`, linhas, rótulos).

### 2. Registrar

Em `site/js/cv/registry.js`: importe o arquivo, junte os operadores à lista e, se for um módulo novo, acrescente a entrada em `MODULES` (`id`, `name`, `status: 'ready'`, `runtime: 'client'` ou `'onnx'`, `desc`). Nada mais no app precisa mudar: o painel Módulos, a Via e o Pipeline leem do registro.

### 3. Se usar modelo ONNX

- Registre o spec do modelo (arquivo, tamanho em bytes, licença, origem) em `site/js/cv/runtime/models-livres-*.js`.
- Carregue com `ensure` e rode com `schedule` de `runtime/opkit.js`: a inferência **nunca** roda dentro do `apply`; o operador devolve o último resultado conhecido.
- Quadro guardado para depois de um `await` é cópia (`snapshot()` de `core.js`), nunca o `src`.
- Modelo novo fica em WASM até ser medido em WebGPU (lista `EP_WEBGPU` em `onnx.js`).
- Explique na issue de onde vêm os pesos e a licença; os pesos não entram no git.

### 4. Preset e documentação

- Se o operador faz sentido numa cadeia pronta, acrescente um preset em `PRESET_GROUPS` (`site/js/components/Panels.js`).
- `docs/modulos.md` é **gerado do código** (não edite à mão). Se você não tiver o gerador, descreva a mudança no PR e nós regeneramos.
- Documente o uso no doc da área (`docs/industrial.md`, `docs/esportes.md`…) e acrescente uma linha no `CHANGELOG.md`.

## Testes

Não há suíte com framework; os testes são no navegador e por script.

1. **Sintaxe** de todo JS alterado: `node --input-type=module --check < site/js/caminho/arquivo.js`.
2. **No app:** rode com `ferramentas/servir.py`, monte a cadeia com o operador novo e teste com câmera, arquivo de vídeo e imagem. Confira o console (sem erros nem avisos novos) e a Telemetria (ms por quadro).
3. **Fora do app:** importe `js/cv/executor.js` + `js/cv/registry.js` numa página de teste, monte um `ImageData` e chame `run(frame, nodes, i)` em laço. É o jeito de testar um operador de forma reprodutível.
4. **Celular:** abra pelo IP da máquina com HTTPS (câmera e WebGPU exigem contexto seguro fora de `localhost`) ou use o modo responsivo do DevTools (390 e 430 px).
5. **Serviços:** cada um tem instruções no `LEIA-ME.md`; o `aivision-via` tem `servicos/via/testes/teste_api.py`.

Mais detalhes, incluindo Chrome headless com câmera simulada, em [deploy-e-testes.md](docs/deploy-e-testes.md).

## Fluxo de PR

1. Faça um **fork** e crie um branch com nome descritivo (`operador-manometro`, `docs-bike-fit`, `corrige-ocr-safari`).
2. Commits pequenos e com mensagem clara em português ("Inspect: paquímetro aceita ROI girada").
3. Rode os testes acima e anexe **print ou vídeo curto** quando mudar algo visível.
4. Abra o PR para `main` preenchendo o modelo (o que muda, como testar, aparelhos testados, licenças).
5. Um mantenedor revisa; responda aos comentários com novos commits no mesmo branch.
6. Não suba: pesos (`.onnx`, `.data`), `.wasm`, vídeos grandes, `.env`, chaves de API ou dados de usuário. Arquivos acima de 5 MB não entram.

## Licença das contribuições

O iaVision é distribuído sob a **GNU AGPL-3.0** ([LICENSE](LICENSE)). Ao abrir um PR você declara que:

- o código é seu (ou você tem o direito de enviá-lo); e
- concorda em licenciá-lo sob a AGPL-3.0, a mesma licença do projeto.

Código copiado de outro projeto precisa de licença compatível com a AGPL-3.0 e da atribuição devida (cite a origem no PR e em [licencas.md](docs/licencas.md)). Modelos novos têm de informar licença e origem dos pesos.

Dúvidas? Abra uma issue com o modelo **Pergunta**.
