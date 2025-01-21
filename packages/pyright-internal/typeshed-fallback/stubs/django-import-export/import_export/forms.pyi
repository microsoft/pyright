from typing import Any

from django import forms
from django.contrib.admin.helpers import ActionForm

from .formats.base_formats import Format
from .resources import Resource

class ImportExportFormBase(forms.Form):
    resource: forms.ChoiceField
    def __init__(self, *args: Any, resources: list[type[Resource[Any]]] | None = None, **kwargs: Any) -> None: ...

class ImportForm(ImportExportFormBase):
    import_file: forms.FileField
    input_format: forms.ChoiceField
    def __init__(self, import_formats: list[Format], *args: Any, **kwargs: Any) -> None: ...
    @property
    def media(self) -> forms.Media: ...

class ConfirmImportForm(forms.Form):
    import_file_name: forms.CharField
    original_file_name: forms.CharField
    input_format: forms.CharField
    resource: forms.CharField
    def clean_import_file_name(self) -> str: ...

class ExportForm(ImportExportFormBase):
    file_format: forms.ChoiceField
    def __init__(self, formats: list[Format], *args: Any, **kwargs: Any) -> None: ...

def export_action_form_factory(formats: list[tuple[str, str]]) -> type[ActionForm]: ...
