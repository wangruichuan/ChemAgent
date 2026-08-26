---
name: chemvision
description: Use this skill when the user asks about chemistry — chemical names, molecular structures (SMILES), molecular formulas, molecular weights, safety information (GHS hazards), or chemical reaction predictions. Supports Chinese and English chemical names, IUPAC names, and common names. Calls PubChem and OPSIN real chemistry databases to reduce LLM hallucinations. Returns molecular structure images and chemical equation renderings.
metadata:
  skill_version: "3.3.0"
  tags: ["AIPC", "chemistry", "agent", "tool-calling", "pubchem"]
description_zh: "当用户询问化学相关问题时使用此技能，包括化学品名称、分子结构（SMILES）、分子式、分子量、安全信息（GHS危险性）或化学反应预测。支持中英文化学名、IUPAC命名及常见名称。调用PubChem和OPSIN等真实化学数据库，降低大语言模型幻觉风险。返回分子结构图像与化学方程式渲染结果。"
---

# ChemVision AI 化学家

化学数据查询服务 — PubChem + OPSIN 真实数据库，分子结构图 + 化学方程式渲染。

## When to Use

- Chemical compound queries (name → structure, SMILES → info)
- Safety / GHS hazard information
- Chemical reaction prediction (Agent answers, tools provide data)
- Molecular structure image rendering

## Step 0: Ensure Service Is Running

Run these via the `run_command` tool with `cwd` = `{{SKILL_DIR}}` (the absolute path to this skill folder, already resolved for you). Do NOT use `cd` or `&&` — pass `cwd` explicitly (works on both Windows and Linux):

```
python manage.py status
```

> **Port note**: Default port is 8899. If occupied, the service auto-selects the next free port (8900, 8901...). Run `python manage.py status` to see the actual port. The service uses `CHEMVISION_PORT` env var (not `SERVER_PORT`) to avoid conflicts with the Agent host process.

If not running: `python manage.py start`  (cwd = skill dir)
To stop: `python manage.py stop`          (cwd = skill dir)

## Step 1: Call Tools

Use the **`chemvision_call`** tool (already available) — pass `tool_name` and a structured `arguments` object. **Do NOT build curl commands by hand** (Windows quoting is error-prone).

### name_to_structure

`chemvision_call(tool_name="name_to_structure", arguments={"name": "benzoic acid"})`

Returns SMILES, formula, weight, `svg_url`.

**Important**: Tools only accept English names. If the user asks in Chinese, Agent must translate to English first, then call the tool. Example: "苯甲酸" → "benzoic acid".

### inspect_smiles

`chemvision_call(tool_name="inspect_smiles", arguments={"smiles": "CCO"})`

### safety_info

`chemvision_call(tool_name="safety_info", arguments={"query": "benzene"})`

### predict_reaction

Queries chemical data for reactants. Agent should answer the reaction itself.

`chemvision_call(tool_name="predict_reaction", arguments={"reactants": "acetic acid + ethanol"})`

## Step 2: Show Results

### Molecular structure

1. Take the `svg_url` from the tool result
2. In your answer, output that URL on its own line (e.g. `结构图：<svg_url>`). The frontend automatically renders it inline as an image — do NOT tell the user to open it manually.

### Chemical equation

After answering a reaction, render the equation:

1. Build the equation URL: `http://localhost:8899/api/formula/{equation}`
2. Output that URL on its own line in your answer. The frontend automatically renders it inline — do NOT tell the user to open it manually.

**Equation format rules:**
- Subscripts automatic: `H2O`, `CH3COOH`, `Ca(OH)2`
- Superscripts: `Fe^{2+}`, `SO4^{2-}`
- Arrows: `->` (one way), `<=>` (equilibrium)
- Conditions: `[加热]`, `[催化剂]` (shown above/below arrow)
- Example: `CH3COOH+C2H5OH<=>[浓硫酸][加热]CH3COOC2H5+H2O`

### Fallback

If `predict_reaction` fails, the Agent answers directly using its own chemistry knowledge, then renders the equation via `/api/formula/`.

## Notes

- Pure data tools — NO LLM dependency, ALL reasoning by Agent
- All data from PubChem/OPSIN real databases
- Local only — chemistry data never leaves the machine
- Swagger UI: http://localhost:8899/docs
