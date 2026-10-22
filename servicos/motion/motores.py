"""
motores.py — os motores pesados do Motion 3D Studio (GVHMR, ExMR, FlowHMR) com estado HONESTO.

Nenhum peso, modelo de corpo (SMPL/SMPL-X) ou repositório de terceiros vem com este serviço.
Cada motor só fica "disponivel" quando o administrador do servidor:
  1. instala o repositório e os pesos no diretório do motor (AIV_MOTION_<MOTOR>_DIR), num
     ambiente Python/CUDA próprio, aceitando a licença de cada ativo;
  2. escreve ali um `iavision-adaptador.json` (ver ADAPTADOR abaixo) com o comando FIXO que roda
     o motor e converte a saída para o JSON do Studio (motionai.pose.v1);
  3. declara a licença como aceita (AIV_MOTION_<MOTOR>_LICENCA=aceita) — FlowHMR e o SMPL do
     GVHMR têm termos não comerciais / acesso restrito: quem instala responde por eles.
O ExMR fica "nao_verificado" até alguém confirmar repositório, versão e licença
(AIV_MOTION_EXMR_VERIFICADO=1): a sigla não tem fonte confirmada na especificação.

O comando vem SÓ do arquivo do servidor; o cliente escolhe o motor por nome numa lista fechada
e nunca manda caminho, argumento ou código (04-SEGURANCA-LGPD-OPERACAO.md).

ADAPTADOR (iavision-adaptador.json, no diretório do motor):
  {
    "versao": "GVHMR <commit>",
    "comando": ["/opt/motores/gvhmr/.venv/bin/python", "iavision_adaptador.py", "--video", "{video}", "--saida", "{saida}"],
    "tempo_max_s": 1800,
    "saida": "motionai.json"
  }
  Placeholders permitidos: {video} (arquivo enviado) e {saida} (diretório do job). O adaptador
  deve gravar {saida}/<saida> no formato gplansis.iavision.motion3d.take/1 (quadros motionai.pose.v1).
"""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from typing import Optional

ESTADOS = ("disponivel", "nao_instalado", "licenca_pendente", "nao_verificado")


@dataclass
class Motor:
    id: str
    nome: str
    repositorio: Optional[str]
    licenca: str
    papel: str
    exige_verificacao: bool = False
    restrito: bool = False
    extra: dict = field(default_factory=dict)

    @property
    def dir(self) -> str:
        return os.environ.get(f"AIV_MOTION_{self.id.upper()}_DIR", "")

    def adaptador(self) -> Optional[dict]:
        if not self.dir:
            return None
        p = os.path.join(self.dir, "iavision-adaptador.json")
        try:
            with open(p, encoding="utf-8") as f:
                a = json.load(f)
        except (OSError, ValueError):
            return None
        cmd = a.get("comando")
        if not isinstance(cmd, list) or not cmd or not all(isinstance(x, str) for x in cmd):
            return None
        return a

    def estado(self) -> tuple[str, str]:
        """(estado, detalhe) — sem rodar nada, só olhando o que o administrador instalou."""
        if self.exige_verificacao and os.environ.get(f"AIV_MOTION_{self.id.upper()}_VERIFICADO") != "1":
            return "nao_verificado", "Repositório, versão e licença ainda não confirmados; o motor fica desligado."
        if not self.dir or not os.path.isdir(self.dir):
            return "nao_instalado", "Repositório e pesos não instalados neste servidor (nada é baixado automaticamente)."
        if self.adaptador() is None:
            return "nao_instalado", "Falta o iavision-adaptador.json com o comando fixo do motor."
        if os.environ.get(f"AIV_MOTION_{self.id.upper()}_LICENCA") != "aceita":
            return "licenca_pendente", "Instalado, mas a licença dos ativos não foi declarada aceita pelo administrador."
        return "disponivel", ""

    def versao(self) -> Optional[str]:
        a = self.adaptador()
        return str(a.get("versao"))[:80] if a and a.get("versao") else None

    def executar(self, video: str, saida: str) -> str:
        """Roda o comando FIXO do adaptador; devolve o caminho do JSON gerado. Levanta em erro."""
        a = self.adaptador()
        if a is None:
            raise RuntimeError("adaptador ausente")
        cmd = [x.replace("{video}", video).replace("{saida}", saida) for x in a["comando"]]
        tempo = int(a.get("tempo_max_s") or 1800)
        r = subprocess.run(cmd, cwd=self.dir, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=tempo, check=False, env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": saida})
        if r.returncode != 0:
            raise RuntimeError(f"o motor terminou com código {r.returncode}")
        arq = os.path.join(saida, os.path.basename(str(a.get("saida") or "motionai.json")))
        if not os.path.isfile(arq):
            raise RuntimeError("o motor não gerou o arquivo de saída")
        return arq


MOTORES: dict[str, Motor] = {
    "gvhmr": Motor(
        "gvhmr", "GVHMR", "https://github.com/zju3dv/GVHMR",
        "Código: licença do repositório na versão instalada (verificar). Usa SMPL/SMPL-X do MPI: licença NÃO comercial, "
        "cadastro obrigatório; os modelos de corpo não podem ser redistribuídos.",
        "Corpo 3D e trajetória global a partir de vídeo monocular (processamento de vídeo, não tempo real).", restrito=True),
    "exmr": Motor(
        "exmr", "ExMR", None,
        "NÃO verificado: repositório, versão e licença sem fonte confirmada.",
        "Refinamento das extremidades: mãos, dedos, braços e pés.", exige_verificacao=True),
    "flowhmr": Motor(
        "flowhmr", "FlowHMR", "https://github.com/flowhmr/flowhmr",
        "Pesos e modelos de corpo com acesso restrito (cadastro); uso de pesquisa / não comercial.",
        "Movimento fisicamente plausível: animação mais natural e estável.", restrito=True),
}
# FreeMoCap é do contrato (openapi.yaml: engine freemocap), mas roda como aplicativo próprio: o Studio
# IMPORTA as sessões dele (NPY/CSV/JSON) no navegador. Aqui ele só aparece como "importação".
SO_IMPORTACAO = {"freemocap": "O FreeMoCap roda como aplicativo próprio (multicâmera); importe a sessão no Studio."}
