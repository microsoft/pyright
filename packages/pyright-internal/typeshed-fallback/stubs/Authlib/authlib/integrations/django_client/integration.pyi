from django.dispatch import Signal

from ..base_client import FrameworkIntegration

token_update: Signal

class DjangoIntegration(FrameworkIntegration):
    def update_token(self, token, refresh_token=None, access_token=None) -> None: ...
    @staticmethod
    def load_config(oauth, name, params): ...
