"""验证流媒体识别接口的提交、轮询与地址限制，不下载模型。"""

import importlib.util
import json
import sys
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


# 服务本身需要 MLX 和 numpy；接口测试只验证调度，替身避免启动模型。
sys.modules["mlx_whisper"] = types.ModuleType("mlx_whisper")
numpy = types.ModuleType("numpy")
numpy.ndarray = type("ndarray", (), {})
sys.modules["numpy"] = numpy
spec = importlib.util.spec_from_file_location("wdub_whisper_server_test", Path(__file__).with_name("whisper_server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class StreamEndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.http.model = server.DEFAULT_MODEL
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.http.server_port}/v1/video/transcriptions"

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()

    def test_submit_poll_and_result(self):
        def fake_download(_url, folder):
            path = Path(folder) / "audio.wav"
            path.write_bytes(b"test")
            return str(path)

        result = {"language": "en", "segments": [{"start": 0, "end": 1, "text": "Hello"}],
                  "words": [{"start": 0, "end": 1, "word": "Hello"}]}
        with patch.object(server, "download_audio", side_effect=fake_download), \
             patch.object(server, "transcribe_path", return_value=result):
            request = Request(self.base, data=json.dumps({"url": "https://example.com/watch/1",
                "model": server.DEFAULT_MODEL, "language": "en"}).encode(),
                headers={"Content-Type": "application/json"}, method="POST")
            with urlopen(request) as response:
                job_id = json.load(response)["job"]
            for _ in range(100):
                with urlopen(f"{self.base}/{job_id}") as response:
                    job = json.load(response)
                if job["stage"] == "done":
                    break
                time.sleep(0.01)
            self.assertEqual(job["stage"], "done")
            self.assertEqual(job["result"], result)

    def test_rejects_local_url(self):
        request = Request(self.base, data=json.dumps({"url": "http://127.0.0.1/video"}).encode(),
                          headers={"Content-Type": "application/json"}, method="POST")
        with self.assertRaises(HTTPError) as error:
            urlopen(request)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()

    def test_requires_connection_token(self):
        self.http.token = "test-token"
        try:
            body = json.dumps({"url": "http://127.0.0.1/video"}).encode()
            for headers in ({"Content-Type": "application/json"},
                            {"Content-Type": "application/json", "X-WDub-Token": "wrong"}):
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(self.base, data=body, headers=headers, method="POST"))
                self.assertEqual(error.exception.code, 401)
                error.exception.close()
            # 带上正确口令后应当越过口令检查，继续走到地址校验（400）
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(self.base, data=body, method="POST",
                                headers={"Content-Type": "application/json", "X-WDub-Token": "test-token"}))
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        finally:
            self.http.token = ""


if __name__ == "__main__":
    unittest.main()
