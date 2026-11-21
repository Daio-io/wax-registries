"""Generate a Wax registry from a pinned Radix Themes checkout."""
import json
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory

root = Path(sys.argv[1]).resolve()
package = Path("packages/radix-ui-themes")
components = package / "src/components"
package_name = "@radix-ui/themes"

def export_groups(source):
    return re.findall(r"\bexport\s*\{([^}]*)\}\s*(?:from\s*'([^']+)')?", source)

def members(group):
    for item in group.split(","):
        match = re.fullmatch(r"\s*(\w+)(?:\s+as\s+(\w+))?\s*", item)
        if match:
            local, public = match.groups()
            yield local, public or local

def source_path(module):
    return components / (Path(module).stem + ".tsx")

barrel = (root / components / "index.tsx").read_text()
public = {}
for group, module in export_groups(barrel):
    for local, name in members(group):
        if name[0].isupper() and name != "ThemeContext":
            public[(source_path(module), local)] = name

for namespace, module in re.findall(r"export \* as (\w+) from '([^']+)'", barrel):
    path = source_path(module)
    for group, _ in export_groups((root / path).read_text()):
        for local, name in members(group):
            public[(path, local)] = f"{namespace}.{name}"

with TemporaryDirectory() as temporary:
    projection = Path(temporary)
    (projection / components).mkdir(parents=True)
    (projection / package / "package.json").write_text(json.dumps({"name": package_name}))
    for path in sorted({path for path, _ in public}):
        projected_file = projection / path
        source = (root / path).read_text()
        existing = {name for group, _ in export_groups(source) for _, name in members(group)}
        existing.update(re.findall(r"(?m)^export\s+(?:const|function)\s+(\w+)", source))
        additional = sorted(local for file, local in public if path == file and local not in existing)
        if additional:
            source += "\nexport { " + ", ".join(additional) + " };\n"
        projected_file.write_text(source)
    discovery = json.loads(subprocess.check_output([
        "wax", "registry", "discover", "--design-system", "radix-themes",
        "--name", "Radix Themes", "--language", "react",
        "--repo-root", temporary, "--root", str(components), "--force", "--dry-run",
    ], stderr=subprocess.PIPE))

generated = {}
for component in discovery["components"]:
    evidence = component["details"].get("source_evidence")
    if evidence:
        key = (Path(evidence["path"]), component["symbol"])
        generated[key] = component["details"]

entries = []
for (path, local), symbol in sorted(public.items(), key=lambda item: item[1]):
    details = generated.get((path, local))
    if details is None:
        source = (root / path).read_text()
        for names, module in re.findall(r"import \{([^}]*)\} from '(\.[^']+)'", source):
            if local in {name for _, name in members(names)}:
                details = generated.get((source_path(module), local))
                break
    if details is None:
        # A direct assignment to a Radix primitive is a public component even
        # when its local declaration has no JSX for discovery to detect.
        for line_number, line in enumerate((root / path).read_text().splitlines(), 1):
            if re.fullmatch(rf"(?:export )?const {local} = \w+Primitive\.\w+;", line):
                details = {
                    "status": "partial",
                    "source_evidence": {
                        "path": path.as_posix(), "start_line": line_number, "end_line": line_number,
                    },
                    "signature": {"type_text": line},
                    "field_gaps": [
                        {"field": "signature.parameters", "reason": "Props are declared by the re-exported primitive."},
                    ],
                }
                break
    if details is None:
        print(f"Undiscovered public binding: {symbol} ({path})", file=sys.stderr)
        continue
    identifier = re.sub(r"([a-z\d])([A-Z])", r"\1-\2", symbol).lower().replace(".", "-")
    entries.append({"id": f"ds.{identifier}", "symbol": symbol, "package": package_name, "details": details})

assert len({entry["id"] for entry in entries}) == len(entries)
print(json.dumps({"schema_version": 1, "components": entries}, indent=2))
