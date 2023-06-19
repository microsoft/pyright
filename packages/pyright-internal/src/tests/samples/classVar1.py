# This sample tests the type checker's handling of ClassVar
# as described in PEP 526.

from typing import Any, ClassVar


class MyDescriptor:
    def __get__(self, *args: Any) -> str:
        return ""

    def __set__(self, obj: Any, value: str):
        pass


class Starship:
    captain: str = "Picard"
    damage: int
    stats: "ClassVar[dict[str, int]]" = {}
    desc: ClassVar[MyDescriptor] = MyDescriptor()

    def __init__(self, damage: int, captain: str | None = None):
        self.damage = damage
        if captain:
            self.captain = captain  # Else keep the default

    def hit(self):
        Starship.stats["hits"] = Starship.stats.get("hits", 0) + 1


enterprise_d = Starship(3000)
Starship.stats = {}

a = enterprise_d.stats

# This should be flagged as an error because stats cannot
# be set via a class instance because it's a ClassVar.
enterprise_d.stats = {}

# This should not generate an error because "desc" is a
# descriptor instance on the class.
enterprise_d.desc = "OK"
