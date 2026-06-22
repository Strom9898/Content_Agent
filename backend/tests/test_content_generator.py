import pytest
from types import SimpleNamespace

from app.services.content_generator import OpenAIContentGenerator


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ('[{"title":"A"}]', [{"title": "A"}]),
        ('```json\n{"title":"A"}\n```', {"title": "A"}),
        ('生成结果如下：\n[{"title":"A"}]\n请查收。', [{"title": "A"}]),
        ([{"type": "text", "text": '{"title":"A"}'}], {"title": "A"}),
    ],
)
def test_parse_json_content(content, expected):
    assert OpenAIContentGenerator._parse_json_content(content) == expected


def test_parse_json_content_rejects_invalid_response():
    with pytest.raises(ValueError, match="模型未返回有效 JSON"):
        OpenAIContentGenerator._parse_json_content("这不是 JSON")


def make_generator(monkeypatch, image_result):
    generator = OpenAIContentGenerator.__new__(OpenAIContentGenerator)
    generator.settings = SimpleNamespace(openai_model_image="image-model")
    generator.image_client = object()
    monkeypatch.setattr(
        generator,
        "_json",
        lambda prompt: {
            "title": "测试标题",
            "summary": "测试摘要",
            "tags": ["测试标签"],
            "image_prompts": ["封面图", "场景图", "清单图"],
        },
    )
    if isinstance(image_result, Exception):
        def fail_images(topic, prompts, progress_callback=None):
            raise image_result

        monkeypatch.setattr(generator, "_generate_images", fail_images)
    else:
        monkeypatch.setattr(
            generator,
            "_generate_images",
            lambda topic, prompts, progress_callback=None: image_result,
        )
    return generator


def test_build_package_includes_generated_images(monkeypatch):
    generator = make_generator(
        monkeypatch,
        ["/api/generated/one.png", "/api/generated/two.png"],
    )

    package = generator.build_package("测试选题", "测试文章")

    assert package["image_generation_status"] == "completed"
    assert len(package["images"]) == 2
    assert package["image_generation_error"] is None


def test_build_package_keeps_article_when_image_generation_fails(monkeypatch):
    generator = make_generator(monkeypatch, RuntimeError("image service unavailable"))

    package = generator.build_package("测试选题", "测试文章")

    assert package["publish_status"] == "ready"
    assert package["content"] == "测试文章"
    assert package["images"] == []
    assert package["image_generation_status"] == "failed"
    assert package["image_generation_error"] == "image service unavailable"


@pytest.mark.parametrize(
    ("content_type", "extension"),
    [
        ("image/jpeg", ".jpg"),
        ("image/png; charset=binary", ".png"),
        ("image/webp", ".webp"),
        ("application/octet-stream", ".png"),
    ],
)
def test_image_extension(content_type, extension):
    assert OpenAIContentGenerator._image_extension(content_type) == extension
