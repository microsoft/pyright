from typing import ClassVar

import docutils

class CliSettingsSpec(docutils.SettingsSpec):
    config_section: ClassVar[str]
    config_section_dependencies: ClassVar[tuple[str, ...]]

def main() -> None: ...
