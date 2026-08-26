/** 工具英文名 → 中文名 映射（仅用于展示；存储与逻辑仍用英文 name）。 */
export const TOOL_LABELS: Record<string, string> = {
  list_dir: "列出目录",
  read_file: "读取文件",
  write_file: "写入文件",
  run_command: "执行命令",
  list_skills: "列出技能",
  read_skill: "读取技能",
  knowledge_base_search: "知识库检索",
  chemvision_call: "化学查询",
}

/** 取工具的中文展示名；未登记的工具回退到英文名，保证不显示为空。 */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}
