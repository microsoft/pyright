from .base import AuthenticationBase as AuthenticationBase

class BackChannelLogin(AuthenticationBase):
    def back_channel_login(self, binding_message: str, login_hint: str, scope: str, **kwargs): ...
