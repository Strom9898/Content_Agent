import json
import re
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Callable, Protocol

import httpx

from app.config import get_settings


def format_xhs_copy(title: str, article: str, tags: list[str]) -> str:
    """Build plain text that can be pasted directly into Xiaohongshu."""
    body_lines = []
    for line in article.splitlines():
        cleaned = re.sub(r"^\s{0,3}#{1,6}\s*", "", line).strip()
        if cleaned and cleaned != title:
            body_lines.append(cleaned)
        elif not cleaned and body_lines and body_lines[-1] != "":
            body_lines.append("")

    body = "\n".join(body_lines).strip()
    tag_line = " ".join(
        f"#{tag.strip().lstrip('#')}" for tag in tags if tag.strip().lstrip("#")
    )
    return f"{title.strip()}\n\n{body}\n\n{tag_line}".strip()


class ContentGenerator(Protocol):
    def generate_topics(self, source_topic: str) -> list[dict]: ...

    def write_article(
        self,
        topic: str,
        previous: str | None = None,
        feedback: str = "",
        preferences: list[str] | None = None,
    ) -> str: ...

    def build_package(
        self,
        topic: str,
        article: str,
        progress_callback: Callable[[str, int, str], None] | None = None,
    ) -> dict: ...


class MockContentGenerator:
    def generate_topics(self, source_topic: str) -> list[dict]:
        return [
            {
                "title": f"{source_topic}：新手避坑指南",
                "angle": "用常见错误切入，提供可执行的纠正方法",
                "audience": "刚开始了解该主题的新手",
            },
            {
                "title": f"我用 7 天实践了{source_topic}",
                "angle": "通过个人体验和前后对比建立真实感",
                "audience": "喜欢经验分享与结果验证的用户",
            },
            {
                "title": f"{source_topic}的 5 个高效技巧",
                "angle": "清单式输出，强调收藏价值",
                "audience": "希望快速获得方法论的用户",
            },
        ]

    def write_article(
        self,
        topic: str,
        previous: str | None = None,
        feedback: str = "",
        preferences: list[str] | None = None,
    ) -> str:
        remembered = (
            f"\n\n已参考历史审核偏好：{'；'.join(preferences)}"
            if preferences
            else ""
        )
        revision = (
            f"\n\n本次已根据审核意见调整：{feedback}" if feedback else ""
        )
        return (
            f"# {topic}\n\n"
            "最近认真研究了这个方向，发现真正拉开差距的并不是知道多少，"
            "而是能不能把关键步骤落实下来。\n\n"
            "## 1. 先明确自己的目标\n"
            "不要一开始就追求面面俱到。先选一个最想解决的问题，把目标写得具体、可验证。\n\n"
            "## 2. 用最小行动开始\n"
            "把任务拆成今天就能完成的一步。行动足够小，才更容易坚持并获得反馈。\n\n"
            "## 3. 每次复盘一个变量\n"
            "记录做了什么、结果如何、下一次准备改哪里。连续迭代，比一次做到完美更重要。\n\n"
            "最后提醒：适合自己的节奏，才是能长期执行的节奏。你现在最想先解决哪一步？"
            f"{remembered}{revision}"
        )

    def build_package(
        self,
        topic: str,
        article: str,
        progress_callback: Callable[[str, int, str], None] | None = None,
    ) -> dict:
        if progress_callback:
            progress_callback("article", 18, "正在整理最终版文章")
        title = topic[:20]
        tags = ["成长干货", "经验分享", "效率提升", "自我提升"]
        package = {
            "title": title,
            "summary": "一篇围绕目标、行动和复盘展开的实用经验分享。",
            "content": article,
            "tags": tags,
            "image_prompts": [
                f"小红书封面，主题为“{topic}”，简洁杂志排版，高饱和配色，3:4",
                "生活方式场景图，桌面、笔记本与自然光，温暖真实，3:4",
                "信息清单长图，留白充足，中文社交媒体风格，3:4",
            ],
            "images": [],
            "image_generation_status": "not_configured",
            "image_generation_error": None,
            "publish_status": "ready",
        }
        package["copy_text"] = format_xhs_copy(title, article, tags)
        if progress_callback:
            progress_callback("completed", 100, "发布包生成完成")
        return package


