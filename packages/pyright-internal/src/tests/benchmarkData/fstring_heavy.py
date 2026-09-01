# fstring_heavy.py — deeply nested f-strings for tokenizer stress-testing
# Tests the f-string context stack handling and expression scanning.

from typing import Any, Dict, List, Optional, Tuple

# Simple f-strings
name = "world"
greeting = f"Hello, {name}!"
multi = f"{'hello'.upper()} {'world'.lower()}"

# Nested f-strings (depth 2)
value = 42
nested_1 = f"result: {f'inner {value}'}"
nested_2 = f"outer {f'middle {f'{value}'}'}"

# F-strings with format specs
pi = 3.14159265358979
formatted_float = f"{pi:.4f}"
formatted_int = f"{value:05d}"
formatted_hex = f"{value:#010x}"
formatted_bin = f"{value:08b}"
formatted_exp = f"{pi:.2e}"
formatted_percent = f"{0.756:.1%}"

# F-strings with expressions
data = [1, 2, 3, 4, 5]
expr_1 = f"sum={sum(data)}, len={len(data)}, avg={sum(data)/len(data):.2f}"
expr_2 = f"max={max(data)}, min={min(data)}, range={max(data)-min(data)}"

# F-strings with conditionals
status = "ok"
cond_1 = f"Status: {'PASS' if status == 'ok' else 'FAIL'}"
cond_2 = f"Value: {value if value > 0 else -value} ({'positive' if value > 0 else 'negative'})"

# F-strings with dictionary access
config: Dict[str, Any] = {"host": "localhost", "port": 8080, "debug": True}
dict_1 = f"Server: {config['host']}:{config['port']}"
dict_2 = f"Debug mode: {'ON' if config['debug'] else 'OFF'}"

# F-strings with list comprehensions
comp_1 = f"squares: {[x**2 for x in range(10)]}"
comp_2 = f"evens: {[x for x in range(20) if x % 2 == 0]}"

# F-strings with method calls
text = "hello world"
method_1 = f"{text.title()!r}"
method_2 = f"{text.replace('world', 'python').upper()}"
method_3 = f"{', '.join(str(x) for x in range(5))}"

# Multiline f-strings
multiline_1 = f"""
Name: {name}
Value: {value}
Status: {status}
Config: {config}
"""

multiline_2 = f"""
{'='*50}
Report Summary
{'='*50}
Total items: {len(data)}
Sum: {sum(data)}
Average: {sum(data)/len(data):.2f}
{'='*50}
"""

# F-strings with walrus operator
walrus_1 = f"{(n := 10)} doubled is {n * 2}"

# Deeply nested f-strings (depth 3)
deep_1 = f"L1:{f'L2:{f'L3:{value}'}'}"
deep_2 = f"a{f'b{f'c{f'd'}'}'}"

# F-strings with escape characters
escape_1 = f"path: {'C:\\\\Users\\\\test'}"
escape_2 = f"newline: {'line1\\nline2'}"
escape_3 = f"tab: {'col1\\tcol2'}"

# F-string with complex expressions
import_fstr = f"{'import ' + 'os'}"
lambda_fstr = f"{(lambda x: x * 2)(21)}"

# Batch of similar f-strings (simulating template usage)
items: List[Dict[str, Any]] = [
    {"name": f"item_{i}", "price": i * 10.5, "qty": i + 1}
    for i in range(50)
]


def format_item(item: Dict[str, Any]) -> str:
    return f"  {item['name']:<20s} ${item['price']:>8.2f} x{item['qty']:>4d} = ${item['price'] * item['qty']:>10.2f}"


def format_table(items: List[Dict[str, Any]], title: str = "Inventory") -> str:
    header = f"{'Name':<20s} {'Price':>8s} {'Qty':>4s} {'Total':>10s}"
    separator = f"{'-'*20} {'-'*8} {'-'*4} {'-'*10}"
    rows = "\n".join(format_item(item) for item in items)
    total = sum(item["price"] * item["qty"] for item in items)
    return f"""
{title}
{f'=' * len(title)}
{header}
{separator}
{rows}
{separator}
{'TOTAL':>34s} ${total:>10.2f}
"""


# F-strings in class definitions
class FormattedRecord:
    def __init__(self, id: int, name: str, value: float) -> None:
        self.id = id
        self.name = name
        self.value = value

    def __str__(self) -> str:
        return f"Record(id={self.id}, name={self.name!r}, value={self.value:.4f})"

    def __repr__(self) -> str:
        return f"FormattedRecord({self.id!r}, {self.name!r}, {self.value!r})"

    def to_csv(self) -> str:
        return f"{self.id},{self.name},{self.value:.2f}"

    def to_json(self) -> str:
        return f'{{"id": {self.id}, "name": "{self.name}", "value": {self.value}}}'

    def to_xml(self) -> str:
        return f"<record id=\"{self.id}\"><name>{self.name}</name><value>{self.value:.2f}</value></record>"

    def summary(self, verbose: bool = False) -> str:
        base = f"#{self.id}: {self.name} = {self.value:.2f}"
        if verbose:
            return f"{base} (type={type(self.value).__name__}, len_name={len(self.name)})"
        return base


