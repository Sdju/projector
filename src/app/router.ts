import { createRouter, createWebHistory } from "vue-router";
import HomePage from "../pages/home/HomePage.vue";
import ProjectPage from "../pages/project/ProjectPage.vue";
import SettingsPage from "../pages/settings/SettingsPage.vue";
import LauncherPage from "../pages/launcher/LauncherPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "launcher", component: LauncherPage },
    { path: "/projects", name: "home", component: HomePage },
    { path: "/projects/:id", name: "project", component: ProjectPage },
    { path: "/settings", name: "settings", component: SettingsPage },
  ],
});
