from .base import AuthenticationBase as AuthenticationBase

class RevokeToken(AuthenticationBase):
    def revoke_refresh_token(self, token: str): ...
