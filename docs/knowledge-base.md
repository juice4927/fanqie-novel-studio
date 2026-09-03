# 商业知识库与质量基准

## 知识库

`src/shared/commercial-knowledge.ts` 内置中国商业网文分类学：题材插件（`genre-plugins.ts`）按题材与章节阶段加载商业写作任务，指导压力积累、回报兑现、影响发酵与下一轮追读，同时服从创作契约、人物动机与事实账本。

## 提示词与质量基准绑定

`src/shared/quality-benchmark-corpus.ts` 保存与提示词版本（`prompt-version.ts`）绑定的固定案例。修改质检提示词或模型版本前，先增加能复现目标问题的案例，再与基线比较（`npm run test:quality`）。

## 上下文编译

写作台“预览上下文”说明每类材料来源、入选原因、字符占用与截断状态；诊断元数据不进模型、不计输入 token。

