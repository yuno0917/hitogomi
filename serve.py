"""同じWi-Fiのスマホから入れるように、このフォルダを配信してブラウザを開く。"""
import functools
import http.server
import socket
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def lan_ip():
    # UDPのconnectはパケットを送らない。外へ出るときに使うアドレスを知るだけ
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    handler = functools.partial(Handler, directory=str(ROOT))
    for port in range(8000, 8011):
        try:
            server = http.server.ThreadingHTTPServer(("0.0.0.0", port), handler)
            break
        except OSError:
            continue
    else:
        sys.exit("8000〜8010番が使えませんでした。")

    url = f"http://{lan_ip()}:{port}/"
    print("この中にニンゲンがいる（仮）")
    print()
    print(f"  PCで開くページ : {url}")
    print("  スマホはPCの画面のQRコードから入ってください（同じWi-Fiにつなぐ）。")
    print()
    print("  Windowsの「アクセスを許可する」画面が出たら、「プライベートネットワーク」で許可してください。")
    print("  終わるときは、この黒い画面を閉じてください。")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
