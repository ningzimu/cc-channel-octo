# Plan: 修复 @ 灰字(mention 显名)—— 模型格式 + 冷 roster 边界

## 背景 / 两个独立成因(重排主次)
已合 #178+#88 让**正常回复路径 + 热 roster** 的 @ 显名。剩余灰字两类:

1. **模型格式错(主因,Part A)**:模型把 `@[<uid>:<displayName>]` 的 `<uid>` 占位符**塌缩成字面单词 `uid`**、真 uid 塞名字槽 → 无效 uid → A8 丢 entity → 灰字。实测本 bot 反复犯。#178 抽象占位符没能防住。
2. **冷 roster A8 丢 entity(次因/窄边界,Part B)**:outbound `resolveMentions`(stream-relay.ts:223)用 `isValidUid = isMember(channelId, uid)`(index.ts:982)。**注意**:正常入站回复**已在 index.ts:484 `await refreshMembers(channelId)` 预热**(含新建子区首条正常回复),所以冷 roster **只影响不走该预热的路径**:命令回复在 refresh 前返回、工具/外部建区后直接 `sendMessage`、其他旁路 direct send。这些路径**很多根本不经 resolveMentions**,预热了也不生成 entity。

范围:只 cc-channel-octo,不碰 OpenClaw,**不放松 A8 防幻觉**。

## 待坐实(定 Part B 范围的前提)
截图那条 `@Qopenclaw @Qcodex` 灰字:是**正常 agent 回复**(则已走 484 预热 → 主因是格式错 = Part A)?还是**直接 sendMessage 旁路**(则冷 roster = Part B)?→ 查该消息的原始 assistant 输出 + 发送路径再定 Part B 是否需要、需要到哪。

## Part A — prompt(agent-bridge.ts,主修)
把抽象 `<uid>` 换成**具体 worked example**,杜绝塌缩:
- "发送者前缀是 `名字(uid)`,例如 `caster(d71255…)`;要 @ 他就写 `@[d71255…:caster]` —— **真 uid 在前、显示名在后**;绝不写字面单词 uid。"
- 纯文案。这是最高频、成本最低、直接治主因的一环。

## Part B — 冷 roster 兜底(代码,按坐实结果决定做多少)
**授权刷新 + 不破 A8:**
- 解析出结构化 mention 的 uid 列表后,**若任一 uid 不在该 channel 的 memberMap → `await refreshMembers(channelId)` 一次(authoritative)→ 再跑 A8 isMember 判定**。miss-based(不是"map 空才刷");group-only;每 turn 至多一次;热且刚刷过靠现有节流跳过(不加网络)。
- **禁止**用 `fetchAndLearnUser`/`learnMember` 来"补进 memberMap 过 A8"——那会让非成员/幻觉 uid 蒙混过关(P1)。真需要展示名而 uid 非成员,只存旁路缓存,不参与 isMember。
- **旁路 direct send(命令/进度/错误)范围决策**:这些多不含 @、且不经 resolveMentions。默认**划出本单范围**(声明它们不做 mention 解析);仅当坐实截图那条走的是某条 direct-send 且确需 @,才抽一个共享 group-send helper(内做预热+resolveMentions+entity 注入)替换那几个 `sendMessage` 调用点——这条作为**可选扩展**,②review 定要不要。

## 测试
- Part B:memberMap 缺被 @ 的 uid → 触发一次 refresh(spy `getGroupMembers` 计数)、补齐后 entity 保留;热/刚刷过 → 不重复打网络。
- A8 不回归:refresh 后仍非成员的幻觉 uid → 照旧丢 entity(**不因回填被放过**)。
- Part A:文案含具体范例(模型行为靠范例约束 + 人核)。

## Rollout
Qcodex + Qopenclaw 审 plan(②)、审代码(④)→ 本地部署验证(新建子区/旁路首条 @ 显名 + 格式塌缩不再复现)→ caster 测过 → 合一个 PR。#178 已合,本轮独立。
