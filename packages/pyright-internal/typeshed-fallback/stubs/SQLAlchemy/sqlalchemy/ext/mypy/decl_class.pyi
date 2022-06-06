from typing import Any
from typing_extensions import TypeAlias

from . import util

SemanticAnalyzerPluginInterface: TypeAlias = Any  # from mypy.plugin

def scan_declarative_assignments_and_apply_types(
    cls, api: SemanticAnalyzerPluginInterface, is_mixin_scan: bool = ...
) -> list[util.SQLAlchemyAttribute] | None: ...
