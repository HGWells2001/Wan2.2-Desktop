from __future__ import annotations

import unittest

from app.prompt_optimizer import optimize_prompt_fast


class PromptOptimizerTests(unittest.TestCase):
    def test_fast_text_preserves_user_prompt_and_adds_video_guidance(self) -> None:
        result = optimize_prompt_fast("un uomo cammina sotto la pioggia", "text")
        self.assertIn("un uomo cammina sotto la pioggia", result)
        self.assertIn("coherent natural motion", result)
        self.assertIn("purposeful camera movement", result)

    def test_fast_image_preserves_reference_image(self) -> None:
        result = optimize_prompt_fast("the woman turns toward the camera", "image")
        self.assertIn("the woman turns toward the camera", result)
        self.assertIn("Preserve the reference image", result)
        self.assertIn("Keep the original scene recognizable", result)


if __name__ == "__main__":
    unittest.main()
