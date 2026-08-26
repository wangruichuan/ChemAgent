"""SMILES 字符串验证与规范化工具"""

import re


def validate_smiles(smiles: str) -> bool:
    """基础 SMILES 格式验证（非严格，仅检查明显非法输入）"""
    if not smiles or not smiles.strip():
        return False
    s = smiles.strip()
    # 基本字符集检查：SMILES 只含特定字符
    valid_chars = re.compile(
        r'^[A-Za-z0-9@+\-\[\]\(\)\\\/=#$%.:~&!|{},*^]+$'
    )
    if not valid_chars.match(s):
        return False
    # 括号匹配检查
    depth = 0
    for ch in s:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if depth < 0:
            return False
    if depth != 0:
        return False
    # 方括号匹配
    depth = 0
    for ch in s:
        if ch == '[':
            depth += 1
        elif ch == ']':
            depth -= 1
        if depth < 0:
            return False
    if depth != 0:
        return False
    return True


def normalize_smiles(smiles: str) -> str:
    """规范化 SMILES 字符串"""
    if not smiles:
        return ""
    s = smiles.strip()
    # 去除引号
    s = s.strip("\"'`")
    # 去除常见前缀
    prefixes = ["SMILES:", "SMILES：", "smiles:", "smiles："]
    for prefix in prefixes:
        if s.startswith(prefix):
            s = s[len(prefix):].strip()
    return s


def is_likely_smiles(text: str) -> bool:
    """判断文本是否看起来像 SMILES（而非化学名称）"""
    if not text:
        return False
    s = text.strip()
    has_chinese = bool(re.search(r'[一-鿿]', s))
    if has_chinese:
        return False
    # 全小写且像英文化学名 → 不是 SMILES
    name_suffixes = ("ol", "ane", "ene", "one", "ase", "ine", "ide", "ate", "ite", "ose", "acid")
    if s.islower() and any(s.endswith(suffix) for suffix in name_suffixes):
        return False
    # 含有空格的通常是名称（SMILES 不含空格）
    if " " in s:
        return False
    # 含有 SMILES 特征字符（括号、双键、方括号等）
    smiles_chars = set("()[]=#/\\@+-.:")
    has_smiles_chars = any(c in smiles_chars for c in s)
    # 有 SMILES 特征字符 → 更可能是 SMILES
    if has_smiles_chars and validate_smiles(s):
        return True
    # 含有数字 + 小写字母（芳香环闭合标记，如 c1ccccc1）→ 可能是 SMILES
    has_digit = any(c.isdigit() for c in s)
    has_lower = any(c.islower() for c in s)
    if has_digit and has_lower and validate_smiles(s) and not s.isalpha():
        return True
    # 短字符串（≤5字符）且含大写字母（原子符号 C, O, N, S）→ 可能是 SMILES
    if len(s) <= 5 and any(c.isupper() for c in s) and validate_smiles(s):
        return True
    # 全大写短化学式（如 CO, CNO）→ 可能是 SMILES
    if len(s) <= 6 and s.isupper() and validate_smiles(s):
        return True
    return False
