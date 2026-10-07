from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from app.model_profiles import get_model_profile, public_model_catalog
from app.providers.a14b_gguf import build_command, validate_model_dir


class ModelProfileTests(unittest.TestCase):
    def test_5b_remains_official_hybrid_default(self) -> None:
        profile = get_model_profile("ti2v-5b")
        self.assertEqual(profile["engine"], "wan-upstream")
        self.assertEqual(profile["repo_id"], "Wan-AI/Wan2.2-TI2V-5B")
        self.assertEqual(profile["modes"], ["text", "image"])
        self.assertEqual(profile["default_size"], "1280*704")

    def test_a14b_q4_and_q5_are_separate_text_profiles(self) -> None:
        q4 = get_model_profile("t2v-a14b-q4-k-m")
        q5 = get_model_profile("t2v-a14b-q5-k-m")

        self.assertEqual(q4["engine"], "diffusers-gguf")
        self.assertEqual(q5["engine"], "diffusers-gguf")
        self.assertEqual(q4["modes"], ["text"])
        self.assertEqual(q5["modes"], ["text"])
        self.assertEqual(q4["quantization"], "Q4_K_M")
        self.assertEqual(q5["quantization"], "Q5_K_M")
        self.assertTrue(q4["recommended"])

    def test_catalog_contains_all_three_profiles(self) -> None:
        ids = {item["id"] for item in public_model_catalog()}
        self.assertEqual(
            ids,
            {"ti2v-5b", "t2v-a14b-q4-k-m", "t2v-a14b-q5-k-m"},
        )

    def test_a14b_folder_manifest_must_match_profile(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "wan2-desktop-model.json").write_text(
                json.dumps({"model_id": "t2v-a14b-q4-k-m"}),
                encoding="utf-8",
            )

            validate_model_dir("t2v-a14b-q4-k-m", root)
            with self.assertRaises(ValueError):
                validate_model_dir("t2v-a14b-q5-k-m", root)

    def test_a14b_command_uses_separate_gguf_engine(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "wan2-desktop-model.json").write_text(
                json.dumps({"model_id": "t2v-a14b-q4-k-m"}),
                encoding="utf-8",
            )
            output = root / "out.mp4"
            command = build_command(
                model_id="t2v-a14b-q4-k-m",
                model_dir=root,
                prompt="test",
                size="832*480",
                output_path=output,
                seed=123,
                sample_steps=20,
            )
            self.assertIn("app.gguf_generate", command)
            self.assertIn("832*480", command)
            self.assertIn(str(output), command)


if __name__ == "__main__":
    unittest.main()
