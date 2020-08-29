# This sample tests the type checker's handling of ClassVar
# as described in PEP 526.

from typing import ClassVar, Dict, Protocol


class Starship:
    captain: str = 'Picard'
    damage: int
    stats: ClassVar[Dict[str, int]] = {}

    def __init__(self, damage: int, captain: str = None):
        self.damage = damage
        if captain:
            self.captain = captain  # Else keep the default

    def hit(self):
        Starship.stats['hits'] = Starship.stats.get('hits', 0) + 1

enterprise_d = Starship(3000)
Starship.stats = {}

a = enterprise_d.stats

# This should be flagged as an error because stats cannot
# be set via a class instance because it's a ClassVar.
enterprise_d.stats = {}

