import decimal
from typing_extensions import Literal

from babel.core import Locale

class UnknownUnitError(ValueError):
    def __init__(self, unit: str, locale: Locale) -> None: ...

def get_unit_name(
    measurement_unit: str, length: Literal["short", "long", "narrow"] = "long", locale: Locale | str | None = ...
) -> str: ...
def format_unit(
    value: float | decimal.Decimal,
    measurement_unit: str,
    length: Literal["short", "long", "narrow"] = "long",
    format: str | None = None,
    locale: Locale | str | None = ...,
) -> str: ...
def format_compound_unit(
    numerator_value: float | decimal.Decimal,
    numerator_unit: str | None = None,
    denominator_value: float | decimal.Decimal = 1,
    denominator_unit: str | None = None,
    length: Literal["short", "long", "narrow"] = "long",
    format: str | None = None,
    locale: Locale | str | None = ...,
) -> str | None: ...
