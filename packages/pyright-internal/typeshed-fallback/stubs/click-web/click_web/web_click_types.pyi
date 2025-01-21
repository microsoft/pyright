import re
import typing as t

import click

class EmailParamType(click.ParamType):
    EMAIL_REGEX: re.Pattern[str]
    def convert(self, value: t.Any, param: click.Parameter | None, ctx: click.Context | None) -> t.Any: ...

class PasswordParamType(click.ParamType):
    def convert(self, value: t.Any, param: click.Parameter | None, ctx: click.Context | None) -> t.Any: ...

class TextAreaParamType(click.ParamType):
    def convert(self, value: t.Any, param: click.Parameter | None, ctx: click.Context | None) -> t.Any: ...

EMAIL_TYPE: EmailParamType
PASSWORD_TYPE: PasswordParamType
TEXTAREA_TYPE: TextAreaParamType
