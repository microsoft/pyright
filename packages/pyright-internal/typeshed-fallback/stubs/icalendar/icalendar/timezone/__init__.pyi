from ..timezone.tzp import TZP  # to prevent "tzp" from being defined here

__all__ = ["tzp", "use_pytz", "use_zoneinfo"]

tzp: TZP

def use_pytz() -> None: ...
def use_zoneinfo() -> None: ...
