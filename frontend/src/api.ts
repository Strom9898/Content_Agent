import axios from "axios";
import type { AuthResponse, Project, User } from "./types";

const api = axios.create({ baseURL: "/api" });
const TOKEN_KEY = "xhs_agent_token";

// 每次请求动态读取 Token，登录或退出后无需重新创建 axios 实例。
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const saveToken = (token: string) =>
  localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);
export const hasToken = () => Boolean(localStorage.getItem(TOKEN_KEY));

export const register = async (username: string, password: string) =>
  (
    await api.post<AuthResponse>("/auth/register", {
      username,
      password,
    })
  ).data;

export const login = async (username: string, password: string) =>
  (
    await api.post<AuthResponse>("/auth/login", {
      username,
      password,
    })
  ).data;

export const getMe = async () => (await api.get<User>("/auth/me")).data;

export const listProjects = async () =>
  (await api.get<Project[]>("/projects")).data;

export const getProject = async (projectId: string) =>
  (await api.get<Project>(`/projects/${projectId}`)).data;

export const getGenerationProgress = async (projectId: string) =>
  (
    await api.get<{
      stage: string;
      progress: number;
      message: string;
    }>(`/projects/${projectId}/generation-progress`)
  ).data;

export const deleteProject = async (projectId: string) => {
  await api.delete(`/projects/${projectId}`);
};

export const createProject = async (sourceTopic: string) =>
  (await api.post<Project>("/projects", { source_topic: sourceTopic })).data;

export const selectTopic = async (projectId: string, topic: string) =>
  (
    await api.post<Project>(`/projects/${projectId}/select-topic`, {
      topic,
    })
  ).data;

export const submitReview = async (
  projectId: string,
  approved: boolean,
  feedback = "",
) =>
  (
    await api.post<Project>(`/projects/${projectId}/review`, {
      approved,
      feedback,
    })
  ).data;
