import axios from "axios";
const api = axios.create({ baseURL: "/api" });
const TOKEN_KEY = "xhs_agent_token";
// 每次请求动态读取 Token，登录或退出后无需重新创建 axios 实例。
api.interceptors.request.use((config) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token)
        config.headers.Authorization = `Bearer ${token}`;
    return config;
});
export const saveToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);
export const hasToken = () => Boolean(localStorage.getItem(TOKEN_KEY));
export const register = async (username, password) => (await api.post("/auth/register", {
    username,
    password,
})).data;
export const login = async (username, password) => (await api.post("/auth/login", {
    username,
    password,
})).data;
export const getMe = async () => (await api.get("/auth/me")).data;
export const listProjects = async () => (await api.get("/projects")).data;
export const getProject = async (projectId) => (await api.get(`/projects/${projectId}`)).data;
export const getGenerationProgress = async (projectId) => (await api.get(`/projects/${projectId}/generation-progress`)).data;
export const deleteProject = async (projectId) => {
    await api.delete(`/projects/${projectId}`);
};
export const createProject = async (sourceTopic) => (await api.post("/projects", { source_topic: sourceTopic })).data;
export const selectTopic = async (projectId, topic) => (await api.post(`/projects/${projectId}/select-topic`, {
    topic,
})).data;
export const submitReview = async (projectId, approved, feedback = "") => (await api.post(`/projects/${projectId}/review`, {
    approved,
    feedback,
})).data;
