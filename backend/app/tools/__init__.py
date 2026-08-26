"""Tool registry — import tools so they register themselves."""
from .registry import execute_tool, list_tools, tools_schema  # noqa: F401
from . import skills  # noqa: F401  (registers list_skills / read_skill)
from . import run_command  # noqa: F401  (registers run_command)
from . import chemvision_tool  # noqa: F401  (registers chemvision_call)
from . import kb_tool  # noqa: F401  (registers knowledge_base_search)
from . import file_ops  # noqa: F401  (registers list_dir / read_file / write_file)
