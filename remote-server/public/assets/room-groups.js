/* 直播间分类（场地）数据源。
 *
 * 分类表由监控中心「分类设置」维护，随 /api/monitor/overview 下发给浏览器；
 * 本文件只持有当前分类表，并对外暴露同步查询 roomLocation(name)，供监控列表和
 * 常驻看板在渲染时直接调用（两者都是同步渲染，不适合每次查询都发请求）。
 *
 * 未被分配的房间一律归入保留分类「未分类」。 */
(() => {
  const DEFAULT_CATEGORY = '未分类';
  const state = { categories: [], assignments: {} };

  const clean = (value, max) => String(value ?? '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, max);

  window.roomGroups = {
    /** 用服务器返回的分类表覆盖本地状态，返回生效的分类名列表。 */
    apply(value) {
      const source = value && typeof value === 'object' ? value : {};
      const categories = [];
      for (const raw of Array.isArray(source.categories) ? source.categories : []) {
        const name = clean(raw, 24);
        if (!name || name === DEFAULT_CATEGORY || categories.includes(name)) continue;
        categories.push(name);
      }
      const allowed = new Set(categories);
      const assignments = {};
      const rawAssignments = source.assignments && typeof source.assignments === 'object' ? source.assignments : {};
      for (const [rawRoom, rawCategory] of Object.entries(rawAssignments)) {
        const room = clean(rawRoom, 60);
        const category = clean(rawCategory, 24);
        if (room && allowed.has(category)) assignments[room] = category;
      }
      state.categories = categories;
      state.assignments = assignments;
      return categories.slice();
    },
    categories() { return state.categories.slice(); },
    assignments() { return { ...state.assignments }; },
    defaultCategory: DEFAULT_CATEGORY
  };

  window.roomLocation = (name) => {
    const room = clean(name, 60);
    const category = state.assignments[room];
    return category && state.categories.includes(category) ? category : DEFAULT_CATEGORY;
  };
})();