class OpenAIContentGenerator:
    def __init__(self) -> None:
        from openai import OpenAI
        from langchain_openai import ChatOpenAI

        settings = get_settings()
        self.settings = settings
        self.model = ChatOpenAI(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            base_url=settings.llm_base_url,
            temperature=0.7,
            timeout=settings.llm_timeout,
            max_retries=settings.llm_max_retries,
        )
        self.image_client = (
            OpenAI(
                api_key=settings.openai_api_key,
                base_url=settings.llm_base_url,
                timeout=settings.llm_timeout,
                max_retries=settings.llm_max_retries,
            )
            if settings.openai_model_image
            else None
        )

    def _json(self, prompt: str) -> dict | list:
        response = self.model.invoke(prompt)
        return self._parse_json_content(response.content)

    @staticmethod
    def _parse_json_content(content) -> dict | list:
        if isinstance(content, str):
            text = content.strip()
        elif isinstance(content, list):
            text = "".join(
                str(item.get("text", ""))
                for item in content
                if isinstance(item, Mapping)
            ).strip()
        else:
            text = str(content).strip()

        fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.I)
        if fenced:
            text = fenced.group(1).strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            decoder = json.JSONDecoder()
            for index, character in enumerate(text):
                if character not in "[{":
                    continue
                try:
                    value, _ = decoder.raw_decode(text[index:])
                    return value
                except json.JSONDecodeError:
                    continue
            raise ValueError("模型未返回有效 JSON")

    def generate_topics(self, source_topic: str) -> list[dict]:
        result = self._json(
            "你是小红书选题策划。基于输入生成3个差异明显的方向。"
            '仅返回JSON数组，不要添加解释。每项必须包含字符串字段'
            '"title"、"angle"、"audience"。'
            f"\n输入：{source_topic}"
        )
        if not isinstance(result, list) or len(result) != 3:
            raise ValueError("模型必须返回 3 个选题方向")
        required = {"title", "angle", "audience"}
        if any(
            not isinstance(item, dict)
            or not required.issubset(item)
            or any(not str(item[key]).strip() for key in required)
            for item in result
        ):
            raise ValueError("模型返回的选题格式不正确")
        return [{key: str(item[key]).strip() for key in required} for item in result]

    def write_article(
        self,
        topic: str,
        previous: str | None = None,
        feedback: str = "",
        preferences: list[str] | None = None,
    ) -> str:
        prompt = (
            "你是资深小红书内容作者。请写一篇真实、自然、有信息密度的中文文章。"
            "开头要快速建立阅读兴趣，正文结构清晰、段落简短，给出可执行建议，"
            "结尾自然引导互动。使用Markdown，不要输出创作说明，不虚构数据或经历。\n"
            f"选题：{topic}\n"
        )
        if preferences:
            preference_lines = "\n".join(
                f"- {preference}" for preference in preferences
            )
            prompt += (
                "以下是该用户从历史审核中沉淀的长期写作偏好。"
                "在不与本次明确要求冲突的前提下遵守：\n"
                f"{preference_lines}\n"
            )
        if previous:
            prompt += (
                f"上一版：\n{previous}\n审核意见：{feedback}\n"
                "请严格落实审核意见并输出完整重写后的文章。"
            )
        return str(self.model.invoke(prompt).content)

    def build_package(
        self,
        topic: str,
        article: str,
        progress_callback: Callable[[str, int, str], None] | None = None,
    ) -> dict:
        if progress_callback:
            progress_callback("article", 12, "正在整理最终版文章")
        result = self._json(
            "请为以下小红书文章生成发布信息。仅返回JSON对象，字段为"
            '"title"、"summary"、"tags"、"image_prompts"，其中标签和图片提示词为数组。'
            f"\n选题：{topic}\n文章：{article}"
        )
        image_prompts = [
            str(prompt).strip()
            for prompt in result.get("image_prompts", [])
            if str(prompt).strip()
        ]
        if progress_callback:
            progress_callback("article_ready", 44, "文章已完成，正在准备配图")
        package = {
            **result,
            "content": article,
            "image_prompts": image_prompts,
            "images": [],
            "image_generation_status": "not_configured",
            "image_generation_error": None,
            "publish_status": "ready",
        }
        if self.image_client and image_prompts:
            try:
                package["images"] = self._generate_images(
                    topic,
                    image_prompts,
                    progress_callback,
                )
                package["image_generation_status"] = "completed"
            except Exception as exc:
                package["image_generation_status"] = "failed"
                package["image_generation_error"] = self._image_error_message(exc)
                if progress_callback:
                    progress_callback("image_failed", 94, "配图生成失败，正在保留文章")
        package["copy_text"] = format_xhs_copy(
            str(package["title"]), article, list(package["tags"])
        )
        if progress_callback:
            progress_callback("completed", 100, "文章和配图已生成")
        return package

    def _generate_images(
        self,
        topic: str,
        prompts: list[str],
        progress_callback: Callable[[str, int, str], None] | None = None,
    ) -> list[str]:
        if progress_callback:
            progress_callback("image", 52, "正在生成文章配图")
        prompt_list = "\n".join(
            f"{index + 1}. {prompt}" for index, prompt in enumerate(prompts)
        )
        response = self.image_client.images.generate(
            model=self.settings.openai_model_image,
            prompt=(
                f"为小红书文章《{topic}》生成一组视觉风格统一、构图各异的配图。"
                "图片中不要出现水印、二维码或难以辨认的文字。"
                f"\n配图要求：\n{prompt_list}"
            ),
            size=self.settings.image_size,
            response_format="url",
            extra_body={
                "watermark": False,
                "sequential_image_generation": "auto",
                "sequential_image_generation_options": {
                    "max_images": self.settings.image_count,
                },
            },
        )
        urls = [item.url for item in response.data if getattr(item, "url", None)]
        if not urls:
            raise ValueError("生图模型未返回图片")
        if progress_callback:
            progress_callback("image_polish", 82, "图片已生成，正在润色与保存")
        images = []
        for index, url in enumerate(urls):
            images.append(self._persist_image(url))
            if progress_callback:
                progress_callback(
                    "image_polish",
                    min(94, 82 + round((index + 1) / len(urls) * 12)),
                    f"正在保存第 {index + 1} 张配图",
                )
        return images

    def _persist_image(self, source_url: str) -> str:
        target_dir = self.settings.generated_images_path
        target_dir.mkdir(parents=True, exist_ok=True)
        with httpx.Client(timeout=self.settings.llm_timeout, follow_redirects=True) as client:
            response = client.get(source_url)
            response.raise_for_status()
        extension = self._image_extension(response.headers.get("content-type", ""))
        filename = f"{uuid.uuid4().hex}{extension}"
        (target_dir / filename).write_bytes(response.content)
        return f"/api/generated/{filename}"

    @staticmethod
    def _image_extension(content_type: str) -> str:
        normalized = content_type.split(";", 1)[0].strip().lower()
        return {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
        }.get(normalized, ".png")

    @staticmethod
    def _image_error_message(error: Exception) -> str:
        message = str(error).strip()
        return message[:300] if message else "图片生成失败"


def get_content_generator() -> ContentGenerator:
    settings = get_settings()
    if (
        settings.llm_provider.lower() in {"openai", "doubao", "ark"}
        and settings.openai_api_key
    ):
        return OpenAIContentGenerator()
    return MockContentGenerator()
