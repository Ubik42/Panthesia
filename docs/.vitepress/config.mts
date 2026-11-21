import { defineConfig } from "vitepress";
export default defineConfig({
  title: "Panthesia",
  description: "开源钢琴练习软件",
  base: "/Panthesia/",
  themeConfig: {
    nav: [{ text: "首页", link: "/" }, { text: "启动", link: "/pages/installation" }, { text: "开发计划", link: "/development/current-plan" }],
    sidebar: [{ text: "工程", items: [
      { text: "文档入口", link: "/development/README" },
      { text: "开发计划", link: "/development/current-plan" },
      { text: "进度记录", link: "/development/progress" },
      { text: "交互规范", link: "/development/interaction-model" },
      { text: "架构决策", link: "/development/architecture-decisions" },
      { text: "歌曲数据", link: "/development/song-core" },
      { text: "音乐领域", link: "/development/music-domain" }
    ] }],
    socialLinks: [{ icon: "github", link: "https://github.com/Ubik42/Panthesia" }]
  }
});
