<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import {
  clearToken,
  createProject,
  deleteProject,
  getGenerationProgress,
  getMe,
  getProject,
  hasToken,
  listProjects,
  login,
  register,
  saveToken,
  selectTopic,
  submitReview,
} from "./api";
import type { Project, TopicOption, User } from "./types";

const user = ref<User | null>(null);
const projects = ref<Project[]>([]);
const project = ref<Project | null>(null);
const activeTab = ref<"create" | "history">("create");
const authMode = ref<"login" | "register">("login");
const username = ref("");
const password = ref("");
const sourceTopic = ref("");
const feedback = ref("");
const loading = ref(false);
const initializing = ref(true);
const error = ref("");
const notice = ref("");
const copied = ref(false);
const deletingProjectId = ref<string | null>(null);
const galleryIndex = ref(0);
const viewerIndex = ref(0);
const viewerOpen = ref(false);
const galleryTrack = ref<HTMLElement | null>(null);
const viewerTrack = ref<HTMLElement | null>(null);
let viewerScrollY = 0;
type LoadingStage = "topics" | "article" | "rewrite" | "package";
const loadingStage = ref<LoadingStage | null>(null);
const loadingProgress = ref(0);
const generationStage = ref("");
const generationMessage = ref("");
let progressTimer: number | undefined;
let progressPollTimer: number | undefined;
let noticeTimer: number | undefined;

const loadingContent: Record<LoadingStage, { eyebrow: string; title: string; detail: string }> = {
  topics: {
    eyebrow: "IDEA LAB",
    title: "正在策划选题",
    detail: "分析主题、受众和内容切入点",
  },
  article: {
    eyebrow: "WRITING DESK",
    title: "正在撰写文章",
    detail: "组织结构、语气和可执行信息",
  },
  rewrite: {
    eyebrow: "REVISION ROOM",
    title: "正在按意见重写",
    detail: "逐条理解反馈并优化完整文章",
  },
  package: {
    eyebrow: "PUBLISH STUDIO",
    title: "正在生成发布包",
    detail: "整理标题、标签、最终排版和文章配图",
  },
};

const currentLoadingContent = computed(() =>
  loadingStage.value === "package" && generationMessage.value
    ? {
        eyebrow: generationStage.value.startsWith("image")
          ? "VISUAL STUDIO"
          : "PUBLISH STUDIO",
        title: generationStage.value.startsWith("image")
          ? generationStage.value === "image_polish"
            ? "正在润色配图"
            : "正在生成配图"
          : generationStage.value === "article_ready"
            ? "文章已经完成"
            : "正在生成最终文章",
        detail: generationMessage.value,
      }
    : loadingStage.value
      ? loadingContent[loadingStage.value]
      : null,
);

const step = computed(() => {
  if (!project.value) return 1;
  if (project.value.status === "waiting_topic") return 2;
  if (project.value.status === "waiting_review") return 3;
  return 4;
});

const stepLabels = ["输入选题", "选择方向", "审核文章", "发布包"];

const statusLabel: Record<Project["status"], string> = {
  new: "生成中",
  waiting_topic: "等待选择选题",
  waiting_review: "等待审核文章",
  completed: "已生成发布稿",
};

function showError(reason: any) {
  if (reason.response?.status === 401) {
    logout();
    error.value = "登录已失效，请重新登录。";
    return;
  }
  error.value = reason.response?.data?.detail ?? "请求失败，请稍后重试。";
}

function showNotice(message: string) {
  window.clearTimeout(noticeTimer);
  notice.value = message;
  noticeTimer = window.setTimeout(() => {
    notice.value = "";
  }, 2400);
}

