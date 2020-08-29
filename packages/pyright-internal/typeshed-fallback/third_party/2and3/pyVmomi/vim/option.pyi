from typing import Any, List

class OptionManager:
    def QueryOptions(self, name: str) -> List[OptionValue]: ...

class OptionValue:
    value: Any
