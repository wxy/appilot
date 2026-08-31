/**
 * @appilot/dsh 客户端 UI 插件（浏览器端）。
 *
 * 当前为「渐进式安装」的无入口版本：本模块加载但不注册任何 UI 槽位。
 * 确认插件组/工具在 Harness 中稳定后，再在此文件加入可见入口
 * （sidebar.footer.action 按钮、settings.section、tool.call.toolview 等）。
 *
 * 保留 dsh.client 声明与 ./client 导出（结构不变），
 * 之后添加入口只需编辑本文件并重启 profile。
 */
window.__ModuleLoader__.load({
  id: '@appilot/dsh',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    /* 无入口版：apply 为空。 */
    function apply() {
      // 渐进式安装：暂不注册任何 UI。后续在此加入：
      // - sidebar.footer.action（侧边栏按钮 + 弹出面板）
      // - settings.section（设置页）
      // - tool.call.toolview（工具结果卡片）
    }

    exports.apply = apply;
    return module.exports;
  },
});