async function scrollPageToTop() {
  await nextTick();
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function beginLlmLoading(stage: LoadingStage, projectId?: string) {
  window.clearInterval(progressTimer);
  window.clearInterval(progressPollTimer);
  loadingStage.value = stage;
  loadingProgress.value = 8;
  generationStage.value = "";
  generationMessage.value = "";
  document.body.classList.add("llm-loading-active");
  if (stage === "package" && projectId) {
    generationStage.value = "article";
    generationMessage.value = "正在确认最终版文章";
    progressPollTimer = window.setInterval(async () => {
      try {
        const progress = await getGenerationProgress(projectId);
        if (loadingStage.value !== "package" || progress.stage === "idle") return;
        generationStage.value = progress.stage;
        generationMessage.value = progress.message;
        loadingProgress.value = Math.max(loadingProgress.value, progress.progress);
      } catch {
        // The main request owns error handling; polling is only progressive feedback.
      }
    }, 600);
    return;
  }
  progressTimer = window.setInterval(() => {
    const remaining = 92 - loadingProgress.value;
    if (remaining <= 0) return;
    loadingProgress.value = Math.min(
      92,
      loadingProgress.value + Math.max(0.35, remaining * 0.065),
    );
  }, 420);
}

async function finishLlmLoading() {
  window.clearInterval(progressTimer);
  window.clearInterval(progressPollTimer);
  loadingProgress.value = 100;
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  loadingStage.value = null;
  loadingProgress.value = 0;
  generationStage.value = "";
  generationMessage.value = "";
  document.body.classList.remove("llm-loading-active");
}

async function submitAuth() {
  loading.value = true;
  error.value = "";
  try {
    const action = authMode.value === "login" ? login : register;
    const result = await action(username.value.trim(), password.value);
    saveToken(result.access_token);
    user.value = result.user;
    projects.value = await listProjects();
  } catch (reason) {
    showError(reason);
  } finally {
    loading.value = false;
  }
}

async function refreshHistory() {
  try {
    projects.value = await listProjects();
  } catch (reason) {
    showError(reason);
  }
}

async function openHistory(item: Project) {
  loading.value = true;
  error.value = "";
  try {
    // 项目 ID 就是 LangGraph thread_id，读取项目后可继续原 checkpoint。
    project.value = await getProject(item.id);
    galleryIndex.value = 0;
    viewerIndex.value = 0;
    activeTab.value = "create";
    await scrollPageToTop();
  } catch (reason) {
    showError(reason);
  } finally {
    loading.value = false;
  }
}

async function run(
  stage: LoadingStage,
  task: () => Promise<Project>,
  progressProjectId?: string,
) {
  if (loading.value) return;
  let completed = false;
  loading.value = true;
  error.value = "";
  beginLlmLoading(stage, progressProjectId);
  try {
    project.value = await task();
    await refreshHistory();
    completed = true;
  } catch (reason) {
    showError(reason);
  } finally {
    await finishLlmLoading();
    loading.value = false;
    if (completed) await scrollPageToTop();
  }
}

async function start() {
  if (loading.value || !sourceTopic.value.trim()) return;
  await run("topics", () => createProject(sourceTopic.value.trim()));
}

async function choose(option: TopicOption) {
  if (loading.value || !project.value) return;
  await run("article", () => selectTopic(project.value!.id, option.title));
}

async function review(approved: boolean) {
  if (loading.value || !project.value) return;
  await run(
    approved ? "package" : "rewrite",
    () => submitReview(project.value!.id, approved, feedback.value),
    approved ? project.value.id : undefined,
  );
  if (!approved) feedback.value = "";
}

function newProject() {
  closeViewer();
  project.value = null;
  galleryIndex.value = 0;
  viewerIndex.value = 0;
  sourceTopic.value = "";
  feedback.value = "";
  copied.value = false;
  activeTab.value = "create";
  void scrollPageToTop();
}

function openSwipedHistory(event: MouseEvent, item: Project) {
  const row = (event.currentTarget as HTMLElement).closest(".history-swipe");
  if (row && row.scrollLeft > 8) return;
  void openHistory(item);
}

async function removeHistoryProject(item: Project) {
  if (deletingProjectId.value) return;
  deletingProjectId.value = item.id;
  error.value = "";
  try {
    await deleteProject(item.id);
    projects.value = projects.value.filter((candidate) => candidate.id !== item.id);
    if (project.value?.id === item.id) {
      project.value = null;
      sourceTopic.value = "";
      feedback.value = "";
    }
    showNotice("项目已删除");
  } catch (reason) {
    showError(reason);
  } finally {
    deletingProjectId.value = null;
  }
}

function logout() {
  clearToken();
  user.value = null;
  projects.value = [];
  project.value = null;
  password.value = "";
}

async function copyPublishText() {
  const text = project.value?.final_package?.copy_text;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 2000);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function updateSlideIndex(event: Event, target: "gallery" | "viewer") {
  const element = event.currentTarget as HTMLElement;
  const width = element.clientWidth;
  if (!width) return;
  const index = Math.round(element.scrollLeft / width);
  if (target === "gallery") galleryIndex.value = index;
  else viewerIndex.value = index;
}

function scrollToSlide(target: "gallery" | "viewer", index: number) {
  const images = project.value?.final_package?.images ?? [];
  if (!images.length) return;
  const boundedIndex = Math.max(0, Math.min(index, images.length - 1));
  const element = target === "gallery" ? galleryTrack.value : viewerTrack.value;
  element?.scrollTo({ left: element.clientWidth * boundedIndex, behavior: "smooth" });
  if (target === "gallery") galleryIndex.value = boundedIndex;
  else viewerIndex.value = boundedIndex;
}

async function openViewer(index: number) {
  viewerIndex.value = index;
  viewerOpen.value = true;
  viewerScrollY = window.scrollY;
  document.body.style.top = `-${viewerScrollY}px`;
  document.body.classList.add("viewer-active");
  await nextTick();
  viewerTrack.value?.scrollTo({ left: viewerTrack.value.clientWidth * index });
}

function closeViewer() {
  if (!viewerOpen.value) return;
  viewerOpen.value = false;
  document.body.classList.remove("viewer-active");
  document.body.style.top = "";
  window.scrollTo(0, viewerScrollY);
}

function handleViewerKeydown(event: KeyboardEvent) {
  if (!viewerOpen.value) return;
  if (event.key === "Escape") closeViewer();
  if (event.key === "ArrowLeft") scrollToSlide("viewer", viewerIndex.value - 1);
  if (event.key === "ArrowRight") scrollToSlide("viewer", viewerIndex.value + 1);
}

onMounted(async () => {
  window.addEventListener("keydown", handleViewerKeydown);
  if (!hasToken()) {
    initializing.value = false;
    return;
  }
  try {
    user.value = await getMe();
    projects.value = await listProjects();
  } catch {
    clearToken();
  } finally {
    initializing.value = false;
  }
});

onUnmounted(() => {
  window.clearInterval(progressTimer);
  window.clearInterval(progressPollTimer);
  window.clearTimeout(noticeTimer);
  window.removeEventListener("keydown", handleViewerKeydown);
  document.body.classList.remove("viewer-active");
  document.body.classList.remove("llm-loading-active");
  document.body.style.top = "";
});
</script>

<template>
  <main :class="['shell', { 'shell-auth': !initializing && !user, 'shell-app': user }]">
    <section v-if="initializing" class="splash">正在加载...</section>

    <template v-else-if="!user">
      <header class="app-header auth-header">
        <div class="brand-lockup">
          <span class="brand-mark" aria-hidden="true">稿</span>
          <span>XHS CONTENT AGENT</span>
        </div>
        <h1>欢迎回来</h1>
        <p>把灵感整理成一篇可以直接发布的内容。</p>
      </header>
      <section class="panel auth-panel">
        <div :class="['auth-switch', `is-${authMode}`]">
          <span class="tab-slider" aria-hidden="true"></span>
          <button :class="{ active: authMode === 'login' }" @click="authMode = 'login'">登录</button>
          <button :class="{ active: authMode === 'register' }" @click="authMode = 'register'">注册</button>
        </div>
        <label for="username">账号</label>
        <input id="username" v-model="username" autocomplete="username" placeholder="3-30 位用户名" />
        <label for="password">密码</label>
        <input id="password" v-model="password" type="password"
          :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
          placeholder="至少 8 位密码" @keydown.enter="submitAuth" />
        <button class="auth-submit" :disabled="loading || username.length < 3 || password.length < 8"
          @click="submitAuth">
          {{ loading ? "请稍候..." : authMode === "login" ? "登录" : "创建账号" }}
        </button>
      </section>
    </template>

    <template v-else>
      <header class="app-header signed-header">
        <div>
          <div class="brand-lockup">
            <span class="brand-mark" aria-hidden="true">稿</span>
            <span>CONTENT WORKFLOW</span>
          </div>
          <h1>小红书内容 Agent</h1>
          <p>你好，{{ user.username }}</p>
        </div>
        <button class="logout-button" :disabled="loading" aria-label="退出登录" @click="logout">
          <span>退出</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 8V5.5A1.5 1.5 0 0 0 12.5 4h-6A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h6a1.5 1.5 0 0 0 1.5-1.5V16" />
            <path d="M10 12h9m-3-3 3 3-3 3" />
          </svg>
        </button>
      </header>

      <nav :class="['main-tabs', `is-${activeTab}`]">
        <span class="tab-slider" aria-hidden="true"></span>
        <button :class="{ active: activeTab === 'create' }" :disabled="loading"
          @click="activeTab = 'create'">
          <span class="tab-icon" aria-hidden="true">✦</span>
          <span>内容创作</span>
        </button>
        <button :class="{ active: activeTab === 'history' }" :disabled="loading"
          @click="activeTab = 'history'; refreshHistory()">
          <span class="tab-icon tab-icon-history" aria-hidden="true"></span>
          <span>历史记录</span>
          <span v-if="projects.length" class="tab-count">{{ projects.length }}</span>
        </button>
      </nav>

      <section v-if="activeTab === 'history'" class="history-view">
        <div class="section-heading history-heading">
          <div><span class="kicker">MY PROJECTS</span><h2>创作历史</h2></div>
          <button class="ghost" :disabled="loading" @click="newProject">新建</button>
        </div>
        <div v-if="projects.length" class="history-list">
          <div v-for="item in projects" :key="item.id" class="history-swipe">
            <button class="history-card"
              :disabled="loading || deletingProjectId === item.id"
              @click="openSwipedHistory($event, item)">
              <div class="history-card-top">
                <span :class="['status-dot', item.status]"></span>
                <span>{{ statusLabel[item.status] }}</span>
                <time>{{ formatTime(item.updated_at) }}</time>
              </div>
              <h3>{{ item.selected_topic || item.source_topic }}</h3>
              <p>修改 {{ item.revision_count }} 次</p>
              <span class="continue-label">继续处理 →</span>
            </button>
            <button class="history-delete" type="button"
              :disabled="deletingProjectId === item.id"
              @click="removeHistoryProject(item)">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
              </svg>
              <span>{{ deletingProjectId === item.id ? "删除中" : "删除" }}</span>
            </button>
          </div>
        </div>
        <div v-else class="panel empty-state">
          <h2>还没有创作记录</h2>
          <p>从一个选题开始，之后可以随时回来继续。</p>
          <button @click="newProject">开始创作</button>
        </div>
      </section>

      <template v-else>
        <nav class="steps" aria-label="创作进度">
          <div v-for="(label, index) in stepLabels"
            :key="label"
            :class="{ completed: step > index + 1, current: step === index + 1 }"
            :aria-current="step === index + 1 ? 'step' : undefined">
            <span class="step-number">{{ step > index + 1 ? "✓" : index + 1 }}</span>
            <span class="step-label">{{ label }}</span>
          </div>
        </nav>

        <section v-if="!project" class="panel hero-panel stage-enter">
          <span class="kicker">START WITH AN IDEA</span>
          <h2>这次想写什么？</h2>
          <p class="hero-description">输入一个主题、产品或生活观察，AI 会帮你拆出三个值得写的方向。</p>
          <label class="sr-only" for="topic">输入创作主题</label>
          <textarea id="topic" v-model="sourceTopic"
            placeholder="例如：适合上班族的低成本健康早餐"
            @keydown.ctrl.enter="start" />
          <div class="input-hint">Ctrl + Enter 快速生成</div>
          <button class="full-button" :disabled="loading || !sourceTopic.trim()" @click="start">
            {{ loading ? "正在策划..." : "生成 3 个方向" }}
          </button>
        </section>

        <section v-else-if="project.status === 'waiting_topic'" class="workspace stage-enter">
          <div class="section-heading">
            <div><span class="kicker">AI 策划结果</span><h2>选择一个方向继续</h2></div>
            <button class="ghost" :disabled="loading" @click="newProject">新建</button>
          </div>
          <div class="topic-grid">
            <article v-for="(option, index) in project.topic_options" :key="option.title" class="topic-card">
              <div class="card-number">0{{ index + 1 }}</div>
              <h3>{{ option.title }}</h3>
              <p>{{ option.angle }}</p>
              <div class="audience">适合：{{ option.audience }}</div>
              <button :disabled="loading" @click="choose(option)">选择这个方向</button>
            </article>
          </div>
        </section>

        <section v-else-if="project.status === 'waiting_review'" class="workspace review-grid stage-enter">
          <article class="panel manuscript">
            <div class="section-heading">
              <div><span class="kicker">第 {{ project.latest_article?.version }} 版</span>
                <h2>{{ project.selected_topic }}</h2></div>
              <span class="revision">已修改 {{ project.revision_count }} 次</span>
            </div>
            <pre>{{ project.latest_article?.content }}</pre>
          </article>
          <aside class="panel review-panel">
            <span class="kicker">HUMAN IN THE LOOP</span>
            <h2>人工审核</h2>
            <p>填写修改意见重新生成，或审核通过生成发布稿。</p>
            <label for="feedback">修改意见</label>
            <textarea id="feedback" v-model="feedback" placeholder="例如：开头更有冲突感，语气更生活化。" />
            <div class="review-actions">
              <button class="secondary" :disabled="loading || !feedback.trim()" @click="review(false)">按意见重写</button>
              <button :disabled="loading" @click="review(true)">审核通过</button>
            </div>
          </aside>
        </section>

        <section v-else class="workspace stage-enter">
          <div class="section-heading">
            <div><span class="kicker success">READY TO PUBLISH</span><h2>发布稿已生成</h2></div>
            <button class="ghost" :disabled="loading" @click="newProject">新建</button>
          </div>
          <div class="package-grid">
            <section v-if="project.final_package?.images?.length" class="image-section">
              <div class="image-section-heading">
                <div>
                  <span class="kicker">VISUAL STORY</span>
                  <h2>文章配图</h2>
                </div>
                <span>{{ galleryIndex + 1 }} / {{ project.final_package.images.length }}</span>
              </div>
              <div class="gallery-frame">
                <div ref="galleryTrack" class="generated-gallery"
                  @scroll.passive="updateSlideIndex($event, 'gallery')">
                  <button v-for="(image, index) in project.final_package.images"
                    :key="image" class="generated-image" type="button"
                    :aria-label="`查看配图 ${index + 1}`" @click="openViewer(index)">
                    <img :src="image" :alt="`${project.final_package.title} 配图 ${index + 1}`"
                      loading="lazy" />
                    <span class="image-caption">
                      <span>配图 0{{ index + 1 }}</span>
                      <strong>点开查看</strong>
                    </span>
                  </button>
                </div>
                <button v-if="galleryIndex > 0" class="gallery-arrow gallery-prev"
                  type="button" aria-label="上一张"
                  @click="scrollToSlide('gallery', galleryIndex - 1)">←</button>
                <button v-if="galleryIndex < project.final_package.images.length - 1"
                  class="gallery-arrow gallery-next" type="button" aria-label="下一张"
                  @click="scrollToSlide('gallery', galleryIndex + 1)">→</button>
              </div>
              <div class="gallery-dots" aria-hidden="true">
                <span v-for="(_, index) in project.final_package.images" :key="index"
                  :class="{ active: galleryIndex === index }"></span>
              </div>
            </section>
            <div v-else-if="project.final_package?.image_generation_status === 'failed'"
              class="image-warning" role="status">
              <strong>文章已生成，配图生成失败</strong>
              <span>{{ project.final_package.image_generation_error || "可以稍后重新创建项目再试。" }}</span>
            </div>
            <article class="panel copy-card">
              <div class="copy-card-heading">
                <div><span class="kicker">小红书发布稿</span><h2>复制后可直接粘贴</h2></div>
                <span class="copy-status">{{ copied ? "已复制" : "排版完成" }}</span>
              </div>
              <pre class="publish-copy">{{ project.final_package?.copy_text }}</pre>
              <button class="copy-button" @click="copyPublishText">
                {{ copied ? "复制成功" : "一键复制发布稿" }}
              </button>
            </article>
          </div>
        </section>
      </template>
    </template>

    <Teleport to="body">
      <Transition name="loader">
        <section v-if="loadingStage && currentLoadingContent" class="llm-loading-layer"
          aria-live="polite" aria-busy="true">
          <div class="llm-loader" role="progressbar" aria-label="AI 内容生成进度"
            aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(loadingProgress)">
            <div class="loader-orbit" aria-hidden="true">
              <span></span><span></span><span></span>
            </div>
            <div class="loader-copy">
              <span class="loader-eyebrow">{{ currentLoadingContent.eyebrow }}</span>
              <h2>{{ currentLoadingContent.title }}</h2>
              <p>{{ currentLoadingContent.detail }}</p>
            </div>
            <div class="progress-meta">
              <span>AI PROCESSING</span>
              <strong>{{ Math.round(loadingProgress) }}%</strong>
            </div>
          <div class="progress-track" aria-hidden="true">
            <span class="progress-fill" :style="{ width: `${loadingProgress}%` }"></span>
            <span class="progress-glint"></span>
          </div>
          <div v-if="loadingStage === 'package'" class="generation-phases" aria-hidden="true">
            <span :class="{ active: loadingProgress < 45, completed: loadingProgress >= 45 }">
              <i>01</i> 最终文章
            </span>
            <span :class="{ active: loadingProgress >= 45 && loadingProgress < 100,
              completed: loadingProgress >= 100 }">
              <i>02</i> 文章配图
            </span>
          </div>
          <p class="loader-note">请保持页面开启，完成后会自动显示结果</p>
          </div>
        </section>
      </Transition>

      <Transition name="viewer">
        <section v-if="viewerOpen && project?.final_package?.images?.length"
          class="image-viewer" role="dialog" aria-modal="true" aria-label="文章配图查看器">
          <header class="viewer-header">
            <div>
              <span>VISUAL STORY</span>
              <strong>{{ viewerIndex + 1 }} / {{ project.final_package.images.length }}</strong>
            </div>
            <button type="button" aria-label="关闭图片查看器" @click.stop="closeViewer">
              <span aria-hidden="true"></span>
            </button>
          </header>
          <div ref="viewerTrack" class="viewer-track"
            @click.self="closeViewer"
            @scroll.passive="updateSlideIndex($event, 'viewer')">
            <figure v-for="(image, index) in project.final_package.images" :key="image"
              @click.self="closeViewer">
              <img :src="image" :alt="`${project.final_package.title} 配图 ${index + 1}`" />
            </figure>
          </div>
          <footer class="viewer-footer">
            <button type="button" :disabled="viewerIndex === 0"
              @click="scrollToSlide('viewer', viewerIndex - 1)">上一张</button>
            <div class="viewer-dots">
              <span v-for="(_, index) in project.final_package.images" :key="index"
                :class="{ active: viewerIndex === index }"></span>
            </div>
            <a :href="project.final_package.images[viewerIndex]"
              :download="`xhs-image-${viewerIndex + 1}`">下载原图</a>
            <button type="button"
              :disabled="viewerIndex === project.final_package.images.length - 1"
              @click="scrollToSlide('viewer', viewerIndex + 1)">下一张</button>
          </footer>
        </section>
      </Transition>
    </Teleport>

    <Transition name="toast">
      <p v-if="notice" class="notice" role="status" aria-live="polite">{{ notice }}</p>
    </Transition>
    <p v-if="error" class="error" role="alert" aria-live="assertive">{{ error }}</p>
  </main>
</template>
