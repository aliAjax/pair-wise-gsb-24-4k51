# hxwl-10 考古探方记录

遗址探方、地层关系与出土物坐标档案：探方—地层—出土物—移交—修订链闭环，数据落盘本地存储。

## 技术栈

React + Vite + TypeScript + CSS

## 本地运行

```bash
npm install
npm run dev
```

开发端口：5110

## 闭环规则

- **地层承接**：新地层顶深自动承接上层层底，底深不得超出探方深度。
- **坐标归并**：同一探方内坐标重复的出土物，只能归并到同一标本编号。
- **闭合登记**：未闭合地层不得登记出土物。
- **移交冻结**：移交时冻结坐标和件数。
- **修订留痕**：更正只能新建带原因的修订，原值（移交冻结值）始终保留。
- **落盘一致**：每次操作写入 localStorage；刷新（载入）时重新校验探方、地层、
  出土物与修订链，冲突一律以原值为准回滚，并在冲突清单中列出
  探方、地层、坐标、原值和新值。

## 代码结构

- `src/domain.ts` — 领域模型与全部闭环规则（操作校验 + `reconcile` 落盘校验）
- `src/store.ts` — localStorage 持久化，载入即校验并回写修复结果
- `src/App.tsx` — 探方 / 地层 / 出土物 / 修订链 / 冲突清单界面

## 验证冲突回滚

在浏览器控制台修改存档后刷新即可看到冲突清单：

```js
const a = JSON.parse(localStorage.getItem("hxwl-10/archive/v1"));
a.artifacts[0].count = 99; // 篡改已冻结件数
localStorage.setItem("hxwl-10/archive/v1", JSON.stringify(a));
location.reload(); // 冲突清单列出原值 12 件 / 新值 99 件，并按原值回滚落盘
```
