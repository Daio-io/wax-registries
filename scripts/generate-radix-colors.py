"""Generate Wax color tokens from the literal exports in Radix Colors."""
import json
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
tokens = []
for filename in ("light.ts", "dark.ts", "blackA.ts", "whiteA.ts"):
    path = Path("src") / filename
    source = (root / path).read_text()
    pattern = r"export const (\w+) = \{\n(.*?)\n\};"
    assert not re.sub(pattern, "", source, flags=re.S).strip(), path
    for match in re.finditer(pattern, source, re.S):
        scale, body = match.groups()
        first_line = source.count("\n", 0, match.start(2)) + 1
        lines = body.splitlines()
        assert len(lines) == 12, scale
        for line_number, line in enumerate(lines, first_line):
            entry = re.fullmatch(r'  (\w+): ("[^"]+"),', line)
            assert entry is not None, (path, line_number)
            step, value = entry.groups()
            key = f"{scale}.{step}"
            tokens.append({
                "id": f"color.{key}",
                "key": key,
                "category": "color",
                "value": json.loads(value),
                "metadata": {"sources": [
                    {"kind": "declaration", "path": path.as_posix(), "start_line": line_number, "end_line": line_number},
                ]},
            })

assert len({token["key"] for token in tokens}) == len(tokens)
print(json.dumps({"schema_version": 1, "components": [], "tokens": sorted(tokens, key=lambda token: token["key"])}, indent=2))
