"""PyInstaller 打包入口：以 app 对象方式启动 uvicorn（避免字符串导入在打包后失效）。

Electron 通过环境变量 CHEMAGENT_HOST / CHEMAGENT_PORT 指定监听地址；
日志写入数据根 logs/backend.log（--noconsole 打包后 stderr 不可用）。
"""
import logging
import os
from logging.handlers import RotatingFileHandler

from app.paths import data_root

# 先配置文件日志，再导入 app.main（避免其 basicConfig 绑定不可用的 stderr）
_log_file = data_root() / "logs" / "backend.log"
_log_file.parent.mkdir(parents=True, exist_ok=True)
_handler = RotatingFileHandler(str(_log_file), maxBytes=2_000_000, backupCount=3, encoding="utf-8")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[_handler],
)

import uvicorn

from app.main import app

if __name__ == "__main__":
    host = os.environ.get("CHEMAGENT_HOST", "127.0.0.1")
    port = int(os.environ.get("CHEMAGENT_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level="info")
