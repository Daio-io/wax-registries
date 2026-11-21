"""Generate a Wax registry from a pinned Radix Primitives checkout."""
from copy import deepcopy
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
packages = Path("packages/react")

def exports(source):
    source = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.S)
    for group, module in re.findall(r"\bexport\s*\{([^}]*)\}\s*(?:from\s*'([^']+)')?", source):
        for item in group.split(","):
            match = re.fullmatch(r"\s*(\w+)(?:\s+as\s+(\w+))?\s*", item)
            if match:
                local, name = match.groups()
                yield local, name or local, module

barrel = (root / packages / "radix-ui/src/index.ts").read_text()
namespaces = re.findall(r"export \* as (\w+) from '(@radix-ui/react-[^']+)'", barrel)
command = [
    "wax", "registry", "discover", "--design-system", "radix-primitives",
    "--name", "Radix Primitives", "--language", "react",
    "--repo-root", str(root), "--force", "--dry-run",
]
for _, package in namespaces:
    command.extend(("--root", str(packages / package.removeprefix("@radix-ui/react-") / "src")))
discovery = json.loads(subprocess.check_output(command, stderr=subprocess.PIPE))
found = {(item.get("package"), item["symbol"]): item for item in discovery["components"]}

def slug(symbol):
    return re.sub(r"([a-z\d])([A-Z])", r"\1-\2", symbol).lower().replace(".", "-").replace("_", "-")

def wrapped_component(path, symbol, package):
    source = (root / path).read_text()
    declaration = re.search(
        rf"(?m)^(?:export )?const {symbol}(?:: React\.FC<| = (?:(?:/\*.*?\*/ )?React\.forwardRef<|createSlot\(|createSlottable\()).*$",
        source,
    )
    if declaration is None:
        return None
    line = source.count("\n", 0, declaration.start()) + 1
    details = {
        "status": "partial",
        "source_evidence": {"path": path.as_posix(), "start_line": line, "end_line": line},
        "field_gaps": [{"field": "signature", "reason": "Wax did not extract the wrapped declaration."}],
    }
    if "deprecated" in source.splitlines()[line - 2]:
        details["deprecation"] = {"message": "Noop component retained for backwards compatibility."}
    return {"id": f"ds.{slug(symbol)}", "symbol": symbol, "package": package, "details": details}

entries = []
for namespace, package in namespaces:
    source = packages / package.removeprefix("@radix-ui/react-") / "src"
    public = list(exports((root / source / "index.ts").read_text()))
    for local, name, module in public:
        if not name[0].isupper() or name.isupper():
            continue
        module = source / module
        implementation = next(path for path in (module.with_suffix(".tsx"), module.with_suffix(".ts")) if (root / path).is_file())
        bindings = {exported: binding for binding, exported, target in exports((root / implementation).read_text()) if not target}
        binding = bindings.get(local, local)
        component = found.get((package, binding)) or wrapped_component(implementation, binding, package)
        if component is None:
            print(f"Undiscovered public binding: {namespace}.{name}", file=sys.stderr)
            continue
        if component["symbol"] == name and name == local:
            entries.append(component)
        umbrella = deepcopy(component)
        umbrella["symbol"] = f"{namespace}.{name}"
        umbrella["package"] = "radix-ui"
        umbrella["id"] = f"ds.radix-ui-{slug(umbrella['symbol'])}"
        entries.append(umbrella)

assert len({entry["id"] for entry in entries}) == len(entries)
assert len({entry["symbol"] for entry in entries}) == len(entries)
print(json.dumps({"schema_version": 1, "components": sorted(entries, key=lambda entry: entry["id"])}, indent=2))
