import os
import ast

for root, dirs, files in os.walk('app'):
    for f in files:
        if f.endswith('.py'):
            path = os.path.join(root, f)
            try:
                ast.parse(open(path, encoding='utf-8').read(), filename=path)
            except SyntaxError as e:
                print(f'Syntax error in {path}: {e}')
