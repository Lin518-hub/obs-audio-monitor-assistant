import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/assets/room-groups.js', import.meta.url), 'utf8');

/** vm 沙箱里创建的数组/对象原型与宿主不同，断言前先拷回宿主 realm。 */
const toHost = (value) => Array.from(value);

function loadGroups() {
  const context = { window: {} };
  runInNewContext(source, context);
  return context.window;
}

test('falls back to the reserved category before any server data arrives', () => {
  const { roomLocation, roomGroups } = loadGroups();
  assert.equal(roomLocation('鸿蒙智行官方直播间'), '未分类');
  assert.equal(roomLocation('其他直播间'), '未分类');
  assert.equal(roomLocation(null), '未分类');
  assert.deepEqual(toHost(roomGroups.categories()), []);
});

test('resolves assignments published by the monitor center', () => {
  const { roomLocation, roomGroups } = loadGroups();
  roomGroups.apply({
    categories: ['杭海路直播间', '滨江直播间'],
    assignments: {
      鸿蒙智行官方直播间: '杭海路直播间',
      我的华为: '滨江直播间'
    }
  });
  assert.deepEqual(toHost(roomGroups.categories()), ['杭海路直播间', '滨江直播间']);
  assert.equal(roomLocation('鸿蒙智行官方直播间'), '杭海路直播间');
  assert.equal(roomLocation('我的华为'), '滨江直播间');
  assert.equal(roomLocation('未登记的直播间'), '未分类');
});

test('drops invalid categories and dangling assignments', () => {
  const { roomLocation, roomGroups } = loadGroups();
  roomGroups.apply({
    // 空名、保留名、重复名都应被丢弃
    categories: ['杭海路直播间', '', '   ', '未分类', '杭海路直播间'],
    assignments: {
      正常房间: '杭海路直播间',
      指向已删除分类: '不存在的场地',
      空房间名: ''
    }
  });
  assert.deepEqual(toHost(roomGroups.categories()), ['杭海路直播间']);
  assert.equal(roomLocation('正常房间'), '杭海路直播间');
  assert.equal(roomLocation('指向已删除分类'), '未分类');
});

test('trims names and survives malformed payloads', () => {
  const { roomLocation, roomGroups } = loadGroups();
  roomGroups.apply({ categories: ['  杭海路直播间  '], assignments: { '  鸿蒙智行官方直播间  ': '  杭海路直播间  ' } });
  assert.deepEqual(toHost(roomGroups.categories()), ['杭海路直播间']);
  assert.equal(roomLocation('鸿蒙智行官方直播间'), '杭海路直播间');

  for (const bad of [null, undefined, 'oops', 42, { categories: 'nope', assignments: [] }]) {
    roomGroups.apply(bad);
    assert.deepEqual(toHost(roomGroups.categories()), []);
    assert.equal(roomLocation('任意房间'), '未分类');
  }
});

test('replaces previous state instead of merging it', () => {
  const { roomLocation, roomGroups } = loadGroups();
  roomGroups.apply({ categories: ['A'], assignments: { 房间一: 'A' } });
  roomGroups.apply({ categories: ['B'], assignments: { 房间二: 'B' } });
  assert.deepEqual(toHost(roomGroups.categories()), ['B']);
  assert.equal(roomLocation('房间一'), '未分类');
  assert.equal(roomLocation('房间二'), 'B');
});

test('returns copies so callers cannot mutate internal state', () => {
  const { roomGroups, roomLocation } = loadGroups();
  roomGroups.apply({ categories: ['A'], assignments: { 房间: 'A' } });
  roomGroups.categories().push('B');
  roomGroups.assignments()['新房间'] = 'A';
  assert.deepEqual(toHost(roomGroups.categories()), ['A']);
  assert.equal(roomLocation('新房间'), '未分类');
  assert.equal(roomLocation('房间'), 'A');
});
