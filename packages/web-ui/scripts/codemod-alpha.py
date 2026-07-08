#!/usr/bin/env python3
"""One-shot codemod: convert hex-alpha color concatenation to alphaColor().

  `${expr}HH`        ->  `${alphaColor(expr, 'HH')}`
  expr + 'HH'        ->  alphaColor(expr, 'HH')

Adds the alphaColor import (from the package theme module) where needed.
"""
import os
import re
import sys

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src')
SKIP = {os.path.join(SRC, 'theme.ts')}

TPL = re.compile(r"\$\{([^{}`]+)\}([0-9a-fA-F]{2})(?![0-9a-zA-Z])")
EXPR = r"(\((?:[^()]|\([^()]*\))*\)|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]\[]+\])*)"
CONCAT = re.compile(EXPR + r"\s*\+\s*'([0-9a-fA-F]{2})'")

IMPORT_FROM_THEME = re.compile(r"import\s*\{([^}]*)\}\s*from\s*'([./]+theme)';")


def rel_theme_path(filepath: str) -> str:
    rel = os.path.relpath(os.path.join(SRC, 'theme'), os.path.dirname(filepath))
    return rel if rel.startswith('.') else './' + rel


def process(filepath: str) -> bool:
    with open(filepath, encoding='utf-8') as f:
        text = f.read()
    orig = text

    text = TPL.sub(lambda m: "${alphaColor(%s, '%s')}" % (m.group(1), m.group(2)), text)
    text = CONCAT.sub(lambda m: "alphaColor(%s, '%s')" % (m.group(1), m.group(2)), text)

    if text == orig:
        return False

    if 'alphaColor' in orig or re.search(r"\balphaColor\b", orig):
        pass  # already imported (unlikely)
    m = IMPORT_FROM_THEME.search(text)
    if m:
        names = [n.strip() for n in m.group(1).split(',') if n.strip()]
        if 'alphaColor' not in names:
            names.append('alphaColor')
            text = text[:m.start()] + "import { %s } from '%s';" % (', '.join(names), m.group(2)) + text[m.end():]
    else:
        # insert new import after the last import line
        imports = list(re.finditer(r"^import .*?;\s*$", text, re.M))
        insert_at = imports[-1].end() if imports else 0
        stmt = "\nimport { alphaColor } from '%s';" % rel_theme_path(filepath)
        text = text[:insert_at] + stmt + text[insert_at:]

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(text)
    return True


def main():
    changed = []
    for root, _dirs, files in os.walk(SRC):
        for name in files:
            if not name.endswith(('.ts', '.tsx')):
                continue
            path = os.path.join(root, name)
            if path in SKIP:
                continue
            if process(path):
                changed.append(os.path.relpath(path, SRC))
    print('\n'.join(sorted(changed)))
    print(f'-- {len(changed)} files changed')


if __name__ == '__main__':
    sys.exit(main())
