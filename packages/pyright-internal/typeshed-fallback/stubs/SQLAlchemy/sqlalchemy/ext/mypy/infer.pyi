from collections.abc import Sequence
from typing import Any
from typing_extensions import TypeAlias

AssignmentStmt: TypeAlias = Any  # from mypy.nodes
Expression: TypeAlias = Any  # from mypy.nodes
RefExpr: TypeAlias = Any  # from mypy.nodes
TypeInfo: TypeAlias = Any  # from mypy.nodes
Var: TypeAlias = Any  # from mypy.nodes
StrExpr: TypeAlias = Any  # from mypy.nodes
SemanticAnalyzerPluginInterface: TypeAlias = Any  # from mypy.plugin
ProperType: TypeAlias = Any  # from mypy.types

def infer_type_from_right_hand_nameexpr(
    api: SemanticAnalyzerPluginInterface,
    stmt: AssignmentStmt,
    node: Var,
    left_hand_explicit_type: ProperType | None,
    infer_from_right_side: RefExpr,
) -> ProperType | None: ...
def infer_type_from_left_hand_type_only(
    api: SemanticAnalyzerPluginInterface, node: Var, left_hand_explicit_type: ProperType | None
) -> ProperType | None: ...
def extract_python_type_from_typeengine(
    api: SemanticAnalyzerPluginInterface, node: TypeInfo, type_args: Sequence[Expression]
) -> ProperType: ...
