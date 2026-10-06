from .base import ProviderCapabilities, VideoGenerationProvider


class Wan22Provider(VideoGenerationProvider):
    """Initial Wan 2.2 adapter placeholder.

    Runtime-specific imports deliberately stay out of the app layer. The next
    milestone will connect this adapter to the selected Wan 2.2 inference stack.
    """

    @property
    def name(self) -> str:
        return "Wan 2.2"

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            text_to_video=True,
            image_to_video=True,
            cancellation=False,
        )

    def is_ready(self) -> bool:
        return False
