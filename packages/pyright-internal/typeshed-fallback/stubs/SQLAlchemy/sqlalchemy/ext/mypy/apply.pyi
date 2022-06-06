from typing import Any
from typing_extensions import TypeAlias

from . import util

AssignmentStmt: TypeAlias = Any  # from mypy.nodes
NameExpr: TypeAlias = Any  # from mypy.nodes
StrExpr: TypeAlias = Any  # from mypy.nodes
SemanticAnalyzerPluginInterface: TypeAlias = Any  # from mypy.plugin
ProperType: TypeAlias = Any  # from mypy.types

def apply_mypy_mapped_attr(
    cls, api: SemanticAnalyzerPluginInterface, item: NameExpr | StrExpr, attributes: list[util.SQLAlchemyAttribute]
) -> None: ...
def re_apply_declarative_assignments(
    cls, api: SemanticAnalyzerPluginInterface, attributes: list[util.SQLAlchemyAttribute]
) -> None: ...
def apply_type_to_mapped_statement(
    api: SemanticAnalyzerPluginInterface,
    stmt: AssignmentStmt,
    lvalue: NameExpr,
    left_hand_explicit_type: ProperType | None,
    python_type_for_type: ProperType | None,
) -> None: ...
def add_additional_orm_attributes(
    cls, api: SemanticAnalyzerPluginInterface, attributes: list[util.SQLAlchemyAttribute]
) -> None: ...