# F-strings with nested data structures
matrix: List[List[int]] = [[i * 10 + j for j in range(10)] for i in range(10)]


def format_matrix(m: List[List[int]]) -> str:
    rows = "\n".join(
        f"  [{', '.join(f'{cell:3d}' for cell in row)}]"
        for row in m
    )
    return f"Matrix {len(m)}x{len(m[0]) if m else 0}:\n[\n{rows}\n]"


def format_tree(
    node: Dict[str, Any], indent: int = 0, prefix: str = ""
) -> str:
    name = node.get("name", "?")
    children = node.get("children", [])
    result = f"{' ' * indent}{prefix}{name}"
    for i, child in enumerate(children):
        is_last = i == len(children) - 1
        child_prefix = f"{'└── ' if is_last else '├── '}"
        result += f"\n{format_tree(child, indent + 4, child_prefix)}"
    return result


# Many small f-strings to stress token emission
def generate_report_lines(count: int) -> List[str]:
    lines: List[str] = []
    for i in range(count):
        lines.append(f"Line {i:04d}: value={i * 3.14:.2f}, hex={i:#06x}, bin={i:08b}")
    return lines


def format_log_entry(
    timestamp: str,
    level: str,
    module: str,
    message: str,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    base = f"[{timestamp}] {level:>8s} {module:<30s} {message}"
    if extra:
        pairs = " ".join(f"{k}={v!r}" for k, v in extra.items())
        return f"{base} | {pairs}"
    return base


# F-strings with type annotations in strings (for older Python compat)
future_annotations_example = {
    "field1": f"{'Optional[List[Dict[str, Any]]]'}",
    "field2": f"{'Union[int, str, Tuple[int, ...]]'}",
    "field3": f"{'Callable[[str, int], Optional[bool]]'}",
}

# More deeply nested formatting
def deep_format(data: Dict[str, Any], depth: int = 0) -> str:
    indent = "  " * depth
    parts: List[str] = []
    for key, val in data.items():
        if isinstance(val, dict):
            inner = deep_format(val, depth + 1)
            parts.append(f"{indent}{key}:\n{inner}")
        elif isinstance(val, list):
            items_str = f", ".join(f"{v!r}" for v in val)
            parts.append(f"{indent}{key}: [{items_str}]")
        else:
            parts.append(f"{indent}{key}: {val!r}")
    return "\n".join(parts)


# Batch f-string generation to reach ~500 lines of f-string-heavy code
class LogFormatter:
    _format: str
    _fields: List[str]

    def __init__(self, fmt: str, fields: Optional[List[str]] = None) -> None:
        self._format = fmt
        self._fields = fields or []

    def format(self, **kwargs: Any) -> str:
        return f"[{self._format}] " + " ".join(
            f"{f}={kwargs.get(f, 'N/A')!r}" for f in self._fields
        )


class TemplateEngine:
    _templates: Dict[str, str]

    def __init__(self) -> None:
        self._templates = {}

    def register(self, name: str, template: str) -> None:
        self._templates[name] = template

    def render(self, name: str, **ctx: Any) -> str:
        tmpl = self._templates.get(name, "")
        return f"[{name}] {tmpl}" + "".join(
            f" {k}={v}" for k, v in ctx.items()
        )


class HtmlBuilder:
    _parts: List[str]

    def __init__(self) -> None:
        self._parts = []

    def tag(self, name: str, content: str, **attrs: str) -> "HtmlBuilder":
        attr_str = " ".join(f'{k}="{v}"' for k, v in attrs.items())
        if attr_str:
            self._parts.append(f"<{name} {attr_str}>{content}</{name}>")
        else:
            self._parts.append(f"<{name}>{content}</{name}>")
        return self

    def div(self, content: str, class_name: str = "") -> "HtmlBuilder":
        if class_name:
            self._parts.append(f'<div class="{class_name}">{content}</div>')
        else:
            self._parts.append(f"<div>{content}</div>")
        return self

    def span(self, content: str, style: str = "") -> "HtmlBuilder":
        if style:
            self._parts.append(f'<span style="{style}">{content}</span>')
        else:
            self._parts.append(f"<span>{content}</span>")
        return self

    def build(self) -> str:
        return f"<!DOCTYPE html>\n<html>\n<body>\n{''.join(self._parts)}\n</body>\n</html>"


# End of fstring_heavy.py
