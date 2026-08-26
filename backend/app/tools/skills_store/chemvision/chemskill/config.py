"""ChemVision Skill 配置管理（纯工具服务，无 LLM 依赖）"""

import os
from dataclasses import dataclass, field


@dataclass
class SkillConfig:
    """全局配置"""

    # FastAPI 服务
    server_host: str = field(
        default_factory=lambda: os.getenv("CHEMVISION_HOST", "0.0.0.0")
    )
    server_port: int = field(
        default_factory=lambda: int(os.getenv("CHEMVISION_PORT", "8899"))
    )

    # PubChem API
    pubchem_timeout: float = 10.0
    pubchem_max_retries: int = 3

    # OPSIN API
    opsin_timeout: float = 8.0


config = SkillConfig()
