import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Panthesia",
  description: "Flashy Synthesia Like Software For Linux, Windows and MacOs",
  base: "/Panthesia/",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "How-to", link: "/pages/installation" },
      { text: "工程计划", link: "/development/current-plan" },
    ],

    sidebar: [
      {
        text: "How-to",
        items: [
          { text: "Installation", link: "/pages/installation" },
          { text: "Shortcuts", link: "/pages/shortcuts" },
          { text: "Customization", link: "/pages/customization" },
          { text: "Video Encoding", link: "/pages/video-encoding" },
        ],
      },
      {
        text: "Development",
        items: [
          { text: "当前目标与交付", link: "/development/current-plan" },
          { text: "架构现状与决策", link: "/development/architecture-decisions" },
          { text: "技术研讨复核", link: "/development/discussion-review" },
          { text: "历史开放项处置", link: "/development/open-items" },
          { text: "工程交接", link: "/development/handoff" },
          {
            text: "Piano Plug-in Hosting",
            link: "/pages/plugin-hosting-roadmap",
          },
          {
            text: "MusicXML Architecture",
            link: "/pages/musicxml-architecture",
          },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/PolyMeilex/Neothesia" },
    ],
  },
});
