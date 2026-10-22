#!/usr/bin/env python3
"""Servidor estático para rodar o iaVision localmente (só biblioteca padrão).

Manda os mesmos cabeçalhos de isolamento da produção (COOP/COEP/CORP), sem os
quais o navegador não liga `crossOriginIsolated` e o ONNX Runtime Web não usa
threads. Também acerta os tipos MIME de .mjs e .wasm e desliga o cache.

Uso:
    python3 ferramentas/servir.py              # serve ./site em http://localhost:8800
    python3 ferramentas/servir.py site 9000    # pasta e porta explícitas

Abra http://localhost:8800/ (página principal) ou /app.html (sistema).
`localhost` conta como contexto seguro: câmera, WebGPU e service worker funcionam.
"""
import functools
import http.server
import mimetypes
import os
import sys

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/manifest+json", ".webmanifest")


class Manipulador(http.server.SimpleHTTPRequestHandler):
    # /yt/player.html é a única página servida SEM isolamento na produção
    # (o player do YouTube não carrega sob COEP no Safari/Firefox).
    SEM_ISOLAMENTO = ("/yt/player.html", "/yt/player.js")

    def end_headers(self):
        caminho = self.path.split("?", 1)[0]
        if caminho not in self.SEM_ISOLAMENTO:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Servidor(http.server.ThreadingHTTPServer):
    request_queue_size = 256   # o app abre muitas conexões em paralelo
    daemon_threads = True


def main():
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pasta = sys.argv[1] if len(sys.argv) > 1 else os.path.join(raiz, "site")
    porta = int(sys.argv[2]) if len(sys.argv) > 2 else 8800
    if not os.path.isfile(os.path.join(pasta, "app.html")):
        sys.exit(f"'{pasta}' não parece a pasta site/ (falta app.html)")
    falta = [a for a in ("ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.jsep.wasm")
             if not os.path.isfile(os.path.join(pasta, "vendor", "ort", a))]
    if falta:
        print("aviso: faltam os .wasm do ONNX Runtime em vendor/ort/ "
              f"({', '.join(falta)}). Rode ferramentas/baixar-wasm.sh.")
    h = functools.partial(Manipulador, directory=pasta)
    print(f"iaVision em http://localhost:{porta}/  (pasta {pasta}; Ctrl+C para sair)")
    try:
        Servidor(("127.0.0.1", porta), h).serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
