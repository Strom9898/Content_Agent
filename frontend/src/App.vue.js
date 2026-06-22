import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { clearToken, createProject, deleteProject, getGenerationProgress, getMe, getProject, hasToken, listProjects, login, register, saveToken, selectTopic, submitReview, } from "./api";
const user = ref(null);
const projects = ref([]);
const project = ref(null);
const activeTab = ref("create");
const authMode = ref("login");
const username = ref("");
const password = ref("");
const sourceTopic = ref("");
const feedback = ref("");
const loading = ref(false);
const initializing = ref(true);
const error = ref("");
const notice = ref("");
const copied = ref(false);
const deletingProjectId = ref(null);
const galleryIndex = ref(0);
const viewerIndex = ref(0);
const viewerOpen = ref(false);
const galleryTrack = ref(null);
const viewerTrack = ref(null);
let viewerScrollY = 0;
const loadingStage = ref(null);
const loadingProgress = ref(0);
const generationStage = ref("");
const generationMessage = ref("");
let progressTimer;
let progressPollTimer;
let noticeTimer;
const loadingContent = {
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
const currentLoadingContent = computed(() => loadingStage.value === "package" && generationMessage.value
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
        : null);
const step = computed(() => {
    if (!project.value)
        return 1;
    if (project.value.status === "waiting_topic")
        return 2;
    if (project.value.status === "waiting_review")
        return 3;
    return 4;
});
const stepLabels = ["输入选题", "选择方向", "审核文章", "发布包"];
const statusLabel = {
    new: "生成中",
    waiting_topic: "等待选择选题",
    waiting_review: "等待审核文章",
    completed: "已生成发布稿",
};
function showError(reason) {
    if (reason.response?.status === 401) {
        logout();
        error.value = "登录已失效，请重新登录。";
        return;
    }
    error.value = reason.response?.data?.detail ?? "请求失败，请稍后重试。";
}
function showNotice(message) {
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
function beginLlmLoading(stage, projectId) {
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
                if (loadingStage.value !== "package" || progress.stage === "idle")
                    return;
                generationStage.value = progress.stage;
                generationMessage.value = progress.message;
                loadingProgress.value = Math.max(loadingProgress.value, progress.progress);
            }
            catch {
                // The main request owns error handling; polling is only progressive feedback.
            }
        }, 600);
        return;
    }
    progressTimer = window.setInterval(() => {
        const remaining = 92 - loadingProgress.value;
        if (remaining <= 0)
            return;
        loadingProgress.value = Math.min(92, loadingProgress.value + Math.max(0.35, remaining * 0.065));
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
    }
    catch (reason) {
        showError(reason);
    }
    finally {
        loading.value = false;
    }
}
async function refreshHistory() {
    try {
        projects.value = await listProjects();
    }
    catch (reason) {
        showError(reason);
    }
}
async function openHistory(item) {
    loading.value = true;
    error.value = "";
    try {
        // 项目 ID 就是 LangGraph thread_id，读取项目后可继续原 checkpoint。
        project.value = await getProject(item.id);
        galleryIndex.value = 0;
        viewerIndex.value = 0;
        activeTab.value = "create";
        await scrollPageToTop();
    }
    catch (reason) {
        showError(reason);
    }
    finally {
        loading.value = false;
    }
}
async function run(stage, task, progressProjectId) {
    if (loading.value)
        return;
    let completed = false;
    loading.value = true;
    error.value = "";
    beginLlmLoading(stage, progressProjectId);
    try {
        project.value = await task();
        await refreshHistory();
        completed = true;
    }
    catch (reason) {
        showError(reason);
    }
    finally {
        await finishLlmLoading();
        loading.value = false;
        if (completed)
            await scrollPageToTop();
    }
}
async function start() {
    if (loading.value || !sourceTopic.value.trim())
        return;
    await run("topics", () => createProject(sourceTopic.value.trim()));
}
async function choose(option) {
    if (loading.value || !project.value)
        return;
    await run("article", () => selectTopic(project.value.id, option.title));
}
async function review(approved) {
    if (loading.value || !project.value)
        return;
    await run(approved ? "package" : "rewrite", () => submitReview(project.value.id, approved, feedback.value), approved ? project.value.id : undefined);
    if (!approved)
        feedback.value = "";
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
function openSwipedHistory(event, item) {
    const row = event.currentTarget.closest(".history-swipe");
    if (row && row.scrollLeft > 8)
        return;
    void openHistory(item);
}
async function removeHistoryProject(item) {
    if (deletingProjectId.value)
        return;
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
    }
    catch (reason) {
        showError(reason);
    }
    finally {
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
    if (!text)
        return;
    try {
        await navigator.clipboard.writeText(text);
    }
    catch {
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
function formatTime(value) {
    return new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}
function updateSlideIndex(event, target) {
    const element = event.currentTarget;
    const width = element.clientWidth;
    if (!width)
        return;
    const index = Math.round(element.scrollLeft / width);
    if (target === "gallery")
        galleryIndex.value = index;
    else
        viewerIndex.value = index;
}
function scrollToSlide(target, index) {
    const images = project.value?.final_package?.images ?? [];
    if (!images.length)
        return;
    const boundedIndex = Math.max(0, Math.min(index, images.length - 1));
    const element = target === "gallery" ? galleryTrack.value : viewerTrack.value;
    element?.scrollTo({ left: element.clientWidth * boundedIndex, behavior: "smooth" });
    if (target === "gallery")
        galleryIndex.value = boundedIndex;
    else
        viewerIndex.value = boundedIndex;
}
async function openViewer(index) {
    viewerIndex.value = index;
    viewerOpen.value = true;
    viewerScrollY = window.scrollY;
    document.body.style.top = `-${viewerScrollY}px`;
    document.body.classList.add("viewer-active");
    await nextTick();
    viewerTrack.value?.scrollTo({ left: viewerTrack.value.clientWidth * index });
}
function closeViewer() {
    if (!viewerOpen.value)
        return;
    viewerOpen.value = false;
    document.body.classList.remove("viewer-active");
    document.body.style.top = "";
    window.scrollTo(0, viewerScrollY);
}
function handleViewerKeydown(event) {
    if (!viewerOpen.value)
        return;
    if (event.key === "Escape")
        closeViewer();
    if (event.key === "ArrowLeft")
        scrollToSlide("viewer", viewerIndex.value - 1);
    if (event.key === "ArrowRight")
        scrollToSlide("viewer", viewerIndex.value + 1);
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
    }
    catch {
        clearToken();
    }
    finally {
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
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.main, __VLS_intrinsicElements.main)({
    ...{ class: (['shell', { 'shell-auth': !__VLS_ctx.initializing && !__VLS_ctx.user, 'shell-app': __VLS_ctx.user }]) },
});
if (__VLS_ctx.initializing) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "splash" },
    });
}
else if (!__VLS_ctx.user) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
        ...{ class: "app-header auth-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "brand-lockup" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "brand-mark" },
        'aria-hidden': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "panel auth-panel" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: (['auth-switch', `is-${__VLS_ctx.authMode}`]) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "tab-slider" },
        'aria-hidden': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.initializing))
                    return;
                if (!(!__VLS_ctx.user))
                    return;
                __VLS_ctx.authMode = 'login';
            } },
        ...{ class: ({ active: __VLS_ctx.authMode === 'login' }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.initializing))
                    return;
                if (!(!__VLS_ctx.user))
                    return;
                __VLS_ctx.authMode = 'register';
            } },
        ...{ class: ({ active: __VLS_ctx.authMode === 'register' }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
        for: "username",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        id: "username",
        autocomplete: "username",
        placeholder: "3-30 位用户名",
    });
    (__VLS_ctx.username);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
        for: "password",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        ...{ onKeydown: (__VLS_ctx.submitAuth) },
        id: "password",
        type: "password",
        autocomplete: (__VLS_ctx.authMode === 'login' ? 'current-password' : 'new-password'),
        placeholder: "至少 8 位密码",
    });
    (__VLS_ctx.password);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.submitAuth) },
        ...{ class: "auth-submit" },
        disabled: (__VLS_ctx.loading || __VLS_ctx.username.length < 3 || __VLS_ctx.password.length < 8),
    });
    (__VLS_ctx.loading ? "请稍候..." : __VLS_ctx.authMode === "login" ? "登录" : "创建账号");
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
        ...{ class: "app-header signed-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "brand-lockup" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "brand-mark" },
        'aria-hidden': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
    (__VLS_ctx.user.username);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.logout) },
        ...{ class: "logout-button" },
        disabled: (__VLS_ctx.loading),
        'aria-label': "退出登录",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
        viewBox: "0 0 24 24",
        'aria-hidden': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
        d: "M14 8V5.5A1.5 1.5 0 0 0 12.5 4h-6A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h6a1.5 1.5 0 0 0 1.5-1.5V16",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
        d: "M10 12h9m-3-3 3 3-3 3",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.nav, __VLS_intrinsicElements.nav)({
        ...{ class: (['main-tabs', `is-${__VLS_ctx.activeTab}`]) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "tab-slider" },
        'aria-hidden': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.initializing))
                    return;
                if (!!(!__VLS_ctx.user))
                    return;
                __VLS_ctx.activeTab = 'create';
            } },
        ...{ class: ({ active: __VLS_ctx.activeTab === 'create' }) },
        disabled: (__VLS_ctx.loading),
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "tab-icon" },
        'aria-hidden': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.initializing))
                    return;
                if (!!(!__VLS_ctx.user))
                    return;
                __VLS_ctx.activeTab = 'history';
                __VLS_ctx.refreshHistory();
            } },
        ...{ class: ({ active: __VLS_ctx.activeTab === 'history' }) },
        disabled: (__VLS_ctx.loading),
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "tab-icon tab-icon-history" },
        'aria-hidden': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    if (__VLS_ctx.projects.length) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "tab-count" },
        });
        (__VLS_ctx.projects.length);
    }
    if (__VLS_ctx.activeTab === 'history') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "history-view" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "section-heading history-heading" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "kicker" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.newProject) },
            ...{ class: "ghost" },
            disabled: (__VLS_ctx.loading),
        });
        if (__VLS_ctx.projects.length) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "history-list" },
            });
            for (const [item] of __VLS_getVForSourceType((__VLS_ctx.projects))) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    key: (item.id),
                    ...{ class: "history-swipe" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!!(__VLS_ctx.initializing))
                                return;
                            if (!!(!__VLS_ctx.user))
                                return;
                            if (!(__VLS_ctx.activeTab === 'history'))
                                return;
                            if (!(__VLS_ctx.projects.length))
                                return;
                            __VLS_ctx.openSwipedHistory($event, item);
                        } },
                    ...{ class: "history-card" },
                    disabled: (__VLS_ctx.loading || __VLS_ctx.deletingProjectId === item.id),
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "history-card-top" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: (['status-dot', item.status]) },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.statusLabel[item.status]);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.time, __VLS_intrinsicElements.time)({});
                (__VLS_ctx.formatTime(item.updated_at));
                __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
                (item.selected_topic || item.source_topic);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
                (item.revision_count);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "continue-label" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!!(__VLS_ctx.initializing))
                                return;
                            if (!!(!__VLS_ctx.user))
                                return;
                            if (!(__VLS_ctx.activeTab === 'history'))
                                return;
                            if (!(__VLS_ctx.projects.length))
                                return;
                            __VLS_ctx.removeHistoryProject(item);
                        } },
                    ...{ class: "history-delete" },
                    type: "button",
                    disabled: (__VLS_ctx.deletingProjectId === item.id),
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
                    viewBox: "0 0 24 24",
                    'aria-hidden': "true",
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
                    d: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5",
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.deletingProjectId === item.id ? "删除中" : "删除");
            }
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "panel empty-state" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.newProject) },
            });
        }
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.nav, __VLS_intrinsicElements.nav)({
            ...{ class: "steps" },
            'aria-label': "创作进度",
        });
        for (const [label, index] of __VLS_getVForSourceType((__VLS_ctx.stepLabels))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (label),
                ...{ class: ({ completed: __VLS_ctx.step > index + 1, current: __VLS_ctx.step === index + 1 }) },
                'aria-current': (__VLS_ctx.step === index + 1 ? 'step' : undefined),
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "step-number" },
            });
            (__VLS_ctx.step > index + 1 ? "✓" : index + 1);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "step-label" },
            });
            (label);
        }
        if (!__VLS_ctx.project) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
                ...{ class: "panel hero-panel stage-enter" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "kicker" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
                ...{ class: "hero-description" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
                ...{ class: "sr-only" },
                for: "topic",
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.textarea)({
                ...{ onKeydown: (__VLS_ctx.start) },
                id: "topic",
                value: (__VLS_ctx.sourceTopic),
                placeholder: "例如：适合上班族的低成本健康早餐",
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "input-hint" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.start) },
                ...{ class: "full-button" },
                disabled: (__VLS_ctx.loading || !__VLS_ctx.sourceTopic.trim()),
            });
            (__VLS_ctx.loading ? "正在策划..." : "生成 3 个方向");
        }
        else if (__VLS_ctx.project.status === 'waiting_topic') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
                ...{ class: "workspace stage-enter" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "section-heading" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "kicker" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.newProject) },
                ...{ class: "ghost" },
                disabled: (__VLS_ctx.loading),
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "topic-grid" },
            });
            for (const [option, index] of __VLS_getVForSourceType((__VLS_ctx.project.topic_options))) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.article, __VLS_intrinsicElements.article)({
                    key: (option.title),
                    ...{ class: "topic-card" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "card-number" },
                });
                (index + 1);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
                (option.title);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
                (option.angle);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "audience" },
                });
                (option.audience);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!!(__VLS_ctx.initializing))
                                return;
                            if (!!(!__VLS_ctx.user))
                                return;
                            if (!!(__VLS_ctx.activeTab === 'history'))
                                return;
                            if (!!(!__VLS_ctx.project))
                                return;
                            if (!(__VLS_ctx.project.status === 'waiting_topic'))
                                return;
                            __VLS_ctx.choose(option);
                        } },
                    disabled: (__VLS_ctx.loading),
                });
            }
        }
        else if (__VLS_ctx.project.status === 'waiting_review') {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
                ...{ class: "workspace review-grid stage-enter" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.article, __VLS_intrinsicElements.article)({
                ...{ class: "panel manuscript" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "section-heading" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "kicker" },
            });
            (__VLS_ctx.project.latest_article?.version);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
            (__VLS_ctx.project.selected_topic);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "revision" },
            });
            (__VLS_ctx.project.revision_count);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({});
            (__VLS_ctx.project.latest_article?.content);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.aside, __VLS_intrinsicElements.aside)({
                ...{ class: "panel review-panel" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "kicker" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
                for: "feedback",
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.textarea)({
                id: "feedback",
                value: (__VLS_ctx.feedback),
                placeholder: "例如：开头更有冲突感，语气更生活化。",
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "review-actions" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(__VLS_ctx.initializing))
                            return;
                        if (!!(!__VLS_ctx.user))
                            return;
                        if (!!(__VLS_ctx.activeTab === 'history'))
                            return;
                        if (!!(!__VLS_ctx.project))
                            return;
                        if (!!(__VLS_ctx.project.status === 'waiting_topic'))
                            return;
                        if (!(__VLS_ctx.project.status === 'waiting_review'))
                            return;
                        __VLS_ctx.review(false);
                    } },
                ...{ class: "secondary" },
                disabled: (__VLS_ctx.loading || !__VLS_ctx.feedback.trim()),
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!!(__VLS_ctx.initializing))
                            return;
                        if (!!(!__VLS_ctx.user))
                            return;
                        if (!!(__VLS_ctx.activeTab === 'history'))
                            return;
                        if (!!(!__VLS_ctx.project))
                            return;
                        if (!!(__VLS_ctx.project.status === 'waiting_topic'))
                            return;
                        if (!(__VLS_ctx.project.status === 'waiting_review'))
                            return;
                        __VLS_ctx.review(true);
                    } },
                disabled: (__VLS_ctx.loading),
            });
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
                ...{ class: "workspace stage-enter" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "section-heading" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "kicker success" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.newProject) },
                ...{ class: "ghost" },
                disabled: (__VLS_ctx.loading),
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "package-grid" },
            });
            if (__VLS_ctx.project.final_package?.images?.length) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
                    ...{ class: "image-section" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "image-section-heading" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "kicker" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.galleryIndex + 1);
                (__VLS_ctx.project.final_package.images.length);
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "gallery-frame" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ onScroll: (...[$event]) => {
                            if (!!(__VLS_ctx.initializing))
                                return;
                            if (!!(!__VLS_ctx.user))
                                return;
                            if (!!(__VLS_ctx.activeTab === 'history'))
                                return;
                            if (!!(!__VLS_ctx.project))
                                return;
                            if (!!(__VLS_ctx.project.status === 'waiting_topic'))
                                return;
                            if (!!(__VLS_ctx.project.status === 'waiting_review'))
                                return;
                            if (!(__VLS_ctx.project.final_package?.images?.length))
                                return;
                            __VLS_ctx.updateSlideIndex($event, 'gallery');
                        } },
                    ref: "galleryTrack",
                    ...{ class: "generated-gallery" },
                });
                /** @type {typeof __VLS_ctx.galleryTrack} */ ;
                for (const [image, index] of __VLS_getVForSourceType((__VLS_ctx.project.final_package.images))) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                        ...{ onClick: (...[$event]) => {
                                if (!!(__VLS_ctx.initializing))
                                    return;
                                if (!!(!__VLS_ctx.user))
                                    return;
                                if (!!(__VLS_ctx.activeTab === 'history'))
                                    return;
                                if (!!(!__VLS_ctx.project))
                                    return;
                                if (!!(__VLS_ctx.project.status === 'waiting_topic'))
                                    return;
                                if (!!(__VLS_ctx.project.status === 'waiting_review'))
                                    return;
                                if (!(__VLS_ctx.project.final_package?.images?.length))
                                    return;
                                __VLS_ctx.openViewer(index);
                            } },
                        key: (image),
                        ...{ class: "generated-image" },
                        type: "button",
                        'aria-label': (`查看配图 ${index + 1}`),
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.img)({
                        src: (image),
                        alt: (`${__VLS_ctx.project.final_package.title} 配图 ${index + 1}`),
                        loading: "lazy",
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        ...{ class: "image-caption" },
                    });
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                    (index + 1);
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
                }
                if (__VLS_ctx.galleryIndex > 0) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                        ...{ onClick: (...[$event]) => {
                                if (!!(__VLS_ctx.initializing))
                                    return;
                                if (!!(!__VLS_ctx.user))
                                    return;
                                if (!!(__VLS_ctx.activeTab === 'history'))
                                    return;
                                if (!!(!__VLS_ctx.project))
                                    return;
                                if (!!(__VLS_ctx.project.status === 'waiting_topic'))
                                    return;
                                if (!!(__VLS_ctx.project.status === 'waiting_review'))
                                    return;
                                if (!(__VLS_ctx.project.final_package?.images?.length))
                                    return;
                                if (!(__VLS_ctx.galleryIndex > 0))
                                    return;
                                __VLS_ctx.scrollToSlide('gallery', __VLS_ctx.galleryIndex - 1);
                            } },
                        ...{ class: "gallery-arrow gallery-prev" },
                        type: "button",
                        'aria-label': "上一张",
                    });
                }
                if (__VLS_ctx.galleryIndex < __VLS_ctx.project.final_package.images.length - 1) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                        ...{ onClick: (...[$event]) => {
                                if (!!(__VLS_ctx.initializing))
                                    return;
                                if (!!(!__VLS_ctx.user))
                                    return;
                                if (!!(__VLS_ctx.activeTab === 'history'))
                                    return;
                                if (!!(!__VLS_ctx.project))
                                    return;
                                if (!!(__VLS_ctx.project.status === 'waiting_topic'))
                                    return;
                                if (!!(__VLS_ctx.project.status === 'waiting_review'))
                                    return;
                                if (!(__VLS_ctx.project.final_package?.images?.length))
                                    return;
                                if (!(__VLS_ctx.galleryIndex < __VLS_ctx.project.final_package.images.length - 1))
                                    return;
                                __VLS_ctx.scrollToSlide('gallery', __VLS_ctx.galleryIndex + 1);
                            } },
                        ...{ class: "gallery-arrow gallery-next" },
                        type: "button",
                        'aria-label': "下一张",
                    });
                }
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "gallery-dots" },
                    'aria-hidden': "true",
                });
                for (const [_, index] of __VLS_getVForSourceType((__VLS_ctx.project.final_package.images))) {
                    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                        key: (index),
                        ...{ class: ({ active: __VLS_ctx.galleryIndex === index }) },
                    });
                }
            }
            else if (__VLS_ctx.project.final_package?.image_generation_status === 'failed') {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "image-warning" },
                    role: "status",
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
                (__VLS_ctx.project.final_package.image_generation_error || "可以稍后重新创建项目再试。");
            }
            __VLS_asFunctionalElement(__VLS_intrinsicElements.article, __VLS_intrinsicElements.article)({
                ...{ class: "panel copy-card" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "copy-card-heading" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "kicker" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "copy-status" },
            });
            (__VLS_ctx.copied ? "已复制" : "排版完成");
            __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
                ...{ class: "publish-copy" },
            });
            (__VLS_ctx.project.final_package?.copy_text);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.copyPublishText) },
                ...{ class: "copy-button" },
            });
            (__VLS_ctx.copied ? "复制成功" : "一键复制发布稿");
        }
    }
}
const __VLS_0 = {}.Teleport;
/** @type {[typeof __VLS_components.Teleport, typeof __VLS_components.Teleport, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    to: "body",
}));
const __VLS_2 = __VLS_1({
    to: "body",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_3.slots.default;
const __VLS_4 = {}.Transition;
/** @type {[typeof __VLS_components.Transition, typeof __VLS_components.Transition, ]} */ ;
// @ts-ignore
const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
    name: "loader",
}));
const __VLS_6 = __VLS_5({
    name: "loader",
}, ...__VLS_functionalComponentArgsRest(__VLS_5));
__VLS_7.slots.default;
if (__VLS_ctx.loadingStage && __VLS_ctx.currentLoadingContent) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "llm-loading-layer" },
        'aria-live': "polite",
        'aria-busy': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "llm-loader" },
        role: "progressbar",
        'aria-label': "AI 内容生成进度",
        'aria-valuemin': "0",
        'aria-valuemax': "100",
        'aria-valuenow': (Math.round(__VLS_ctx.loadingProgress)),
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "loader-orbit" },
        'aria-hidden': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "loader-copy" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "loader-eyebrow" },
    });
    (__VLS_ctx.currentLoadingContent.eyebrow);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
    (__VLS_ctx.currentLoadingContent.title);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({});
    (__VLS_ctx.currentLoadingContent.detail);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "progress-meta" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
    (Math.round(__VLS_ctx.loadingProgress));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "progress-track" },
        'aria-hidden': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "progress-fill" },
        ...{ style: ({ width: `${__VLS_ctx.loadingProgress}%` }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "progress-glint" },
    });
    if (__VLS_ctx.loadingStage === 'package') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "generation-phases" },
            'aria-hidden': "true",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: ({ active: __VLS_ctx.loadingProgress < 45, completed: __VLS_ctx.loadingProgress >= 45 }) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.i, __VLS_intrinsicElements.i)({});
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: ({ active: __VLS_ctx.loadingProgress >= 45 && __VLS_ctx.loadingProgress < 100,
                    completed: __VLS_ctx.loadingProgress >= 100 }) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.i, __VLS_intrinsicElements.i)({});
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "loader-note" },
    });
}
var __VLS_7;
const __VLS_8 = {}.Transition;
/** @type {[typeof __VLS_components.Transition, typeof __VLS_components.Transition, ]} */ ;
// @ts-ignore
const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
    name: "viewer",
}));
const __VLS_10 = __VLS_9({
    name: "viewer",
}, ...__VLS_functionalComponentArgsRest(__VLS_9));
__VLS_11.slots.default;
if (__VLS_ctx.viewerOpen && __VLS_ctx.project?.final_package?.images?.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
        ...{ class: "image-viewer" },
        role: "dialog",
        'aria-modal': "true",
        'aria-label': "文章配图查看器",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
        ...{ class: "viewer-header" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
    (__VLS_ctx.viewerIndex + 1);
    (__VLS_ctx.project.final_package.images.length);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.closeViewer) },
        type: "button",
        'aria-label': "关闭图片查看器",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        'aria-hidden': "true",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ onClick: (__VLS_ctx.closeViewer) },
        ...{ onScroll: (...[$event]) => {
                if (!(__VLS_ctx.viewerOpen && __VLS_ctx.project?.final_package?.images?.length))
                    return;
                __VLS_ctx.updateSlideIndex($event, 'viewer');
            } },
        ref: "viewerTrack",
        ...{ class: "viewer-track" },
    });
    /** @type {typeof __VLS_ctx.viewerTrack} */ ;
    for (const [image, index] of __VLS_getVForSourceType((__VLS_ctx.project.final_package.images))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.figure, __VLS_intrinsicElements.figure)({
            ...{ onClick: (__VLS_ctx.closeViewer) },
            key: (image),
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.img)({
            src: (image),
            alt: (`${__VLS_ctx.project.final_package.title} 配图 ${index + 1}`),
        });
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.footer, __VLS_intrinsicElements.footer)({
        ...{ class: "viewer-footer" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.viewerOpen && __VLS_ctx.project?.final_package?.images?.length))
                    return;
                __VLS_ctx.scrollToSlide('viewer', __VLS_ctx.viewerIndex - 1);
            } },
        type: "button",
        disabled: (__VLS_ctx.viewerIndex === 0),
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "viewer-dots" },
    });
    for (const [_, index] of __VLS_getVForSourceType((__VLS_ctx.project.final_package.images))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            key: (index),
            ...{ class: ({ active: __VLS_ctx.viewerIndex === index }) },
        });
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.a, __VLS_intrinsicElements.a)({
        href: (__VLS_ctx.project.final_package.images[__VLS_ctx.viewerIndex]),
        download: (`xhs-image-${__VLS_ctx.viewerIndex + 1}`),
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.viewerOpen && __VLS_ctx.project?.final_package?.images?.length))
                    return;
                __VLS_ctx.scrollToSlide('viewer', __VLS_ctx.viewerIndex + 1);
            } },
        type: "button",
        disabled: (__VLS_ctx.viewerIndex === __VLS_ctx.project.final_package.images.length - 1),
    });
}
var __VLS_11;
var __VLS_3;
const __VLS_12 = {}.Transition;
/** @type {[typeof __VLS_components.Transition, typeof __VLS_components.Transition, ]} */ ;
// @ts-ignore
const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
    name: "toast",
}));
const __VLS_14 = __VLS_13({
    name: "toast",
}, ...__VLS_functionalComponentArgsRest(__VLS_13));
__VLS_15.slots.default;
if (__VLS_ctx.notice) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "notice" },
        role: "status",
        'aria-live': "polite",
    });
    (__VLS_ctx.notice);
}
var __VLS_15;
if (__VLS_ctx.error) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "error" },
        role: "alert",
        'aria-live': "assertive",
    });
    (__VLS_ctx.error);
}
/** @type {__VLS_StyleScopedClasses['shell']} */ ;
/** @type {__VLS_StyleScopedClasses['shell-auth']} */ ;
/** @type {__VLS_StyleScopedClasses['shell-app']} */ ;
/** @type {__VLS_StyleScopedClasses['splash']} */ ;
/** @type {__VLS_StyleScopedClasses['app-header']} */ ;
/** @type {__VLS_StyleScopedClasses['auth-header']} */ ;
/** @type {__VLS_StyleScopedClasses['brand-lockup']} */ ;
/** @type {__VLS_StyleScopedClasses['brand-mark']} */ ;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['auth-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['auth-switch']} */ ;
/** @type {__VLS_StyleScopedClasses['tab-slider']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['auth-submit']} */ ;
/** @type {__VLS_StyleScopedClasses['app-header']} */ ;
/** @type {__VLS_StyleScopedClasses['signed-header']} */ ;
/** @type {__VLS_StyleScopedClasses['brand-lockup']} */ ;
/** @type {__VLS_StyleScopedClasses['brand-mark']} */ ;
/** @type {__VLS_StyleScopedClasses['logout-button']} */ ;
/** @type {__VLS_StyleScopedClasses['main-tabs']} */ ;
/** @type {__VLS_StyleScopedClasses['tab-slider']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['tab-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['tab-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['tab-icon-history']} */ ;
/** @type {__VLS_StyleScopedClasses['tab-count']} */ ;
/** @type {__VLS_StyleScopedClasses['history-view']} */ ;
/** @type {__VLS_StyleScopedClasses['section-heading']} */ ;
/** @type {__VLS_StyleScopedClasses['history-heading']} */ ;
/** @type {__VLS_StyleScopedClasses['kicker']} */ ;
/** @type {__VLS_StyleScopedClasses['ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['history-list']} */ ;
/** @type {__VLS_StyleScopedClasses['history-swipe']} */ ;
/** @type {__VLS_StyleScopedClasses['history-card']} */ ;
/** @type {__VLS_StyleScopedClasses['history-card-top']} */ ;
/** @type {__VLS_StyleScopedClasses['status-dot']} */ ;
/** @type {__VLS_StyleScopedClasses['continue-label']} */ ;
/** @type {__VLS_StyleScopedClasses['history-delete']} */ ;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['steps']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['current']} */ ;
/** @type {__VLS_StyleScopedClasses['step-number']} */ ;
/** @type {__VLS_StyleScopedClasses['step-label']} */ ;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['stage-enter']} */ ;
/** @type {__VLS_StyleScopedClasses['kicker']} */ ;
/** @type {__VLS_StyleScopedClasses['hero-description']} */ ;
/** @type {__VLS_StyleScopedClasses['sr-only']} */ ;
/** @type {__VLS_StyleScopedClasses['input-hint']} */ ;
/** @type {__VLS_StyleScopedClasses['full-button']} */ ;
/** @type {__VLS_StyleScopedClasses['workspace']} */ ;
/** @type {__VLS_StyleScopedClasses['stage-enter']} */ ;
/** @type {__VLS_StyleScopedClasses['section-heading']} */ ;
/** @type {__VLS_StyleScopedClasses['kicker']} */ ;
/** @type {__VLS_StyleScopedClasses['ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['topic-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['topic-card']} */ ;
/** @type {__VLS_StyleScopedClasses['card-number']} */ ;
/** @type {__VLS_StyleScopedClasses['audience']} */ ;
/** @type {__VLS_StyleScopedClasses['workspace']} */ ;
/** @type {__VLS_StyleScopedClasses['review-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['stage-enter']} */ ;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['manuscript']} */ ;
/** @type {__VLS_StyleScopedClasses['section-heading']} */ ;
/** @type {__VLS_StyleScopedClasses['kicker']} */ ;
/** @type {__VLS_StyleScopedClasses['revision']} */ ;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['review-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['kicker']} */ ;
/** @type {__VLS_StyleScopedClasses['review-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['secondary']} */ ;
/** @type {__VLS_StyleScopedClasses['workspace']} */ ;
/** @type {__VLS_StyleScopedClasses['stage-enter']} */ ;
/** @type {__VLS_StyleScopedClasses['section-heading']} */ ;
/** @type {__VLS_StyleScopedClasses['kicker']} */ ;
/** @type {__VLS_StyleScopedClasses['success']} */ ;
/** @type {__VLS_StyleScopedClasses['ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['package-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['image-section']} */ ;
/** @type {__VLS_StyleScopedClasses['image-section-heading']} */ ;
/** @type {__VLS_StyleScopedClasses['kicker']} */ ;
/** @type {__VLS_StyleScopedClasses['gallery-frame']} */ ;
/** @type {__VLS_StyleScopedClasses['generated-gallery']} */ ;
/** @type {__VLS_StyleScopedClasses['generated-image']} */ ;
/** @type {__VLS_StyleScopedClasses['image-caption']} */ ;
/** @type {__VLS_StyleScopedClasses['gallery-arrow']} */ ;
/** @type {__VLS_StyleScopedClasses['gallery-prev']} */ ;
/** @type {__VLS_StyleScopedClasses['gallery-arrow']} */ ;
/** @type {__VLS_StyleScopedClasses['gallery-next']} */ ;
/** @type {__VLS_StyleScopedClasses['gallery-dots']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['image-warning']} */ ;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['copy-card']} */ ;
/** @type {__VLS_StyleScopedClasses['copy-card-heading']} */ ;
/** @type {__VLS_StyleScopedClasses['kicker']} */ ;
/** @type {__VLS_StyleScopedClasses['copy-status']} */ ;
/** @type {__VLS_StyleScopedClasses['publish-copy']} */ ;
/** @type {__VLS_StyleScopedClasses['copy-button']} */ ;
/** @type {__VLS_StyleScopedClasses['llm-loading-layer']} */ ;
/** @type {__VLS_StyleScopedClasses['llm-loader']} */ ;
/** @type {__VLS_StyleScopedClasses['loader-orbit']} */ ;
/** @type {__VLS_StyleScopedClasses['loader-copy']} */ ;
/** @type {__VLS_StyleScopedClasses['loader-eyebrow']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-track']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-fill']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-glint']} */ ;
/** @type {__VLS_StyleScopedClasses['generation-phases']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['completed']} */ ;
/** @type {__VLS_StyleScopedClasses['loader-note']} */ ;
/** @type {__VLS_StyleScopedClasses['image-viewer']} */ ;
/** @type {__VLS_StyleScopedClasses['viewer-header']} */ ;
/** @type {__VLS_StyleScopedClasses['viewer-track']} */ ;
/** @type {__VLS_StyleScopedClasses['viewer-footer']} */ ;
/** @type {__VLS_StyleScopedClasses['viewer-dots']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['notice']} */ ;
/** @type {__VLS_StyleScopedClasses['error']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            user: user,
            projects: projects,
            project: project,
            activeTab: activeTab,
            authMode: authMode,
            username: username,
            password: password,
            sourceTopic: sourceTopic,
            feedback: feedback,
            loading: loading,
            initializing: initializing,
            error: error,
            notice: notice,
            copied: copied,
            deletingProjectId: deletingProjectId,
            galleryIndex: galleryIndex,
            viewerIndex: viewerIndex,
            viewerOpen: viewerOpen,
            galleryTrack: galleryTrack,
            viewerTrack: viewerTrack,
            loadingStage: loadingStage,
            loadingProgress: loadingProgress,
            currentLoadingContent: currentLoadingContent,
            step: step,
            stepLabels: stepLabels,
            statusLabel: statusLabel,
            submitAuth: submitAuth,
            refreshHistory: refreshHistory,
            start: start,
            choose: choose,
            review: review,
            newProject: newProject,
            openSwipedHistory: openSwipedHistory,
            removeHistoryProject: removeHistoryProject,
            logout: logout,
            copyPublishText: copyPublishText,
            formatTime: formatTime,
            updateSlideIndex: updateSlideIndex,
            scrollToSlide: scrollToSlide,
            openViewer: openViewer,
            closeViewer: closeViewer,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
