# Локальный сервер для разработки: как `python3 -m http.server`, но запрещает браузеру кэш —
# иначе после правок браузер смешивает старые и новые модули и игра ломается.
# Запуск: python3 serve.py [порт]   (по умолчанию 8766)

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
print(f'http://127.0.0.1:{port}')
ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
