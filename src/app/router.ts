import { createRouter, createWebHistory } from "vue-router";
import HomePage from "../pages/projects/index.vue";
import ProjectPage from "../pages/projects/[id].vue";
import SettingsPage from "../pages/settings.vue";
import LauncherPage from "../pages/index.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "launcher", component: LauncherPage },
    { path: "/projects", name: "home", component: HomePage },
    { path: "/projects/:id", name: "project", component: ProjectPage },
    { path: "/settings", name: "settings", component: SettingsPage },
  ],
});
