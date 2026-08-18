import { BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";

function sendMenuCommand(command: {
  view: "overview" | "release" | "add" | "settings";
  projectId?: string;
  productId?: string;
}) {
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send("app:menu-command", command);
}

function projectSubmenu(
  projects: any[],
  view: "overview" | "release",
): MenuItemConstructorOptions[] {
  if (projects.length === 0) {
    return [{ label: "暂无项目", enabled: false }];
  }
  return projects.map((project) => ({
    label: project.name || project.localPath,
    ...(view === "release" && (project.storeProducts || []).length > 1
      ? {
          submenu: (project.storeProducts || []).map((product: any) => ({
            label:
              product.platform === "ios"
                ? "iOS"
                : product.platform === "macos"
                  ? "macOS"
                  : "未识别",
            click: () =>
              sendMenuCommand({ view, projectId: project.id, productId: product.id }),
          })),
        }
      : {
          click: () => sendMenuCommand({ view, projectId: project.id }),
        }),
  }));
}

export function updateApplicationMenu(store: any): void {
  const projects: any[] = (store.get("projects") || [])
    .map((project: any) => ({
      id: project.id,
      name: project.trackName || project.name || project.localPath,
      localPath: project.localPath,
      storeProducts: project.storeProducts || [],
    }));

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [{
          label: "Appilot",
          submenu: [
            { role: "about" as const },
            { type: "separator" as const },
            { label: "设置…", accelerator: "CmdOrCtrl+,", click: () => sendMenuCommand({ view: "settings" }) },
            { type: "separator" as const },
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            { type: "separator" as const },
            { role: "quit" as const },
          ],
        }]
      : []),
    {
      label: "文件",
      submenu: [
        { label: "添加项目…", accelerator: "CmdOrCtrl+N", click: () => sendMenuCommand({ view: "add" }) },
        { type: "separator" },
        { label: "项目总览", submenu: projectSubmenu(projects, "overview") },
        { label: "发布工作台", submenu: projectSubmenu(projects, "release") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
    {
      role: "help",
      label: "帮助",
      submenu: [
        { label: "Appilot 文档", click: () => void shell.openExternal("https://github.com/wxy/appilot") },
        { label: "GitHub 仓库", click: () => void shell.openExternal("https://github.com/wxy/appilot") },
        { label: "提交反馈", click: () => void shell.openExternal("https://github.com/wxy/appilot/issues") },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
